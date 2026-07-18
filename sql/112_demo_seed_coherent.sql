-- ============================================================
-- 112 — Seed démo cohérent : « élections, campagne en vol à corriger »
-- ============================================================
-- Appliqué le 2026-07-18 via MCP Supabase (durci après revue qualité).
--
-- Régénère TOUTE la démo pilotage (campagne dccc0000-…-0002, stratégie
-- dccc0000-…-0012) de façon cohérente — remplace le Frankenstein précédent.
-- REJOUABLE, ATOMIQUE (bloc DO), scopé au seul campaign_id démo.
--
-- Récit : campagne en vol (avril d'un flight 01/04→31/05, as_of = max(date)),
-- 3 problèmes cohérents :
--   1. pacing en retard (~40 % du budget à 49 % du temps → indice 0,80 → alerte)
--   2. CPM TikTok qui dérive (9,20 € vs 6,50 € — visible dans la réconciliation,
--      via geo_strategy.channels.demo_cpm lu par simulate_dsp_report, sql/111)
--   3. Marseille (13) + Lille (59) sous-délivrés à v_under_factor du plan
--      (alerte zones_under + carte « tenue du plan » rouge)
-- Fuite hors cible silencieuse (< seuil d'alerte 5 %).
--
-- Robustesse : constantes déclarées (source unique — le CPM et le budget total
-- ne sont écrits qu'une fois), garde si le plan (bidding_zone_configs) est
-- absent, et ASSERTION post-seed qui échoue si le récit ne tient pas (drift
-- muet interdit). Prérequis : rollups (107) + réconciliation (110/111) en place ;
-- le plan de bidding (bidding_zone_configs, 1641 CP cibles) est CONSERVÉ.

DO $$
DECLARE
  v_campaign     uuid := 'dccc0000-0000-4000-8000-000000000002';
  v_strategy     uuid := 'dccc0000-0000-4000-8000-000000000012';
  v_cpm          numeric := 6.50;                  -- CPM prévu = CPM ad server généré
  v_bud_dv360    numeric := 40000;
  v_bud_ttd      numeric := 10000;
  v_bud_tiktok   numeric := 15000;
  v_budget       numeric := 40000 + 10000 + 15000; -- total = somme canaux (single source)
  v_flight_start date := '2026-04-01';
  v_flight_end   date := '2026-05-31';
  v_data_end     date := '2026-04-30';             -- as_of : campagne en vol (~49 % du temps)
  v_target_imps  numeric := 3800000;               -- volume in-target sur avril
  v_under_depts  text[] := ARRAY['13','59'];        -- Marseille + Lille sous-délivrés
  v_under_factor numeric := 0.5;
  v_leak_cps     int := 400;
  v_leak_daily   int := 11;                          -- imps/jour/CP hors cible → fuite < seuil 5 %
  v_plan_cnt     int;
  v_alerts       text[];
BEGIN
  SELECT count(*) INTO v_plan_cnt
  FROM bidding_zone_configs WHERE strategy_id = v_strategy AND is_active AND bid_multiplier > 0;
  IF v_plan_cnt = 0 THEN
    RAISE EXCEPTION 'Seed démo : plan absent pour la stratégie % (applique d''abord le plan de bidding).', v_strategy;
  END IF;

  -- 1) Campagne : identité, dates, canaux + demo_cpm (dérive TikTok 9,20).
  UPDATE dsp_campaigns SET
    name = 'Démo pilotage — élections',
    advertiser = 'Annonceur institutionnel', product = 'Sensibilisation électorale',
    date_start = v_flight_start, date_end = v_flight_end, is_demo = true,
    geo_strategy = jsonb_set(COALESCE(geo_strategy, '{}'::jsonb), '{channels}', jsonb_build_object(
      'dsps', jsonb_build_array('dv360','ttd'), 'socials', jsonb_build_array('tiktok'),
      'ad_server', 'cm360',
      'links', jsonb_build_object(
        'dv360', jsonb_build_object('advertiser_id','111111','advertiser_name','Annonceur institutionnel',
                 'campaign_id','222222','campaign_name','Vague printemps',
                 'insertion_order_id','333333','insertion_order_name','IO principale'),
        'tiktok', jsonb_build_object('advertiser_id','tt-444444')),
      'budgets', jsonb_build_object('dv360', v_bud_dv360, 'ttd', v_bud_ttd, 'tiktok', v_bud_tiktok),
      -- demo_cpm : override par canal lu par simulate_dsp_report (≠ défauts de la fonction).
      'demo_cpm', jsonb_build_object('dv360', 6.30, 'ttd', 6.60, 'tiktok', 9.20)))
  WHERE id = v_campaign;

  -- 2) Stratégie : budget = somme canaux, CPM prévu, dates alignées, active.
  UPDATE bidding_strategies SET
    total_budget = v_budget, forecast_cpm = v_cpm,
    start_date = v_flight_start, end_date = v_flight_end, status = 'active'
  WHERE id = v_strategy;

  -- 3) Ad server : délivrance qui SUIT le plan (imps ∝ bid_multiplier), sauf
  --    Marseille+Lille à v_under_factor, + fuite marginale. 1 passe, 1 INSERT.
  DELETE FROM dsp_campaign_data WHERE campaign_id = v_campaign;

  INSERT INTO dsp_campaign_data (campaign_id, date, postal_code, country, media, impressions, clicks, spend, dsp_source)
  WITH zones AS (
    SELECT z.postal_code, z.bid_multiplier AS bm, (z.bid_multiplier > 0) AS in_target,
           CASE WHEN LEFT(z.postal_code, 2) = ANY(v_under_depts) THEN v_under_factor ELSE 1.0 END AS factor
    FROM bidding_zone_configs z
    JOIN ref_codes_postaux rcp ON rcp.code_postal = z.postal_code
    WHERE z.strategy_id = v_strategy AND z.is_active AND rcp.geom_simplified IS NOT NULL
  ),
  gen AS (
    -- in-target : part fenêtrée du volume, réparti plat sur les jours d'avril
    SELECT postal_code,
           round(v_target_imps * (bm*factor) / NULLIF(SUM(bm*factor) OVER (), 0) / 30.0)::int AS day_imps
    FROM zones WHERE in_target
    UNION ALL
    -- fuite : v_leak_cps CP hors cible à v_leak_daily imps/jour (déterministe via md5)
    SELECT postal_code, v_leak_daily
    FROM (SELECT postal_code FROM zones WHERE NOT in_target ORDER BY md5(postal_code) LIMIT v_leak_cps) l
  )
  SELECT v_campaign, d::date, gen.postal_code, 'France', 'Display',
         gen.day_imps, round(gen.day_imps * 0.002)::int, round(gen.day_imps * v_cpm / 1000.0, 2), 'ttd'
  FROM gen CROSS JOIN generate_series(v_flight_start, v_data_end, '1 day') d;

  -- 4) rollups + 5) rapport DSP : délégués aux RPC (pas de ré-agrégation ici).
  PERFORM public.refresh_campaign_rollups(v_campaign);
  PERFORM public.simulate_dsp_report(v_campaign);

  -- Assertion : le récit doit tenir (drift muet interdit sur une démo rejouable).
  SELECT array_agg(a->>'kind') INTO v_alerts
  FROM jsonb_array_elements(public.get_campaign_suivi(v_campaign) -> 'alerts') a;
  IF NOT ('pacing' = ANY(v_alerts) AND 'zones_under' = ANY(v_alerts)) THEN
    RAISE EXCEPTION 'Seed incohérent : alertes attendues (pacing + zones_under) absentes → %', v_alerts;
  END IF;
  IF 'leak' = ANY(v_alerts) THEN
    RAISE EXCEPTION 'Seed incohérent : fuite hors cible au-dessus du seuil (alerte leak présente).';
  END IF;
END $$;
