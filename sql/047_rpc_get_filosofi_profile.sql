-- ============================================================
-- 047_rpc_get_filosofi_profile.sql
-- RPC get_filosofi_profile_for_isochrone — v5
--
-- Calcule le profil sociodemographique Filosofi d'une isochrone.
-- Utilise le pattern GiST-first de compute_coverage_fast (017) :
--   1. cf.geom && iso  → index bounding-box (rapide)
--   2. ST_Intersects(COALESCE(geom_centroid, ST_Centroid(geom)), iso) → exact
-- Pas de ST_Intersection area : tous les carreaux ont poids w=1.
-- ============================================================

CREATE OR REPLACE FUNCTION get_filosofi_profile_for_isochrone(
  p_iso_geojson  TEXT,
  p_secret_stat  NUMERIC DEFAULT 11
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  iso_geom   GEOMETRY;
  v_result   JSONB;

  -- Aggregats bruts
  v_n        INTEGER;
  v_ind      NUMERIC;  -- population totale
  v_0_3      NUMERIC;  v_4_5      NUMERIC;  v_6_10     NUMERIC;
  v_11_17    NUMERIC;  v_18_24    NUMERIC;  v_25_39    NUMERIC;
  v_40_54    NUMERIC;  v_55_64    NUMERIC;  v_65_79    NUMERIC;
  v_80p      NUMERIC;
  v_snv      NUMERIC;  -- sum living standard (ind_snv)
  v_men      NUMERIC;  -- menages total
  v_pauv     NUMERIC;  -- menages pauvres
  v_prop     NUMERIC;  -- propriétaires
  v_coll     NUMERIC;  -- logement collectif
  v_mais     NUMERIC;  -- logement individuel
  v_log_soc  NUMERIC;  -- logements sociaux
  v_1ind     NUMERIC;  -- menages 1 personne
  v_5ind     NUMERIC;  -- menages 5+ personnes
  v_fmp      NUMERIC;  -- familles mono-parentales
  v_log      NUMERIC;  -- logements total
  v_av45     NUMERIC;  -- logements avant 1945
  v_ap90     NUMERIC;  -- logements après 1990
  v_surf     NUMERIC;  -- surface totale des logements
BEGIN
  -- Parser le GeoJSON de la géométrie de l'isochrone
  BEGIN
    iso_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_iso_geojson), 4326);
    IF NOT ST_IsValid(iso_geom) THEN
      iso_geom := ST_MakeValid(iso_geom);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'invalid_geojson', 'detail', SQLERRM);
  END;

  -- Agréger les carreaux intersectant l'isochrone
  -- Pattern : && d'abord (index GiST), puis centroïde exact
  SELECT
    COUNT(*)::INTEGER,
    SUM(COALESCE((metadata->>'ind')::numeric,      0)),
    SUM(COALESCE((metadata->>'ind_0_3')::numeric,  0)),
    SUM(COALESCE((metadata->>'ind_4_5')::numeric,  0)),
    SUM(COALESCE((metadata->>'ind_6_10')::numeric, 0)),
    SUM(COALESCE((metadata->>'ind_11_17')::numeric,0)),
    SUM(COALESCE((metadata->>'ind_18_24')::numeric,0)),
    SUM(COALESCE((metadata->>'ind_25_39')::numeric,0)),
    SUM(COALESCE((metadata->>'ind_40_54')::numeric,0)),
    SUM(COALESCE((metadata->>'ind_55_64')::numeric,0)),
    SUM(COALESCE((metadata->>'ind_65_79')::numeric,0)),
    SUM(COALESCE((metadata->>'ind_80p')::numeric,  0)),
    SUM(COALESCE((metadata->>'ind_snv')::numeric,  0)),
    SUM(COALESCE((metadata->>'men')::numeric,       0)),
    SUM(COALESCE((metadata->>'men_pauv')::numeric,  0)),
    SUM(COALESCE((metadata->>'men_prop')::numeric,  0)),
    SUM(COALESCE((metadata->>'men_coll')::numeric,  0)),
    SUM(COALESCE((metadata->>'men_mais')::numeric,  0)),
    SUM(COALESCE((metadata->>'log_soc')::numeric,   0)),
    SUM(COALESCE((metadata->>'men_1ind')::numeric,  0)),
    SUM(COALESCE((metadata->>'men_5ind')::numeric,  0)),
    SUM(COALESCE((metadata->>'men_fmp')::numeric,   0)),
    SUM(COALESCE((metadata->>'log')::numeric,        0)),
    SUM(COALESCE((metadata->>'log_av45')::numeric,  0)),
    SUM(COALESCE((metadata->>'log_ap90')::numeric,  0)),
    SUM(COALESCE((metadata->>'men_surf')::numeric,  0))
  INTO
    v_n, v_ind,
    v_0_3, v_4_5, v_6_10, v_11_17,
    v_18_24, v_25_39, v_40_54, v_55_64, v_65_79, v_80p,
    v_snv, v_men, v_pauv, v_prop, v_coll, v_mais,
    v_log_soc, v_1ind, v_5ind, v_fmp,
    v_log, v_av45, v_ap90, v_surf
  FROM carreaux_filosofi cf
  WHERE cf.geom && iso_geom
    AND ST_Intersects(
          COALESCE(cf.geom_centroid, ST_Centroid(cf.geom)),
          iso_geom
        )
    -- Secret statistique : exclure carreaux avec population insuffisante
    AND (
      p_secret_stat <= 0
      OR (
        (metadata->>'ind') IS NOT NULL
        AND (metadata->>'ind') ~ '^[0-9]+(\.[0-9]+)?$'
        AND (metadata->>'ind')::numeric > p_secret_stat
      )
    );

  -- Aucun carreau trouvé
  IF v_n = 0 OR v_ind IS NULL OR v_ind = 0 THEN
    RETURN jsonb_build_object(
      'n_carreaux',       0,
      'population_totale', 0,
      'error',            'no_data'
    );
  END IF;

  -- Construire le vecteur de profil (proportions/ratios — jamais de volumes bruts)
  v_result := jsonb_build_object(
    'n_carreaux',           v_n,
    'population_totale',    v_ind,

    -- Tranches d'age
    'pct_0_17',     ROUND(COALESCE((v_0_3 + v_4_5 + v_6_10 + v_11_17) / NULLIF(v_ind, 0), 0)::numeric, 4),
    'pct_18_39',    ROUND(COALESCE((v_18_24 + v_25_39)                  / NULLIF(v_ind, 0), 0)::numeric, 4),
    'pct_40_54',    ROUND(COALESCE(v_40_54                               / NULLIF(v_ind, 0), 0)::numeric, 4),
    'pct_55_79',    ROUND(COALESCE((v_55_64 + v_65_79)                  / NULLIF(v_ind, 0), 0)::numeric, 4),
    'pct_80p',      ROUND(COALESCE(v_80p                                 / NULLIF(v_ind, 0), 0)::numeric, 4),

    -- Revenu (ind_snv = somme des niveaux de vie UCU → /ind = niveau de vie moyen)
    -- Normalisé par 20 000 € (ordre de grandeur du niveau de vie médian France)
    'revenu_moyen', ROUND(COALESCE((v_snv / NULLIF(v_ind, 0)) / 20000.0, 0)::numeric, 4),

    -- Ménages
    'taux_pauvrete',      ROUND(COALESCE(v_pauv / NULLIF(v_men, 0), 0)::numeric, 4),
    'taux_proprietaires', ROUND(COALESCE(v_prop / NULLIF(v_men, 0), 0)::numeric, 4),
    'taux_collectif',     ROUND(COALESCE(v_coll / NULLIF(v_coll + v_mais, 0), 0)::numeric, 4),
    'taux_hlm',           ROUND(COALESCE(v_log_soc / NULLIF(v_log, 0), 0)::numeric, 4),
    'taux_isoles',        ROUND(COALESCE(v_1ind / NULLIF(v_men, 0), 0)::numeric, 4),
    'taux_grandes_fam',   ROUND(COALESCE(v_5ind / NULLIF(v_men, 0), 0)::numeric, 4),
    'taux_mono_parental', ROUND(COALESCE(v_fmp  / NULLIF(v_men, 0), 0)::numeric, 4),

    -- Logements
    'taux_ancien',    ROUND(COALESCE(v_av45 / NULLIF(v_log, 0), 0)::numeric, 4),
    'taux_recent',    ROUND(COALESCE(v_ap90 / NULLIF(v_log, 0), 0)::numeric, 4),
    'surface_moyenne', ROUND(COALESCE(v_surf / NULLIF(v_men, 0), 0)::numeric, 2)
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_filosofi_profile_for_isochrone(TEXT, NUMERIC) IS
  'Profil sociodemographique Filosofi pour une isochrone GeoJSON.
   Pattern GiST-first (&&) + COALESCE(geom_centroid, ST_Centroid(geom)) — pas de ST_Intersection.
   Retourne JSONB avec n_carreaux, population_totale + 16 features normalisées.';

GRANT EXECUTE ON FUNCTION get_filosofi_profile_for_isochrone(TEXT, NUMERIC) TO service_role;
