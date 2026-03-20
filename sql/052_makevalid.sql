-- ============================================================
-- 052_makevalid.sql
-- Phase 8 : ST_MakeValid systématique sur les isochrones
--
-- 1. Mettre à jour fn_iso_cache_compute_geom pour utiliser
--    ST_CollectionExtract(ST_MakeValid(...), 3) — polygones seuls
-- 2. Créer repair_iso_cache_geoms() — nettoyage rétroactif
-- 3. Mettre à jour compute_filosofi_profiles_batch pour wrapper
--    ST_MakeValid sur iso_geom dans ST_Intersects (ceinture + bretelles)
-- ============================================================

-- ============================================================
-- 1. Mise à jour du trigger fn_iso_cache_compute_geom
--    CollectionExtract(type=3) garde uniquement les polygones
--    + Buffer(0) comme fallback si MakeValid retourne autre chose
-- ============================================================

CREATE OR REPLACE FUNCTION fn_iso_cache_compute_geom()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  raw_geom  GEOMETRY;
  fixed_geom GEOMETRY;
BEGIN
  -- Parser la géométrie depuis ORS geojson si absente
  IF NEW.geom IS NULL AND NEW.geojson IS NOT NULL
     AND NEW.geojson->'features'->0->'geometry' IS NOT NULL THEN
    BEGIN
      raw_geom := ST_SetSRID(
        ST_GeomFromGeoJSON((NEW.geojson->'features'->0->>'geometry')),
        4326
      );

      -- ST_MakeValid + extraire uniquement les polygones (type 3)
      fixed_geom := ST_CollectionExtract(ST_MakeValid(raw_geom), 3);

      -- Fallback : ST_Buffer(0) si CollectionExtract retourne vide
      IF fixed_geom IS NULL OR ST_IsEmpty(fixed_geom) THEN
        fixed_geom := ST_Buffer(ST_MakeValid(raw_geom), 0);
      END IF;

      IF fixed_geom IS NOT NULL AND NOT ST_IsEmpty(fixed_geom) THEN
        NEW.geom := fixed_geom;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      NULL;  -- laisser NULL si parsing échoue
    END;
  END IF;

  -- Simplification ~11m
  IF NEW.geom_simplified IS NULL AND NEW.geom IS NOT NULL THEN
    NEW.geom_simplified := ST_Simplify(NEW.geom, 0.0001);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_iso_cache_compute_geom() IS
  'Auto-peuple isochrones_cache.geom et geom_simplified depuis geojson ORS.
   Phase 8 : ST_CollectionExtract(ST_MakeValid, 3) — polygones seuls.
   Fallback: ST_Buffer(ST_MakeValid, 0) si CollectionExtract retourne vide.';

-- ============================================================
-- 2. Fonction de nettoyage rétroactif
--    Appelée par --fix-geometries depuis clustering_poi_filosofi.py
-- ============================================================

CREATE OR REPLACE FUNCTION repair_iso_cache_geoms()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total    INT := 0;
  v_invalid  INT := 0;
  v_repaired INT := 0;
  v_failed   INT := 0;
  rec        RECORD;
  fixed_geom GEOMETRY;
BEGIN
  -- Total isochrones avec géométrie
  SELECT COUNT(*) INTO v_total
  FROM isochrones_cache WHERE geom IS NOT NULL;

  -- Boucle sur les géométries invalides seulement
  FOR rec IN
    SELECT id, geom
    FROM isochrones_cache
    WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)
  LOOP
    v_invalid := v_invalid + 1;

    BEGIN
      -- Tentative 1 : ST_CollectionExtract(ST_MakeValid, 3) — polygones seuls
      fixed_geom := ST_CollectionExtract(ST_MakeValid(rec.geom), 3);

      -- Tentative 2 : ST_Buffer(0) si résultat vide
      IF fixed_geom IS NULL OR ST_IsEmpty(fixed_geom) THEN
        fixed_geom := ST_Buffer(ST_MakeValid(rec.geom), 0);
      END IF;

      IF fixed_geom IS NOT NULL
         AND NOT ST_IsEmpty(fixed_geom)
         AND ST_IsValid(fixed_geom) THEN

        UPDATE isochrones_cache
        SET
          geom            = fixed_geom,
          geom_simplified = ST_Simplify(fixed_geom, 0.0001)
        WHERE id = rec.id;

        v_repaired := v_repaired + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'n_scanned',  v_total,
    'n_invalid',  v_invalid,
    'n_repaired', v_repaired,
    'n_failed',   v_failed
  );
END;
$$;

COMMENT ON FUNCTION repair_iso_cache_geoms() IS
  'Phase 8 : nettoyage rétroactif des géométries invalides dans isochrones_cache.
   Applique ST_CollectionExtract(ST_MakeValid, 3) + fallback ST_Buffer(0).
   Retourne {n_scanned, n_invalid, n_repaired, n_failed}.
   Appelée par scripts/clustering_poi_filosofi.py --mode fix-geometries.';

GRANT EXECUTE ON FUNCTION repair_iso_cache_geoms() TO service_role;

-- ============================================================
-- 3. Mettre à jour compute_filosofi_profiles_batch
--    Wrapper ST_MakeValid sur iso_geom dans la CTE isos
--    (ceinture + bretelles — même si le trigger a déjà validé)
-- ============================================================

CREATE OR REPLACE FUNCTION compute_filosofi_profiles_batch(
  p_entries     JSONB,
  p_secret_stat NUMERIC DEFAULT 11
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
WITH

  -- 1. Parser les entrées JSON
  entries AS (
    SELECT
      (e->>'poi_id')    AS poi_id,
      (e->>'cache_key') AS cache_key
    FROM jsonb_array_elements(p_entries) AS e
    WHERE (e->>'poi_id')    IS NOT NULL
      AND (e->>'cache_key') IS NOT NULL
  ),

  -- 2. Récupérer + valider la géométrie (Phase 8 : ST_MakeValid systématique)
  isos AS (
    SELECT
      entries.poi_id,
      ST_MakeValid(COALESCE(ic.geom_simplified, ic.geom)) AS iso_geom
    FROM entries
    JOIN isochrones_cache ic ON ic.cache_key = entries.cache_key
    WHERE COALESCE(ic.geom_simplified, ic.geom) IS NOT NULL
  ),

  -- 3. Jointure spatiale — ST_MakeValid sur iso_geom dans ST_Intersects
  pairs AS (
    SELECT
      isos.poi_id,
      cf.metadata,
      (
        p_secret_stat <= 0
        OR (
          (cf.metadata->>'ind') IS NOT NULL
          AND (cf.metadata->>'ind') ~ '^[0-9]+(\.[0-9]+)?$'
          AND (cf.metadata->>'ind')::numeric > p_secret_stat
        )
      ) AS ok
    FROM isos
    JOIN carreaux_filosofi cf
      ON cf.geom && isos.iso_geom
      AND ST_Intersects(
            COALESCE(cf.geom_centroid, ST_Centroid(cf.geom)),
            isos.iso_geom   -- déjà ST_MakeValid depuis isos CTE
          )
  ),

  -- 4. Agrégation par poi_id
  agg AS (
    SELECT
      poi_id,
      COUNT(*) FILTER (WHERE ok)::int           AS n_carreaux,
      COUNT(*)::int                             AS n_total,
      SUM(COALESCE((metadata->>'ind')::numeric,       0)) FILTER (WHERE ok) AS v_ind,
      SUM(COALESCE((metadata->>'ind_0_3')::numeric,   0)) FILTER (WHERE ok) AS v_0_3,
      SUM(COALESCE((metadata->>'ind_4_5')::numeric,   0)) FILTER (WHERE ok) AS v_4_5,
      SUM(COALESCE((metadata->>'ind_6_10')::numeric,  0)) FILTER (WHERE ok) AS v_6_10,
      SUM(COALESCE((metadata->>'ind_11_17')::numeric, 0)) FILTER (WHERE ok) AS v_11_17,
      SUM(COALESCE((metadata->>'ind_18_24')::numeric, 0)) FILTER (WHERE ok) AS v_18_24,
      SUM(COALESCE((metadata->>'ind_25_39')::numeric, 0)) FILTER (WHERE ok) AS v_25_39,
      SUM(COALESCE((metadata->>'ind_40_54')::numeric, 0)) FILTER (WHERE ok) AS v_40_54,
      SUM(COALESCE((metadata->>'ind_55_64')::numeric, 0)) FILTER (WHERE ok) AS v_55_64,
      SUM(COALESCE((metadata->>'ind_65_79')::numeric, 0)) FILTER (WHERE ok) AS v_65_79,
      SUM(COALESCE((metadata->>'ind_80p')::numeric,   0)) FILTER (WHERE ok) AS v_80p,
      SUM(COALESCE((metadata->>'ind_snv')::numeric,   0)) FILTER (WHERE ok) AS v_snv,
      SUM(COALESCE((metadata->>'men')::numeric,        0)) FILTER (WHERE ok) AS v_men,
      SUM(COALESCE((metadata->>'men_pauv')::numeric,  0)) FILTER (WHERE ok) AS v_pauv,
      SUM(COALESCE((metadata->>'men_prop')::numeric,  0)) FILTER (WHERE ok) AS v_prop,
      SUM(COALESCE((metadata->>'men_coll')::numeric,  0)) FILTER (WHERE ok) AS v_coll,
      SUM(COALESCE((metadata->>'men_mais')::numeric,  0)) FILTER (WHERE ok) AS v_mais,
      SUM(COALESCE((metadata->>'log_soc')::numeric,   0)) FILTER (WHERE ok) AS v_log_soc,
      SUM(COALESCE((metadata->>'men_1ind')::numeric,  0)) FILTER (WHERE ok) AS v_1ind,
      SUM(COALESCE((metadata->>'men_5ind')::numeric,  0)) FILTER (WHERE ok) AS v_5ind,
      SUM(COALESCE((metadata->>'men_fmp')::numeric,   0)) FILTER (WHERE ok) AS v_fmp,
      SUM(COALESCE((metadata->>'log')::numeric,        0)) FILTER (WHERE ok) AS v_log,
      SUM(COALESCE((metadata->>'log_av45')::numeric,  0)) FILTER (WHERE ok) AS v_av45,
      SUM(COALESCE((metadata->>'log_ap90')::numeric,  0)) FILTER (WHERE ok) AS v_ap90,
      SUM(COALESCE((metadata->>'men_surf')::numeric,  0)) FILTER (WHERE ok) AS v_surf
    FROM pairs
    GROUP BY poi_id
  ),

  -- 5. Vecteur de profil normalisé
  profiles AS (
    SELECT
      poi_id,
      jsonb_build_object(
        'n_carreaux',        n_carreaux,
        'n_carreaux_total',  n_total,
        'cov_rate',          ROUND(n_carreaux::numeric / NULLIF(n_total, 0), 4),
        'population_totale', v_ind,
        'pct_0_17',     ROUND(COALESCE((v_0_3 + v_4_5 + v_6_10 + v_11_17) / NULLIF(v_ind, 0), 0)::numeric, 4),
        'pct_18_39',    ROUND(COALESCE((v_18_24 + v_25_39)                  / NULLIF(v_ind, 0), 0)::numeric, 4),
        'pct_40_54',    ROUND(COALESCE(v_40_54                               / NULLIF(v_ind, 0), 0)::numeric, 4),
        'pct_55_79',    ROUND(COALESCE((v_55_64 + v_65_79)                  / NULLIF(v_ind, 0), 0)::numeric, 4),
        'pct_80p',      ROUND(COALESCE(v_80p                                 / NULLIF(v_ind, 0), 0)::numeric, 4),
        'revenu_moyen', ROUND(COALESCE((v_snv / NULLIF(v_ind, 0)) / 20000.0, 0)::numeric, 4),
        'taux_pauvrete',      ROUND(COALESCE(v_pauv    / NULLIF(v_men,           0), 0)::numeric, 4),
        'taux_proprietaires', ROUND(COALESCE(v_prop    / NULLIF(v_men,           0), 0)::numeric, 4),
        'taux_collectif',     ROUND(COALESCE(v_coll    / NULLIF(v_coll + v_mais, 0), 0)::numeric, 4),
        'taux_hlm',           ROUND(COALESCE(v_log_soc / NULLIF(v_log,           0), 0)::numeric, 4),
        'taux_isoles',        ROUND(COALESCE(v_1ind    / NULLIF(v_men,           0), 0)::numeric, 4),
        'taux_grandes_fam',   ROUND(COALESCE(v_5ind    / NULLIF(v_men,           0), 0)::numeric, 4),
        'taux_mono_parental', ROUND(COALESCE(v_fmp     / NULLIF(v_men,           0), 0)::numeric, 4),
        'taux_ancien',     ROUND(COALESCE(v_av45 / NULLIF(v_log, 0), 0)::numeric, 4),
        'taux_recent',     ROUND(COALESCE(v_ap90 / NULLIF(v_log, 0), 0)::numeric, 4),
        'surface_moyenne', ROUND(COALESCE(v_surf / NULLIF(v_men, 0), 0)::numeric, 2)
      ) AS profile
    FROM agg
    WHERE n_carreaux > 0 AND v_ind > 0
  )

SELECT COALESCE(jsonb_object_agg(poi_id, profile), '{}'::jsonb)
FROM profiles;

$fn$;

COMMENT ON FUNCTION compute_filosofi_profiles_batch(JSONB, NUMERIC) IS
  'Phase 7+8 : profils Filosofi batch pour N POI.
   Phase 8 : ST_MakeValid systématique sur iso_geom (ceinture + bretelles).
   Entree : [{poi_id, cache_key}]. Sortie : {poi_id: profil}.';

GRANT EXECUTE ON FUNCTION compute_filosofi_profiles_batch(JSONB, NUMERIC) TO service_role;
