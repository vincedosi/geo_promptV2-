-- ============================================================
-- 112 — Seed démo cohérent : « élections, campagne en vol à corriger »
-- ============================================================
-- Appliqué le 2026-07-18 via MCP Supabase (durci après revue qualité).
-- Re-tuné le 2026-07-23 : CPM mesuré PAR ACTEUR (TikTok 9,20 € vs ~5,7-6,3 €),
-- moyenne pondérée = 6,50 € → cockpit/pacing/réconciliation inchangés ; la démo
-- « vue par acteur » montre enfin l'acteur dont le CPM dérape (+ 2 assertions).
--
-- Régénère TOUTE la démo pilotage (campagne dccc0000-…-0002, stratégie
-- dccc0000-…-0012) de façon cohérente — remplace le Frankenstein précédent.
-- REJOUABLE, ATOMIQUE (bloc DO), scopé au seul campaign_id démo.
--
-- Récit : campagne en vol (avril d'un flight 01/04→31/05, as_of = max(date)),
-- 3 problèmes cohérents :
--   1. pacing en retard (~40 % du budget à 49 % du temps → indice 0,80 → alerte)
--   2. CPM TikTok qui dérive (9,20 € vs 6,50 €), visible sur DEUX plans :
--      - mesuré / ad server : CPM par acteur dans le seed (moyenne pondérée par
--        les parts = 6,50 € → cockpit/pacing intacts), lu par get_campaign_actors
--        → le panneau « Par acteur » montre TikTok à 9,20 € vs ~5,7-6,3 € ailleurs,
--        et filtrer TikTok fait remonter l'alerte CPM du suivi (>forecast×1,25).
--      - déclaré / DSP : geo_strategy.channels.demo_cpm lu par simulate_dsp_report
--        (sql/116) → réconciliation. Les deux sources restent découplées.
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
  -- Attribution acteur (chemin complet vue par acteur) : parts (w) sommant à 1,
  -- + CPM mesuré par acteur (cpm). dsp/social = canaux déclarés ; 2 régies en
  -- direct (noms génériques). INVARIANT : Σ(w × cpm) = v_cpm (6,50) → le spend
  -- total, le pacing et la tuile CPM cockpit (non filtrée) sont inchangés ; seule
  -- la RÉPARTITION du spend entre acteurs change. TikTok dérape à 9,20 €, les
  -- autres compensent sous 6,50 € (l'assertion de fin verrouille les deux).
  v_actors jsonb := jsonb_build_array(
    jsonb_build_object('actor', 'dv360',                 'w', 0.45, 'cpm', 5.90),
    jsonb_build_object('actor', 'ttd',                   'w', 0.11, 'cpm', 6.20),
    jsonb_build_object('actor', 'tiktok',                'w', 0.17, 'cpm', 9.20),
    jsonb_build_object('actor', 'Régie presse régionale','w', 0.17, 'cpm', 5.70),
    jsonb_build_object('actor', 'Régie TV connectée',    'w', 0.10, 'cpm', 6.30));
  v_max_cpm_actor text; v_max_cpm numeric; v_global_cpm numeric;
  v_n_actors int; v_regie_ok bool;
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

  INSERT INTO dsp_campaign_data (campaign_id, date, postal_code, country, media, actor, impressions, clicks, spend, dsp_source)
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
  ),
  act AS (SELECT value->>'actor' AS actor, (value->>'w')::numeric AS w,
                 (value->>'cpm')::numeric AS cpm FROM jsonb_array_elements(v_actors))
  SELECT v_campaign, d::date, gen.postal_code, 'France', 'Display', act.actor,
         round(gen.day_imps * act.w)::int,
         round(gen.day_imps * act.w * 0.002)::int,
         -- spend = imps acteur × CPM acteur (mesuré) ; moyenne pondérée = v_cpm.
         round(gen.day_imps * act.w * act.cpm / 1000.0, 2), 'ttd'
  FROM gen CROSS JOIN generate_series(v_flight_start, v_data_end, '1 day') d CROSS JOIN act;

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

  -- Assertion vue par acteur : ≥ 4 acteurs dont ≥ 1 régie.
  SELECT jsonb_array_length(a -> 'actors'),
         EXISTS (SELECT 1 FROM jsonb_array_elements(a -> 'actors') x WHERE x->>'kind' = 'régie')
  INTO v_n_actors, v_regie_ok
  FROM (SELECT public.get_campaign_actors(v_campaign) AS a) q;
  IF v_n_actors < 4 OR NOT v_regie_ok THEN
    RAISE EXCEPTION 'Seed incohérent : attendu ≥ 4 acteurs dont ≥ 1 régie (obtenu % acteurs, régie=%).', v_n_actors, v_regie_ok;
  END IF;

  -- Assertion CPM par acteur : TikTok doit être l'acteur le plus cher et dériver
  -- au-delà du seuil d'alerte (forecast × 1,25 = 8,125) → le panneau « Par acteur »
  -- raconte l'histoire, et filtrer TikTok fait remonter l'alerte CPM du suivi.
  SELECT x->>'actor', (x->>'cpm')::numeric
  INTO v_max_cpm_actor, v_max_cpm
  FROM jsonb_array_elements(public.get_campaign_actors(v_campaign) -> 'actors') x
  ORDER BY (x->>'cpm')::numeric DESC LIMIT 1;
  IF v_max_cpm_actor IS DISTINCT FROM 'tiktok' OR v_max_cpm < v_cpm * 1.25 THEN
    RAISE EXCEPTION 'Seed incohérent : TikTok attendu acteur CPM max au-dessus du seuil d''alerte (obtenu %=% €, seuil % €).',
      v_max_cpm_actor, v_max_cpm, ROUND(v_cpm * 1.25, 2);
  END IF;

  -- Assertion non-régression cockpit : la tuile CPM (suivi non filtré) reste ~6,50
  -- (la moyenne pondérée par acteur ne doit PAS avoir bougé la vue globale).
  v_global_cpm := (public.get_campaign_suivi(v_campaign) -> 'cpm' ->> 'real')::numeric;
  IF v_global_cpm IS NULL OR v_global_cpm < v_cpm - 0.05 OR v_global_cpm > v_cpm + 0.05 THEN
    RAISE EXCEPTION 'Seed incohérent : CPM cockpit global % € hors de [% ; %] (dérive de la moyenne pondérée).',
      v_global_cpm, v_cpm - 0.05, v_cpm + 0.05;
  END IF;
END $$;
