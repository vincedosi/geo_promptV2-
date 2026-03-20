-- ============================================================
-- 051_perf_batch.sql
-- Phase 7 : Optimisation PostGIS — batch profil Filosofi
--
-- 1. Colonne geom + geom_simplified sur isochrones_cache
--    (extrait depuis geojson->features[0]->geometry)
-- 2. Trigger BEFORE INSERT/UPDATE pour auto-peupler
-- 3. Index GiST sur isochrones_cache et carreaux_filosofi
-- 4. RPC compute_filosofi_profiles_batch :
--    [{poi_id, cache_key}] -> JSONB {poi_id: profil}
--    Remplace N appels séquentiels à get_filosofi_profile_for_isochrone
-- ============================================================

-- ============================================================
-- 1. Colonnes géométriques sur isochrones_cache
-- ============================================================

ALTER TABLE isochrones_cache
  ADD COLUMN IF NOT EXISTS geom            GEOMETRY(Geometry, 4326),
  ADD COLUMN IF NOT EXISTS geom_simplified GEOMETRY(Geometry, 4326);

-- ============================================================
-- 2. Backfill : peupler depuis geojson existant
--    Pattern ORS : geojson -> features[0] -> geometry
-- ============================================================

UPDATE isochrones_cache
SET geom = (
  SELECT
    CASE
      WHEN ST_IsValid(g) THEN g
      ELSE ST_MakeValid(g)
    END
  FROM (
    SELECT ST_SetSRID(
      ST_GeomFromGeoJSON((geojson->'features'->0->>'geometry')),
      4326
    ) AS g
  ) sub
)
WHERE geom IS NULL
  AND geojson IS NOT NULL
  AND geojson->'features'->0->'geometry' IS NOT NULL;

UPDATE isochrones_cache
SET geom_simplified = ST_Simplify(geom, 0.0001)  -- ~11m : réduit les vertex sans biais
WHERE geom_simplified IS NULL
  AND geom IS NOT NULL;

-- ============================================================
-- 3. Trigger auto-populate geom + geom_simplified
-- ============================================================

CREATE OR REPLACE FUNCTION fn_iso_cache_compute_geom()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Parser la géométrie depuis ORS geojson si absent
  IF NEW.geom IS NULL AND NEW.geojson IS NOT NULL
     AND NEW.geojson->'features'->0->'geometry' IS NOT NULL THEN
    BEGIN
      NEW.geom := ST_SetSRID(
        ST_GeomFromGeoJSON((NEW.geojson->'features'->0->>'geometry')),
        4326
      );
      IF NOT ST_IsValid(NEW.geom) THEN
        NEW.geom := ST_MakeValid(NEW.geom);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- laisser NULL si parsing échoue
    END;
  END IF;

  -- Simplification ~11m (réduit vertex pour spatial intersect)
  IF NEW.geom_simplified IS NULL AND NEW.geom IS NOT NULL THEN
    NEW.geom_simplified := ST_Simplify(NEW.geom, 0.0001);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_iso_cache_compute_geom ON isochrones_cache;
CREATE TRIGGER trg_iso_cache_compute_geom
  BEFORE INSERT OR UPDATE ON isochrones_cache
  FOR EACH ROW EXECUTE FUNCTION fn_iso_cache_compute_geom();

COMMENT ON FUNCTION fn_iso_cache_compute_geom() IS
  'Auto-peuple isochrones_cache.geom et geom_simplified depuis geojson ORS.
   geom_simplified: ST_Simplify 0.0001° (~11m) — accélère ST_Intersects multi-batch.';

-- ============================================================
-- 4. Index GiST
-- ============================================================

-- isochrones_cache
CREATE INDEX IF NOT EXISTS idx_iso_cache_geom
  ON isochrones_cache USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_iso_cache_geom_simplified
  ON isochrones_cache USING GIST (geom_simplified);

CREATE INDEX IF NOT EXISTS idx_iso_cache_cache_key
  ON isochrones_cache (cache_key);

-- carreaux_filosofi (au cas où non créés précédemment)
CREATE INDEX IF NOT EXISTS idx_carreaux_filosofi_geom
  ON carreaux_filosofi USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_carreaux_filosofi_geom_centroid
  ON carreaux_filosofi USING GIST (geom_centroid)
  WHERE geom_centroid IS NOT NULL;

-- ============================================================
-- 5. RPC compute_filosofi_profiles_batch
--    Remplace N × get_filosofi_profile_for_isochrone par 1 seule query
-- ============================================================

CREATE OR REPLACE FUNCTION compute_filosofi_profiles_batch(
  p_entries     JSONB,             -- [{"poi_id": "uuid", "cache_key": "battle__..."}, ...]
  p_secret_stat NUMERIC DEFAULT 11 -- seuil secret statistique INSEE (ind > seuil)
)
RETURNS JSONB  -- {"<poi_id>": {n_carreaux, n_carreaux_total, cov_rate, population_totale, ...16 features...}}
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
WITH

  -- 1. Parser les entrées JSON
  entries AS (
    SELECT
      (e->>'poi_id')   AS poi_id,
      (e->>'cache_key') AS cache_key
    FROM jsonb_array_elements(p_entries) AS e
    WHERE (e->>'poi_id')    IS NOT NULL
      AND (e->>'cache_key') IS NOT NULL
  ),

  -- 2. Récupérer la géométrie depuis isochrones_cache
  --    Préférer geom_simplified (moins de vertex) sinon geom
  isos AS (
    SELECT
      entries.poi_id,
      COALESCE(ic.geom_simplified, ic.geom) AS iso_geom
    FROM entries
    JOIN isochrones_cache ic ON ic.cache_key = entries.cache_key
    WHERE COALESCE(ic.geom_simplified, ic.geom) IS NOT NULL
  ),

  -- 3. Jointure spatiale unique carreaux × isochrones
  --    ok = passe le filtre secret statistique
  --    On scanne les carreaux une seule fois pour tous les POI
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
      ON cf.geom && isos.iso_geom                                  -- bbox GiST rapide
      AND ST_Intersects(                                           -- exact sur centroïde
            COALESCE(cf.geom_centroid, ST_Centroid(cf.geom)),
            isos.iso_geom
          )
  ),

  -- 4. Agrégation par poi_id — FILTER sépare total / secret stat
  agg AS (
    SELECT
      poi_id,

      -- comptage avec/sans filtre secret stat (pour cov_rate)
      COUNT(*) FILTER (WHERE ok)::int           AS n_carreaux,
      COUNT(*)::int                             AS n_total,

      -- sums avec filtre secret stat
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

  -- 5. Construire le vecteur de profil (mêmes ratios que get_filosofi_profile_for_isochrone)
  profiles AS (
    SELECT
      poi_id,
      jsonb_build_object(
        'n_carreaux',        n_carreaux,
        'n_carreaux_total',  n_total,
        'cov_rate',          ROUND(n_carreaux::numeric / NULLIF(n_total, 0), 4),
        'population_totale', v_ind,

        -- Tranches d'âge (ratios sur population)
        'pct_0_17',     ROUND(COALESCE((v_0_3 + v_4_5 + v_6_10 + v_11_17) / NULLIF(v_ind, 0), 0)::numeric, 4),
        'pct_18_39',    ROUND(COALESCE((v_18_24 + v_25_39)                  / NULLIF(v_ind, 0), 0)::numeric, 4),
        'pct_40_54',    ROUND(COALESCE(v_40_54                               / NULLIF(v_ind, 0), 0)::numeric, 4),
        'pct_55_79',    ROUND(COALESCE((v_55_64 + v_65_79)                  / NULLIF(v_ind, 0), 0)::numeric, 4),
        'pct_80p',      ROUND(COALESCE(v_80p                                 / NULLIF(v_ind, 0), 0)::numeric, 4),

        -- Revenu : ind_snv = somme niveaux de vie UCU → /ind = niveau moyen, /20000 normalisé
        'revenu_moyen', ROUND(COALESCE((v_snv / NULLIF(v_ind, 0)) / 20000.0, 0)::numeric, 4),

        -- Ménages
        'taux_pauvrete',      ROUND(COALESCE(v_pauv    / NULLIF(v_men,              0), 0)::numeric, 4),
        'taux_proprietaires', ROUND(COALESCE(v_prop    / NULLIF(v_men,              0), 0)::numeric, 4),
        'taux_collectif',     ROUND(COALESCE(v_coll    / NULLIF(v_coll + v_mais,    0), 0)::numeric, 4),
        'taux_hlm',           ROUND(COALESCE(v_log_soc / NULLIF(v_log,              0), 0)::numeric, 4),
        'taux_isoles',        ROUND(COALESCE(v_1ind    / NULLIF(v_men,              0), 0)::numeric, 4),
        'taux_grandes_fam',   ROUND(COALESCE(v_5ind    / NULLIF(v_men,              0), 0)::numeric, 4),
        'taux_mono_parental', ROUND(COALESCE(v_fmp     / NULLIF(v_men,              0), 0)::numeric, 4),

        -- Logements
        'taux_ancien',     ROUND(COALESCE(v_av45 / NULLIF(v_log, 0), 0)::numeric, 4),
        'taux_recent',     ROUND(COALESCE(v_ap90 / NULLIF(v_log, 0), 0)::numeric, 4),
        'surface_moyenne', ROUND(COALESCE(v_surf / NULLIF(v_men, 0), 0)::numeric, 2)
      ) AS profile
    FROM agg
    WHERE n_carreaux > 0 AND v_ind > 0
  )

-- 6. Agréger en objet JSON {poi_id: profil, ...}
SELECT COALESCE(jsonb_object_agg(poi_id, profile), '{}'::jsonb)
FROM profiles;

$fn$;

COMMENT ON FUNCTION compute_filosofi_profiles_batch(JSONB, NUMERIC) IS
  'Calcule les profils sociodemographiques Filosofi pour N POI en une seule query spatiale.
   Entrée : [{poi_id, cache_key}] — les géométries sont lues depuis isochrones_cache.geom_simplified.
   Sortie : {poi_id: {n_carreaux, n_carreaux_total, cov_rate, population_totale, 16 features}}.
   Remplace N appels séquentiels à get_filosofi_profile_for_isochrone (gain ~10-50x).
   Pattern GiST-first (&&) + COALESCE(geom_centroid, ST_Centroid(geom)) + FILTER agrégat.';

GRANT EXECUTE ON FUNCTION compute_filosofi_profiles_batch(JSONB, NUMERIC) TO service_role;
