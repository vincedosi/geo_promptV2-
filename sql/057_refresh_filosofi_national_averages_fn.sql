-- 057_refresh_filosofi_national_averages_fn.sql
-- Fonction SQL pour recalculer les moyennes nationales Filosofi (16 features)
-- Appelée depuis Python : --mode compute-france-averages
-- Scan unique via CTE + unnest parallèle pour performance

CREATE OR REPLACE FUNCTION refresh_filosofi_national_averages()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ts  timestamptz := now();
  n   integer;
BEGIN
  INSERT INTO filosofi_national_averages
    (feature_name, avg_value, std_value, min_value, max_value, n_carreaux, computed_at)
  SELECT
    feat,
    ROUND(AVG(val)::numeric,    6),
    ROUND(STDDEV(val)::numeric, 6),
    ROUND(MIN(val)::numeric,    6),
    ROUND(MAX(val)::numeric,    6),
    COUNT(*)::integer,
    ts
  FROM (
    -- Single table scan via lateral unnest of parallel feature arrays
    SELECT t.feat, t.val
    FROM carreaux_filosofi cf,
    LATERAL (
      SELECT *
      FROM UNNEST(
        ARRAY[
          'pct_0_17','pct_18_39','pct_40_54','pct_55_79','pct_80p',
          'revenu_moyen',
          'taux_pauvrete','taux_proprietaires','taux_collectif','taux_hlm',
          'taux_isoles','taux_grandes_fam','taux_mono_parental',
          'taux_ancien','taux_recent','surface_moyenne'
        ]::text[],
        ARRAY[
          (COALESCE((cf.metadata->>'ind_0_3')::numeric,0)
           +COALESCE((cf.metadata->>'ind_4_5')::numeric,0)
           +COALESCE((cf.metadata->>'ind_6_10')::numeric,0)
           +COALESCE((cf.metadata->>'ind_11_17')::numeric,0))
            / NULLIF((cf.metadata->>'ind')::numeric,0),
          (COALESCE((cf.metadata->>'ind_18_24')::numeric,0)
           +COALESCE((cf.metadata->>'ind_25_39')::numeric,0))
            / NULLIF((cf.metadata->>'ind')::numeric,0),
          COALESCE((cf.metadata->>'ind_40_54')::numeric,0)
            / NULLIF((cf.metadata->>'ind')::numeric,0),
          (COALESCE((cf.metadata->>'ind_55_64')::numeric,0)
           +COALESCE((cf.metadata->>'ind_65_79')::numeric,0))
            / NULLIF((cf.metadata->>'ind')::numeric,0),
          COALESCE((cf.metadata->>'ind_80p')::numeric,0)
            / NULLIF((cf.metadata->>'ind')::numeric,0),
          COALESCE((cf.metadata->>'ind_snv')::numeric,0)
            / NULLIF((cf.metadata->>'ind')::numeric,0) / 20000.0,
          COALESCE((cf.metadata->>'men_pauv')::numeric,0)
            / NULLIF((cf.metadata->>'men')::numeric,0),
          COALESCE((cf.metadata->>'men_prop')::numeric,0)
            / NULLIF((cf.metadata->>'men')::numeric,0),
          COALESCE((cf.metadata->>'men_coll')::numeric,0)
            / NULLIF(COALESCE((cf.metadata->>'men_coll')::numeric,0)
                    +COALESCE((cf.metadata->>'men_mais')::numeric,0), 0),
          COALESCE((cf.metadata->>'log_soc')::numeric,0)
            / NULLIF((cf.metadata->>'log')::numeric,0),
          COALESCE((cf.metadata->>'men_1ind')::numeric,0)
            / NULLIF((cf.metadata->>'men')::numeric,0),
          COALESCE((cf.metadata->>'men_5ind')::numeric,0)
            / NULLIF((cf.metadata->>'men')::numeric,0),
          COALESCE((cf.metadata->>'men_fmp')::numeric,0)
            / NULLIF((cf.metadata->>'men')::numeric,0),
          COALESCE((cf.metadata->>'log_av45')::numeric,0)
            / NULLIF((cf.metadata->>'log')::numeric,0),
          COALESCE((cf.metadata->>'log_ap90')::numeric,0)
            / NULLIF((cf.metadata->>'log')::numeric,0),
          COALESCE((cf.metadata->>'men_surf')::numeric,0)
            / NULLIF((cf.metadata->>'men')::numeric,0)
        ]::numeric[]
      ) AS t(feat, val)
    ) t
    WHERE (cf.metadata->>'ind')::numeric > 11
      AND t.val IS NOT NULL
  ) raw
  GROUP BY feat
  ON CONFLICT (feature_name) DO UPDATE SET
    avg_value   = excluded.avg_value,
    std_value   = excluded.std_value,
    min_value   = excluded.min_value,
    max_value   = excluded.max_value,
    n_carreaux  = excluded.n_carreaux,
    computed_at = excluded.computed_at;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN format('%s features mises a jour (computed_at: %s)', n, ts);
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_filosofi_national_averages() TO service_role;
