-- ============================================================
-- 087 — RPC get_national_population_totals : totaux France par tranche d'âge
-- ============================================================
-- Appliquée le 2026-07-03 via MCP Supabase (migration `national_population_totals`).
--
-- Source : carreaux_5km (~22k lignes, colonnes directes). EXPLAIN ANALYZE :
-- seq scan ~1 s à froid — consommée par /api/custom-geo/national-totals qui
-- cache le résultat 24h côté serveur (1 appel/jour max, budget Nano préservé).
-- Buckets alignés sur audience_stats.population.by_age des zones custom.

CREATE OR REPLACE FUNCTION public.get_national_population_totals()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'total',   round(sum(ind)),
    '0_17',    round(sum(ind_0_3 + ind_4_5 + ind_6_10 + ind_11_17)),
    '18_24',   round(sum(ind_18_24)),
    '25_39',   round(sum(ind_25_39)),
    '40_54',   round(sum(ind_40_54)),
    '55_64',   round(sum(ind_55_64)),
    '65_79',   round(sum(ind_65_79)),
    '80_plus', round(sum(ind_80p))
  )
  FROM public.carreaux_5km;
$$;
