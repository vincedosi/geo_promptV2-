-- ============================================================
-- 048_secret_stat_coverage.sql
-- Phase 3 : Gestion du secret statistique INSEE
--
-- 1. Colonne imputed_features sur poi_clusters
-- 2. RPC get_filosofi_profile_for_isochrone v6 : ajoute
--    n_carreaux_total + cov_rate (inclus / total)
-- 3. RPC get_filosofi_secret_stat_diagnostic : stats globales
--    sur echantillon 10% (TABLESAMPLE)
-- ============================================================

-- 1. Colonne imputed_features
ALTER TABLE poi_clusters ADD COLUMN IF NOT EXISTS imputed_features JSONB DEFAULT '[]';

-- 2. RPC v6 : coverage-aware
DROP FUNCTION IF EXISTS get_filosofi_profile_for_isochrone(TEXT, NUMERIC);
DROP FUNCTION IF EXISTS get_filosofi_profile_for_isochrone(TEXT, INTEGER);

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
  v_n_total  INTEGER;
  v_n        INTEGER;
  v_ind      NUMERIC;
  v_0_3      NUMERIC;  v_4_5      NUMERIC;  v_6_10     NUMERIC;
  v_11_17    NUMERIC;  v_18_24    NUMERIC;  v_25_39    NUMERIC;
  v_40_54    NUMERIC;  v_55_64    NUMERIC;  v_65_79    NUMERIC;
  v_80p      NUMERIC;
  v_snv      NUMERIC;
  v_men      NUMERIC;  v_pauv     NUMERIC;  v_prop     NUMERIC;
  v_coll     NUMERIC;  v_mais     NUMERIC;  v_log_soc  NUMERIC;
  v_1ind     NUMERIC;  v_5ind     NUMERIC;  v_fmp      NUMERIC;
  v_log      NUMERIC;  v_av45     NUMERIC;  v_ap90     NUMERIC;
  v_surf     NUMERIC;
BEGIN
  BEGIN
    iso_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_iso_geojson), 4326);
    IF NOT ST_IsValid(iso_geom) THEN
      iso_geom := ST_MakeValid(iso_geom);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'invalid_geojson', 'detail', SQLERRM);
  END;

  -- CTE : classe chaque carreau intersectant comme ok (passe secret stat) ou non
  WITH base AS (
    SELECT
      cf.metadata,
      CASE
        WHEN p_secret_stat <= 0 THEN TRUE
        WHEN (cf.metadata->>'ind') IS NOT NULL
             AND (cf.metadata->>'ind') ~ '^[0-9]+(\.[0-9]+)?$'
             AND (cf.metadata->>'ind')::numeric > p_secret_stat THEN TRUE
        ELSE FALSE
      END AS ok
    FROM carreaux_filosofi cf
    WHERE cf.geom && iso_geom
      AND ST_Intersects(
            COALESCE(cf.geom_centroid, ST_Centroid(cf.geom)),
            iso_geom
          )
  )
  SELECT
    COUNT(*)::INTEGER,                                                            -- n_total
    COUNT(*) FILTER (WHERE ok)::INTEGER,                                          -- n_inclus
    SUM(COALESCE((metadata->>'ind')::numeric,       0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_0_3')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_4_5')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_6_10')::numeric,  0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_11_17')::numeric, 0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_18_24')::numeric, 0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_25_39')::numeric, 0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_40_54')::numeric, 0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_55_64')::numeric, 0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_65_79')::numeric, 0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_80p')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'ind_snv')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'men')::numeric,        0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'men_pauv')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'men_prop')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'men_coll')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'men_mais')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'log_soc')::numeric,    0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'men_1ind')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'men_5ind')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'men_fmp')::numeric,    0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'log')::numeric,         0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'log_av45')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'log_ap90')::numeric,   0)) FILTER (WHERE ok),
    SUM(COALESCE((metadata->>'men_surf')::numeric,   0)) FILTER (WHERE ok)
  INTO
    v_n_total, v_n, v_ind,
    v_0_3, v_4_5, v_6_10, v_11_17,
    v_18_24, v_25_39, v_40_54, v_55_64, v_65_79, v_80p,
    v_snv, v_men, v_pauv, v_prop, v_coll, v_mais,
    v_log_soc, v_1ind, v_5ind, v_fmp,
    v_log, v_av45, v_ap90, v_surf
  FROM base;

  IF v_n = 0 OR v_n IS NULL OR v_ind IS NULL OR v_ind = 0 THEN
    RETURN jsonb_build_object(
      'n_carreaux',        0,
      'n_carreaux_total',  COALESCE(v_n_total, 0),
      'population_totale', 0,
      'cov_rate',          0,
      'error',             'no_data'
    );
  END IF;

  RETURN jsonb_build_object(
    'n_carreaux',        v_n,
    'n_carreaux_total',  COALESCE(v_n_total, v_n),
    'population_totale', v_ind,
    'cov_rate',          ROUND(COALESCE(v_n::numeric / NULLIF(v_n_total, 0), 1.0), 4),

    'pct_0_17',          ROUND(COALESCE((v_0_3+v_4_5+v_6_10+v_11_17)/NULLIF(v_ind,0),0)::numeric,4),
    'pct_18_39',         ROUND(COALESCE((v_18_24+v_25_39)             /NULLIF(v_ind,0),0)::numeric,4),
    'pct_40_54',         ROUND(COALESCE(v_40_54                        /NULLIF(v_ind,0),0)::numeric,4),
    'pct_55_79',         ROUND(COALESCE((v_55_64+v_65_79)             /NULLIF(v_ind,0),0)::numeric,4),
    'pct_80p',           ROUND(COALESCE(v_80p                          /NULLIF(v_ind,0),0)::numeric,4),
    'revenu_moyen',      ROUND(COALESCE((v_snv/NULLIF(v_ind,0))/20000.0,0)::numeric,4),
    'taux_pauvrete',     ROUND(COALESCE(v_pauv  /NULLIF(v_men,0),0)::numeric,4),
    'taux_proprietaires',ROUND(COALESCE(v_prop  /NULLIF(v_men,0),0)::numeric,4),
    'taux_collectif',    ROUND(COALESCE(v_coll  /NULLIF(v_coll+v_mais,0),0)::numeric,4),
    'taux_hlm',          ROUND(COALESCE(v_log_soc/NULLIF(v_log,0),0)::numeric,4),
    'taux_isoles',       ROUND(COALESCE(v_1ind  /NULLIF(v_men,0),0)::numeric,4),
    'taux_grandes_fam',  ROUND(COALESCE(v_5ind  /NULLIF(v_men,0),0)::numeric,4),
    'taux_mono_parental',ROUND(COALESCE(v_fmp   /NULLIF(v_men,0),0)::numeric,4),
    'taux_ancien',       ROUND(COALESCE(v_av45  /NULLIF(v_log,0),0)::numeric,4),
    'taux_recent',       ROUND(COALESCE(v_ap90  /NULLIF(v_log,0),0)::numeric,4),
    'surface_moyenne',   ROUND(COALESCE(v_surf  /NULLIF(v_men,0),0)::numeric,2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_filosofi_profile_for_isochrone(TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION get_filosofi_profile_for_isochrone(TEXT, NUMERIC) TO anon;
GRANT EXECUTE ON FUNCTION get_filosofi_profile_for_isochrone(TEXT, NUMERIC) TO authenticated;

-- 3. Diagnostic global (echantillon TABLESAMPLE 10%)
CREATE OR REPLACE FUNCTION get_filosofi_secret_stat_diagnostic(
  p_secret_stat NUMERIC DEFAULT 11
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH q AS (
    SELECT
      COUNT(*)                                                                                     AS n_total,
      COUNT(*) FILTER (WHERE (metadata->>'ind') IS NULL
                          OR (metadata->>'ind')::numeric <= p_secret_stat)                         AS n_secret,
      COUNT(*) FILTER (WHERE (metadata->>'ind') IS NOT NULL
                          AND (metadata->>'ind')::numeric > p_secret_stat
                          AND (metadata->>'ind_0_3') IS NULL)                                      AS n_null_age,
      COUNT(*) FILTER (WHERE (metadata->>'ind') IS NOT NULL
                          AND (metadata->>'ind')::numeric > p_secret_stat
                          AND (metadata->>'ind_snv') IS NULL)                                      AS n_null_snv,
      COUNT(*) FILTER (WHERE (metadata->>'ind') IS NOT NULL
                          AND (metadata->>'ind')::numeric > p_secret_stat
                          AND (metadata->>'men_pauv') IS NULL)                                     AS n_null_men_pauv,
      COUNT(*) FILTER (WHERE (metadata->>'ind') IS NOT NULL
                          AND (metadata->>'ind')::numeric > p_secret_stat
                          AND (metadata->>'log_soc') IS NULL)                                      AS n_null_log_soc,
      -- Zeros dans les carreaux inclus
      COUNT(*) FILTER (WHERE (metadata->>'ind')::numeric > p_secret_stat
                          AND (metadata->>'log_soc')::numeric  = 0)                                AS n_zero_log_soc,
      COUNT(*) FILTER (WHERE (metadata->>'ind')::numeric > p_secret_stat
                          AND (metadata->>'men_pauv')::numeric = 0)                                AS n_zero_men_pauv,
      COUNT(*) FILTER (WHERE (metadata->>'ind')::numeric > p_secret_stat
                          AND (metadata->>'log_av45')::numeric = 0)                                AS n_zero_log_av45,
      COUNT(*) FILTER (WHERE (metadata->>'ind')::numeric > p_secret_stat
                          AND (metadata->>'log_ap90')::numeric = 0)                                AS n_zero_log_ap90,
      COUNT(*) FILTER (WHERE (metadata->>'ind')::numeric > p_secret_stat) AS n_inclus
    FROM carreaux_filosofi TABLESAMPLE SYSTEM(10)
  )
  SELECT jsonb_build_object(
    'note',              'Echantillon 10% TABLESAMPLE',
    'n_echantillon',     n_total,
    'n_secret_stat',     n_secret,
    'n_inclus',          n_inclus,
    'pct_secret_stat',   ROUND(n_secret::numeric / NULLIF(n_total, 0) * 100, 1),
    'pct_null_age',      ROUND(n_null_age::numeric   / NULLIF(n_inclus, 0) * 100, 1),
    'pct_null_snv',      ROUND(n_null_snv::numeric   / NULLIF(n_inclus, 0) * 100, 1),
    'pct_null_men_pauv', ROUND(n_null_men_pauv::numeric / NULLIF(n_inclus, 0) * 100, 1),
    'pct_null_log_soc',  ROUND(n_null_log_soc::numeric  / NULLIF(n_inclus, 0) * 100, 1),
    'pct_zero_log_soc',  ROUND(n_zero_log_soc::numeric  / NULLIF(n_inclus, 0) * 100, 1),
    'pct_zero_men_pauv', ROUND(n_zero_men_pauv::numeric / NULLIF(n_inclus, 0) * 100, 1),
    'pct_zero_log_av45', ROUND(n_zero_log_av45::numeric / NULLIF(n_inclus, 0) * 100, 1),
    'pct_zero_log_ap90', ROUND(n_zero_log_ap90::numeric / NULLIF(n_inclus, 0) * 100, 1)
  ) INTO v_result FROM q;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_filosofi_secret_stat_diagnostic(NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION get_filosofi_secret_stat_diagnostic(NUMERIC) TO anon;
GRANT EXECUTE ON FUNCTION get_filosofi_secret_stat_diagnostic(NUMERIC) TO authenticated;

COMMENT ON FUNCTION get_filosofi_profile_for_isochrone(TEXT, NUMERIC) IS
  'v6 — Profil Filosofi + cov_rate (n_carreaux_inclus/n_total). '
  'cov_rate < 0.5 -> features peu fiables (trop de secret stat dans l''isochrone).';
COMMENT ON FUNCTION get_filosofi_secret_stat_diagnostic(NUMERIC) IS
  'Diagnostic global secret stat INSEE sur 10% TABLESAMPLE de carreaux_filosofi.';
