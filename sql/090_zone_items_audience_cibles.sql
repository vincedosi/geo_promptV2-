-- ============================================================
-- 090 — compute_zone_items_audience v5 + get_national_population_totals v2
--        Cibles ménages/logement dans le plan média + sortie « values » à plat
-- ============================================================
-- Appliquée le 2026-07-03 via MCP Supabase (migrations zone_items_audience_v5_cibles,
-- national_totals_v2_cibles).
--
-- compute_zone_items_audience renvoie désormais un objet `values` à plat par item
-- (total + tranches d'âge + men, men_prop, men_fmp, men_pauv, log_soc) au lieu de
-- population.by_age. get_national_population_totals ajoute les mêmes clés ménages/
-- logement (colonnes directes carreaux_5km) pour la colonne « % France ».
-- Après déploiement : items_audience_stats des zones existantes remis à NULL pour
-- forcer le recalcul avec les nouveaux champs.
-- Non disponible en cible : CSP (absente des carreaux Filosofi), revenu (médiane,
-- pas un volume) — restent des caractéristiques de zone, pas des cibles d'audience.
--
-- Définitions complètes : migrations Supabase `zone_items_audience_v5_cibles` et
-- `national_totals_v2_cibles` (fonctions compute_zone_items_audience /
-- get_national_population_totals).

CREATE OR REPLACE FUNCTION public.get_national_population_totals()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'total', round(sum(ind)),
    '0_17', round(sum(ind_0_3 + ind_4_5 + ind_6_10 + ind_11_17)),
    '18_24', round(sum(ind_18_24)), '25_39', round(sum(ind_25_39)),
    '40_54', round(sum(ind_40_54)), '55_64', round(sum(ind_55_64)),
    '65_79', round(sum(ind_65_79)), '80_plus', round(sum(ind_80p)),
    'men', round(sum(men)), 'men_prop', round(sum(men_prop)),
    'men_fmp', round(sum(men_fmp)), 'men_pauv', round(sum(men_pauv)),
    'log_soc', round(sum(log_soc))
  ) FROM public.carreaux_5km;
$$;

-- compute_zone_items_audience v5 : définition identique à la migration Supabase
-- `zone_items_audience_v5_cibles` (voir corps complet en base). Sortie par item :
--   { poi_id, poi_name, area_km2, carreaux_count,
--     values: { total, 0_17..80_plus, men, men_prop, men_fmp, men_pauv, log_soc } }
-- Moteur : ST_SimplifyPreserveTopology(0.0005) + ST_Subdivide(128) +
-- ST_Contains(part, ST_Centroid(carreau 200m)). Caps : 20 items, 5000 km².
