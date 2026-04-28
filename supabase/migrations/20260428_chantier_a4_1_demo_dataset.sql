-- =====================================================================
-- Chantier A4.1 — Dataset démo "Renault Captur Mars 2026"
-- =====================================================================
-- Reproduit le ttd_test_dataset.csv via génération SQL déterministe :
--   - 4 tiers de zones (premium_urban / urban / suburban / rural)
--   - 30 jours (2026-03-01 → 2026-03-30)
--   - drift J+15 sur les zones rurales (concurrent push, hausse CPL)
--   - random.seed(42) reproduit via setseed(-0.5) + filtrage bid_requests > 1000
-- Volumes après import (mesurés) :
--   ~4078 lignes / 136 CPs / 30 jours / 16.47M impressions / 7401 leads

DO $$
DECLARE
  v_campaign_id UUID;
  v_strategy_id UUID;
  v_admin_id UUID;
BEGIN
  PERFORM setseed(-0.5);

  SELECT id INTO v_admin_id FROM public.profiles WHERE email = 'admin@geoprompt.com' LIMIT 1;

  INSERT INTO public.dsp_campaigns
    (name, advertiser, dsp_source, date_start, date_end,
     kpi_primary, kpi_target, total_budget, currency,
     is_demo, geo_strategy, total_tracked_ads, total_unique_impressions,
     countries, created_by, organization_id)
  VALUES
    ('Renault Captur — Mars 2026 (Demo Pitch)',
     'Renault', 'ttd', '2026-03-01', '2026-03-30',
     'leads', 12.5, 250000, 'EUR',
     true,
     '{"priority_zones":[
       {"name":"Paris","postal_codes":["75001","75002","75003","75004","75005","75006","75007","75008","75009","75010","75011","75016","75017"]},
       {"name":"Lyon","postal_codes":["69001","69002","69003","69006","69007"]},
       {"name":"Marseille","postal_codes":["13001","13002","13006","13008"]}
     ]}'::jsonb,
     0, 0, ARRAY['France'],
     v_admin_id, '00000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_campaign_id;

  INSERT INTO public.campaign_organizations (campaign_id, organization_id, added_by)
  VALUES (v_campaign_id, '00000000-0000-0000-0000-000000000001', v_admin_id)
  ON CONFLICT DO NOTHING;

  WITH tiers AS (
    SELECT 'premium_urban'::text AS tier, code, 145000.0 AS br_mean, 25000.0 AS br_std,
           0.068 AS win_rate, 0.82 AS view_rate, 0.0072 AS ctr, 0.0042 AS visit_rate, 0.00055 AS lead_rate, 2.85 AS cpm
    FROM unnest(ARRAY['75001','75002','75003','75004','75005','75006','75007','75008','75009','75010','75011','75016','75017']) AS code
    UNION ALL
    SELECT 'urban', code, 95000.0, 18000.0, 0.078, 0.78, 0.0065, 0.0038, 0.00048, 2.40
    FROM unnest(ARRAY['69001','69002','69003','69006','69007','13001','13002','13006','13008','33000','33200','33300','59000','59800','59100']) AS code
    UNION ALL
    SELECT 'suburban', code, 62000.0, 12000.0, 0.092, 0.74, 0.0058, 0.0034, 0.00042, 1.95
    FROM unnest(ARRAY['92100','92200','92300','92400','94200','94300','93100','93200','78000','78100','91000','95100','95200','69100','69300','69500','13100','13700','13800','33700','33600','59290','59650']) AS code
    UNION ALL
    SELECT 'rural', code, 18000.0, 5000.0, 0.115, 0.69, 0.0045, 0.0026, 0.00031, 1.55
    FROM unnest(ARRAY[
      '01100','01200','02100','02200','03100','03200','04100','05100','06400','07100',
      '08100','09100','10100','12100','14100','15100','16100','17100','18100','19100',
      '21100','22100','23100','24100','25100','26100','27100','28100','29100','30100',
      '31100','32100','34100','35100','36100','37100','38100','39100','40100','41100',
      '42100','43100','44100','45100','46100','47100','48100','49100','50100','51100',
      '52100','53100','54100','55100','56100','57100','58100','60100','61100','62100',
      '63100','64100','65100','66100','67100','68100','70100','71100','72100','73100',
      '74100','76100','77100','79100','80100','81100','82100','83100','84100','85100',
      '86100','87100','88100','89100','90000']) AS code
  ),
  days AS (
    SELECT generate_series('2026-03-01'::date, '2026-03-30'::date, '1 day') AS d
  ),
  cells AS (
    SELECT
      t.tier, t.code AS postal_code, d.d AS date,
      EXTRACT(DOW FROM d.d)::int AS dow,
      CASE WHEN t.tier = 'rural' AND d.d >= '2026-03-16'::date THEN 0.85 ELSE 1.0 END AS drift_factor,
      CASE
        WHEN EXTRACT(DOW FROM d.d) IN (0, 6) THEN 1.15
        WHEN EXTRACT(DOW FROM d.d) = 1 THEN 0.92
        ELSE 1.0
      END AS day_factor,
      t.br_mean, t.br_std, t.win_rate, t.view_rate, t.ctr, t.visit_rate, t.lead_rate, t.cpm,
      ((random() + random() + random() + random() + random() + random()
       + random() + random() + random() + random() + random() + random()) - 6.0) AS noise
    FROM tiers t CROSS JOIN days d
  ),
  generated AS (
    SELECT
      postal_code, date, tier,
      GREATEST(0, ROUND(br_mean * day_factor + noise * br_std))::bigint AS bid_requests
    FROM cells
  ),
  filtered AS (
    SELECT g.*, c.win_rate, c.view_rate, c.ctr, c.visit_rate, c.lead_rate, c.cpm, c.drift_factor
    FROM generated g
    JOIN cells c USING (postal_code, date, tier)
    WHERE g.bid_requests > 1000
  )
  INSERT INTO public.dsp_campaign_data
    (campaign_id, country, postal_code, date, dsp_source, media,
     impressions, clicks, spend, metrics)
  SELECT
    v_campaign_id, 'France', f.postal_code, f.date, 'ttd',
    'TTD Open Exchange',
    GREATEST(0, ROUND(f.bid_requests * f.win_rate * f.drift_factor))::bigint,
    GREATEST(0, ROUND(f.bid_requests * f.win_rate * f.drift_factor * f.ctr))::bigint,
    ROUND(
      (f.bid_requests * f.win_rate * f.drift_factor * f.cpm / 1000.0)::numeric *
      CASE WHEN f.tier='rural' AND f.date >= '2026-03-16'::date THEN 1.18 ELSE 1.0 END
    , 4),
    jsonb_build_object(
      'tier', f.tier,
      'bid_requests', f.bid_requests,
      'bid_won', GREATEST(0, ROUND(f.bid_requests * f.win_rate * f.drift_factor))::bigint,
      'viewable_impressions', GREATEST(0, ROUND(f.bid_requests * f.win_rate * f.drift_factor * f.view_rate))::bigint,
      'unique_users', GREATEST(0, ROUND(f.bid_requests * f.win_rate * f.drift_factor * 0.62))::bigint,
      'visits', GREATEST(0, ROUND(f.bid_requests * f.win_rate * f.drift_factor * f.visit_rate))::int,
      'leads', GREATEST(0, ROUND(f.bid_requests * f.win_rate * f.drift_factor * f.lead_rate))::int
    )
  FROM filtered f;

  PERFORM public.match_campaign_postal_to_iris(v_campaign_id);

  INSERT INTO public.bidding_strategies
    (name, description, campaign_id, algorithm_code, objective_code, scope_type,
     status, is_demo, start_date, end_date, created_by)
  VALUES (
    'Pitch Demo — Maximize Leads (Hoeffding)',
    'Stratégie démo pour le pitch Custom Bidding. Maximise les leads via Hoeffding Adaptive Tree.',
    v_campaign_id,
    'hoeffding_adaptive_tree',
    'maximize_leads',
    'national',
    'completed',
    true,
    '2026-03-01', '2026-03-30',
    v_admin_id
  )
  RETURNING id INTO v_strategy_id;

  INSERT INTO public.bidding_drift_events
    (strategy_id, postal_code, drift_type, severity, detected_at,
     metric_before, metric_after, delta, threshold, description, auto_action)
  VALUES
    (v_strategy_id, '01100', 'performance_drift', 'medium', '2026-03-16 10:00:00+00',
     '{"cpl":5.58}'::jsonb, '{"cpl":5.85}'::jsonb, 4.84, 3.0,
     'Hausse CPL zones rurales détectée — concurrent push',
     'alert'),
    (v_strategy_id, '15100', 'performance_drift', 'medium', '2026-03-17 09:00:00+00',
     '{"cpl":5.62}'::jsonb, '{"cpl":5.91}'::jsonb, 5.16, 3.0,
     'Hausse CPL zones rurales détectée',
     'alert'),
    (v_strategy_id, NULL, 'data_drift', 'low', '2026-03-20 14:00:00+00',
     '{"feature":"win_rate_rural","value":0.115}'::jsonb,
     '{"feature":"win_rate_rural","value":0.098}'::jsonb,
     -14.78, 10.0,
     'Drift global : baisse win rate rural cumulée',
     'alert');

  UPDATE public.dsp_campaigns SET
    total_tracked_ads = COALESCE((SELECT SUM(impressions) FROM public.dsp_campaign_data WHERE campaign_id = v_campaign_id), 0),
    total_unique_impressions = COALESCE((SELECT SUM((metrics->>'unique_users')::bigint) FROM public.dsp_campaign_data WHERE campaign_id = v_campaign_id), 0)
  WHERE id = v_campaign_id;

  RAISE NOTICE 'Campaign demo created: % | strategy: %', v_campaign_id, v_strategy_id;
END $$;
