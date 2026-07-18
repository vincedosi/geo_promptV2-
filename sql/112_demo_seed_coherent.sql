-- ============================================================
-- 112 — Seed démo cohérent : « élections, campagne en vol à corriger »
-- ============================================================
-- Appliqué le 2026-07-18 via MCP Supabase.
--
-- Régénère TOUTE la démo pilotage (campagne dccc0000-…-0002, stratégie
-- dccc0000-…-0012) de façon cohérente — remplace le Frankenstein précédent
-- (budget 600k vs canaux 52k, dates désalignées, délivrance nationale plaquée
-- sur zones strictes). REJOUABLE et scopé au seul campaign_id démo.
--
-- Récit : campagne en vol (avril d'un flight 01/04→31/05), 3 problèmes cohérents
--   1. pacing en retard (26 000 € = 40 % du budget à 49 % du temps → alerte)
--   2. CPM TikTok qui dérive (9,20 € vs 6,50 € — visible dans la réconciliation)
--   3. Marseille (13) + Lille (59) sous-délivrés à ~50 % du plan (alerte + carte)
-- Le plan (bidding_zone_configs, 1641 CP cibles sur base abstention) est CONSERVÉ.
-- Prérequis : rollups (107), réconciliation (110/111) déjà en place ;
-- simulate_dsp_report lit geo_strategy.channels.demo_cpm (cf. sql/111).

-- 1) Campagne : identité, dates, canaux (dv360/ttd/tiktok, budgets = 65 000,
--    demo_cpm pour la dérive TikTok), meta retiré.
UPDATE dsp_campaigns SET
  name = 'Démo pilotage — élections',
  advertiser = 'Annonceur institutionnel',
  product = 'Sensibilisation électorale',
  date_start = '2026-04-01', date_end = '2026-05-31',
  is_demo = true,
  geo_strategy = jsonb_set(
    COALESCE(geo_strategy, '{}'::jsonb), '{channels}',
    jsonb_build_object(
      'dsps', jsonb_build_array('dv360','ttd'),
      'socials', jsonb_build_array('tiktok'),
      'ad_server', 'cm360',
      'links', jsonb_build_object(
        'dv360', jsonb_build_object('advertiser_id','111111','advertiser_name','Annonceur institutionnel',
                 'campaign_id','222222','campaign_name','Vague printemps',
                 'insertion_order_id','333333','insertion_order_name','IO principale'),
        'tiktok', jsonb_build_object('advertiser_id','tt-444444')),
      'budgets', jsonb_build_object('dv360',40000,'ttd',10000,'tiktok',15000),
      'demo_cpm', jsonb_build_object('dv360',6.30,'ttd',6.60,'tiktok',9.20)))
WHERE id = 'dccc0000-0000-4000-8000-000000000002';

-- 2) Stratégie : budget = somme canaux, CPM prévu, dates alignées, active.
UPDATE bidding_strategies SET
  total_budget = 65000, forecast_cpm = 6.50,
  start_date = '2026-04-01', end_date = '2026-05-31', status = 'active'
WHERE id = 'dccc0000-0000-4000-8000-000000000012';

-- 3) Ad server (dsp_campaign_data) : délivrance qui SUIT le plan (imps ∝
--    bid_multiplier), sauf Marseille (13) + Lille (59) à 50 %, + fuite marginale.
DELETE FROM dsp_campaign_data WHERE campaign_id = 'dccc0000-0000-4000-8000-000000000002';

-- 3a) In-target : 3,8 M imps répartis ∝ (bid_multiplier × facteur), plat sur avril.
WITH plan AS (
  SELECT z.postal_code, z.bid_multiplier AS bm,
         CASE WHEN LEFT(z.postal_code,2) IN ('13','59') THEN 0.5 ELSE 1.0 END AS factor
  FROM bidding_zone_configs z
  JOIN ref_codes_postaux rcp ON rcp.code_postal = z.postal_code
  WHERE z.strategy_id='dccc0000-0000-4000-8000-000000000012' AND z.is_active
    AND z.bid_multiplier > 0 AND rcp.geom_simplified IS NOT NULL
),
tot AS (SELECT SUM(bm*factor) AS sw FROM plan),
per_cp AS (
  SELECT p.postal_code, 3800000.0 * (p.bm*p.factor) / t.sw AS cp_total FROM plan p CROSS JOIN tot t
)
INSERT INTO dsp_campaign_data (campaign_id, date, postal_code, country, media, impressions, clicks, spend, dsp_source)
SELECT 'dccc0000-0000-4000-8000-000000000002', d::date, pc.postal_code, 'France', 'Display',
       round(pc.cp_total/30.0)::int,
       round(pc.cp_total/30.0 * 0.002)::int,
       round(pc.cp_total/30.0 * 6.50/1000.0, 2),
       'ttd'
FROM per_cp pc
CROSS JOIN generate_series('2026-04-01'::date, '2026-04-30'::date, '1 day') d;

-- 3b) Fuite hors cible : ~3,4 % du volume sur 400 CP hors cible (< seuil d'alerte 5 %).
WITH leak AS (
  SELECT z.postal_code
  FROM bidding_zone_configs z
  JOIN ref_codes_postaux rcp ON rcp.code_postal = z.postal_code
  WHERE z.strategy_id='dccc0000-0000-4000-8000-000000000012' AND z.is_active
    AND z.bid_multiplier = 0 AND rcp.geom_simplified IS NOT NULL
  ORDER BY md5(z.postal_code) LIMIT 400
)
INSERT INTO dsp_campaign_data (campaign_id, date, postal_code, country, media, impressions, clicks, spend, dsp_source)
SELECT 'dccc0000-0000-4000-8000-000000000002', d::date, leak.postal_code, 'France', 'Display',
       11, 0, round(11 * 6.50/1000.0, 2), 'ttd'
FROM leak CROSS JOIN generate_series('2026-04-01'::date, '2026-04-30'::date, '1 day') d;

-- 4) Rollups de suivi (depuis l'ad server, avec in_target/planned_share du plan).
SELECT public.refresh_campaign_rollups('dccc0000-0000-4000-8000-000000000002');

-- 5) Rapport DSP (buy side) : split par budget, CPM par canal via demo_cpm (TikTok 9,20).
SELECT public.simulate_dsp_report('dccc0000-0000-4000-8000-000000000002');
