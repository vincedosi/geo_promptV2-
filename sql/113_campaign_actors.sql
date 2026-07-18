-- ============================================================
-- 113 — Dimension « acteur » du suivi campagne (vue par acteur)
-- ============================================================
-- Appliquée le 2026-07-18 via MCP Supabase. L'ad server devient la source
-- unifiée : chaque impression porte un `actor`. Rollups per-acteur ; RPC de
-- lecture filtrables par `p_actors` (NULL = tous, non-régression). Réconciliation
-- DSP inchangée (secondaire). Prérequis : 107 (rollups), 108 (suivi), 109 (map/cps).

-- 1) Colonnes actor. dsp_campaign_data : nullable (peuplé au tag/ingestion, ou
--    par le seed démo). Rollups : NOT NULL DEFAULT '' (entrent dans la PK).
ALTER TABLE public.dsp_campaign_data   ADD COLUMN IF NOT EXISTS actor text;
ALTER TABLE public.campaign_daily_rollup ADD COLUMN IF NOT EXISTS actor text NOT NULL DEFAULT '';
ALTER TABLE public.campaign_cp_rollup    ADD COLUMN IF NOT EXISTS actor text NOT NULL DEFAULT '';

ALTER TABLE public.campaign_daily_rollup DROP CONSTRAINT IF EXISTS campaign_daily_rollup_pkey;
ALTER TABLE public.campaign_daily_rollup ADD  PRIMARY KEY (campaign_id, date, media, actor);
ALTER TABLE public.campaign_cp_rollup    DROP CONSTRAINT IF EXISTS campaign_cp_rollup_pkey;
ALTER TABLE public.campaign_cp_rollup    ADD  PRIMARY KEY (campaign_id, postal_code, actor);

-- 2) refresh_campaign_rollups : ajoute `actor` (COALESCE(d.actor,'')) aux GROUP BY.
CREATE OR REPLACE FUNCTION public.refresh_campaign_rollups(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_source text; v_as_of date; v_strategy_id uuid; v_out_mode text;
  v_daily int := 0; v_cp int := 0;
BEGIN
  SELECT dsp_source INTO v_source FROM dsp_campaigns WHERE id = p_campaign_id;
  IF v_source IS NULL THEN RETURN jsonb_build_object('error', 'campaign_not_found'); END IF;

  DELETE FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;
  INSERT INTO campaign_daily_rollup (campaign_id, date, media, actor, impressions, clicks, spend)
  SELECT p_campaign_id, d.date, COALESCE(d.media, ''), COALESCE(d.actor, ''),
         SUM(CASE WHEN v_source = 'adform' THEN COALESCE(d.tracked_ads, 0)
                  ELSE COALESCE(NULLIF(d.impressions, 0), d.tracked_ads, 0) END),
         SUM(COALESCE(d.clicks, 0)), SUM(COALESCE(d.spend, 0))
  FROM dsp_campaign_data d
  WHERE d.campaign_id = p_campaign_id AND d.date IS NOT NULL
  GROUP BY d.date, COALESCE(d.media, ''), COALESCE(d.actor, '');
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  SELECT MAX(date) INTO v_as_of FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;

  SELECT s.id, s.out_zone_weights->>'mode' INTO v_strategy_id, v_out_mode
  FROM bidding_strategies s WHERE s.campaign_id = p_campaign_id ORDER BY s.created_at DESC LIMIT 1;

  DELETE FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id;
  INSERT INTO campaign_cp_rollup
    (campaign_id, postal_code, actor, dept, impressions, clicks, spend,
     imps_7d, imps_prev7d, in_target, planned_share)
  WITH raw AS (
    SELECT d.postal_code, COALESCE(d.actor, '') AS actor, d.date,
           CASE WHEN v_source = 'adform' THEN COALESCE(d.tracked_ads, 0)
                ELSE COALESCE(NULLIF(d.impressions, 0), d.tracked_ads, 0) END AS imp,
           COALESCE(d.clicks, 0) AS clk, COALESCE(d.spend, 0) AS sp
    FROM dsp_campaign_data d
    WHERE d.campaign_id = p_campaign_id AND d.postal_code IS NOT NULL
  ),
  plan AS (
    SELECT z.postal_code,
           z.bid_multiplier / NULLIF(SUM(z.bid_multiplier) OVER (), 0) AS planned_share,
           CASE WHEN v_out_mode = 'exclusion' THEN z.bid_multiplier > 0 ELSE z.bid_multiplier > 1 END AS in_target
    FROM bidding_zone_configs z WHERE z.strategy_id = v_strategy_id AND z.is_active
  )
  SELECT p_campaign_id, r.postal_code, r.actor, LEFT(r.postal_code, 2),
         SUM(r.imp), SUM(r.clk), SUM(r.sp),
         COALESCE(SUM(r.imp) FILTER (WHERE r.date > v_as_of - 7), 0),
         COALESCE(SUM(r.imp) FILTER (WHERE r.date <= v_as_of - 7 AND r.date > v_as_of - 14), 0),
         COALESCE(BOOL_OR(p.in_target), false), MAX(p.planned_share)
  FROM raw r LEFT JOIN plan p ON p.postal_code = r.postal_code
  GROUP BY r.postal_code, r.actor;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp, 'as_of', v_as_of);
END; $$;
REVOKE ALL ON FUNCTION public.refresh_campaign_rollups(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_rollups(uuid) TO service_role;

-- 3) Helper : objectif global proratisé (single source pour suivi/map/cps).
--    Indépendant de p_actors (l'objectif est celui de la campagne entière).
CREATE OR REPLACE FUNCTION public.get_campaign_expected(p_campaign_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE s record; v_as_of date; v_time numeric; v_expected numeric;
BEGIN
  SELECT s2.total_budget, s2.forecast_cpm, s2.start_date, s2.end_date, s2.kpi_target, s2.objective_code
  INTO s FROM bidding_strategies s2 WHERE s2.campaign_id = p_campaign_id
  ORDER BY s2.created_at DESC LIMIT 1;
  IF s IS NULL THEN RETURN NULL; END IF;
  SELECT MAX(date) INTO v_as_of FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;
  IF v_as_of IS NULL OR s.start_date IS NULL OR s.end_date IS NULL OR s.end_date <= s.start_date THEN
    RETURN NULL; END IF;
  v_time := LEAST(1, GREATEST(0, (v_as_of - s.start_date + 1)::numeric / (s.end_date - s.start_date + 1)));
  IF s.kpi_target IS NOT NULL AND s.kpi_target > 0 AND s.objective_code = 'maximize_impressions' THEN
    v_expected := s.kpi_target * v_time;
  ELSIF s.total_budget IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_expected := s.total_budget * v_time / s.forecast_cpm * 1000;
  END IF;
  RETURN v_expected;
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_expected(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_expected(uuid) TO service_role;

-- 4) get_campaign_suivi : + p_actors (filtre), + objective_alignment/objective_zones.
--    Sommes de délivrance filtrées par acteur ; parts/spend planifiés = PLAN
--    (non filtrés). CTE `cp` = collapse par CP avec délivrance FILTRÉE dans le
--    SUM (les CP à 0 délivrance restent, planned_share conservé → alignment juste).
CREATE OR REPLACE FUNCTION public.get_campaign_suivi(p_campaign_id uuid, p_actors text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  s record;
  v_as_of date; v_spend numeric := 0; v_imps bigint := 0;
  v_budget_pct numeric; v_time_pct numeric; v_index numeric;
  v_cpm_real numeric; v_cpm_delta numeric;
  v_cp_total_imps bigint := 0; v_in_imps bigint := 0; v_in_spend numeric := 0;
  v_out_imps bigint := 0; v_out_spend numeric := 0; v_in_planned numeric := 0;
  v_in_share numeric; v_out_share numeric;
  v_plan_in_cps int := 0; v_plan_out_cps int := 0;
  v_requested numeric; v_obtained numeric;
  v_realized bigint; v_expected numeric; v_obj_pct numeric; v_obj_basis text;
  v_zones_under int := 0; v_zones_over int := 0;
  v_alerts jsonb := '[]'::jsonb;
  v_level1 jsonb; v_depts jsonb; v_daily jsonb; v_medias jsonb;
  v_under record;
BEGIN
  SELECT s2.id, s2.total_budget, s2.forecast_cpm, s2.start_date, s2.end_date,
         s2.out_zone_weights->>'mode' AS out_mode, s2.kpi_target, s2.objective_code
  INTO s FROM bidding_strategies s2 WHERE s2.campaign_id = p_campaign_id
  ORDER BY s2.created_at DESC LIMIT 1;
  IF s.id IS NULL THEN RETURN jsonb_build_object('error', 'no_strategy'); END IF;

  -- Daily (filtré par acteur)
  SELECT MAX(date), COALESCE(SUM(spend), 0), COALESCE(SUM(impressions), 0)
  INTO v_as_of, v_spend, v_imps
  FROM campaign_daily_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));
  IF v_as_of IS NULL THEN RETURN jsonb_build_object('error', 'no_rollup'); END IF;

  IF s.start_date IS NOT NULL AND s.end_date IS NOT NULL AND s.end_date > s.start_date THEN
    v_time_pct := ROUND(LEAST(1, GREATEST(0,
      (v_as_of - s.start_date + 1)::numeric / (s.end_date - s.start_date + 1))) * 100, 1);
  END IF;
  IF s.total_budget IS NOT NULL AND s.total_budget > 0 THEN
    v_budget_pct := ROUND(v_spend / s.total_budget * 100, 1);
  END IF;
  IF v_budget_pct IS NOT NULL AND COALESCE(v_time_pct, 0) > 0 THEN
    v_index := ROUND(v_budget_pct / v_time_pct, 2);
  END IF;

  IF v_imps > 0 THEN v_cpm_real := ROUND(v_spend / v_imps * 1000, 2); END IF;
  IF v_cpm_real IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_cpm_delta := ROUND((v_cpm_real - s.forecast_cpm) / s.forecast_cpm * 100, 1);
  END IF;

  -- Délivrance cible/hors cible (filtrée). in_target constant par CP → FILTER sûr.
  SELECT COALESCE(SUM(impressions), 0),
         COALESCE(SUM(impressions) FILTER (WHERE in_target), 0),
         COALESCE(SUM(spend) FILTER (WHERE in_target), 0),
         COALESCE(SUM(impressions) FILTER (WHERE NOT in_target), 0),
         COALESCE(SUM(spend) FILTER (WHERE NOT in_target), 0)
  INTO v_cp_total_imps, v_in_imps, v_in_spend, v_out_imps, v_out_spend
  FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));

  -- Part planifiée cible = PLAN (non filtré par acteur, distinct par CP).
  SELECT COALESCE(SUM(planned_share), 0) INTO v_in_planned
  FROM (SELECT DISTINCT postal_code, planned_share, in_target
        FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id) t
  WHERE in_target;

  IF v_cp_total_imps > 0 THEN
    v_in_share := ROUND(v_in_imps::numeric / v_cp_total_imps * 100, 1);
    v_out_share := ROUND(v_out_imps::numeric / v_cp_total_imps * 100, 1);
  END IF;

  SELECT COUNT(*) FILTER (WHERE CASE WHEN s.out_mode = 'exclusion' THEN bid_multiplier > 0 ELSE bid_multiplier > 1 END),
         COUNT(*) FILTER (WHERE NOT (CASE WHEN s.out_mode = 'exclusion' THEN bid_multiplier > 0 ELSE bid_multiplier > 1 END)),
         MAX(bid_multiplier)
  INTO v_plan_in_cps, v_plan_out_cps, v_requested
  FROM bidding_zone_configs WHERE strategy_id = s.id AND is_active;

  IF s.out_mode = 'exclusion' THEN
    v_requested := NULL; v_obtained := NULL;
  ELSIF v_plan_in_cps > 0 AND v_plan_out_cps > 0 AND v_out_imps > 0 THEN
    v_obtained := ROUND((v_in_imps::numeric / v_plan_in_cps) / NULLIF(v_out_imps::numeric / v_plan_out_cps, 0), 2);
  END IF;

  -- Objectif (expected = global via helper ; realized = filtré)
  v_realized := v_imps;
  v_expected := public.get_campaign_expected(p_campaign_id);
  IF s.kpi_target IS NOT NULL AND s.kpi_target > 0 AND s.objective_code = 'maximize_impressions' THEN
    v_obj_basis := 'kpi';
  ELSIF s.total_budget IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_obj_basis := 'forecast';
  END IF;
  IF v_expected IS NOT NULL AND v_expected > 0 THEN
    v_obj_pct := ROUND(v_realized / v_expected * 100, 1);
  END IF;

  -- Alertes (identiques ; sur données filtrées)
  IF v_index IS NOT NULL AND v_index < 0.85 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'pacing',
      'severity', CASE WHEN v_index < 0.70 THEN 'danger' ELSE 'warning' END,
      'title', 'Pacing en retard de ' || ROUND(v_time_pct - v_budget_pct) || ' points',
      'detail', v_budget_pct || ' % du budget pour ' || v_time_pct || ' % du temps');
  ELSIF v_index IS NOT NULL AND v_index > 1.15 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'pacing',
      'severity', CASE WHEN v_index > 1.30 THEN 'danger' ELSE 'warning' END,
      'title', 'Pacing en avance de ' || ROUND(v_budget_pct - v_time_pct) || ' points',
      'detail', v_budget_pct || ' % du budget pour ' || v_time_pct || ' % du temps');
  END IF;
  IF v_cpm_real IS NOT NULL AND s.forecast_cpm IS NOT NULL AND v_cpm_real > s.forecast_cpm * 1.25 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'cpm', 'severity', 'danger',
      'title', 'CPM à ' || v_cpm_real || ' € — +' || v_cpm_delta || ' % vs prévu',
      'detail', 'CPM prévu : ' || ROUND(s.forecast_cpm, 2) || ' €');
  END IF;

  SELECT COUNT(*) AS n, COALESCE(SUM(spend), 0) AS sp, COALESCE(SUM(impressions), 0) AS im
  INTO v_under
  FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND in_target AND planned_share > 0
    AND (p_actors IS NULL OR actor = ANY(p_actors))
    AND (impressions::numeric / NULLIF(v_cp_total_imps, 0)) / planned_share * 100 < 70;
  IF v_under.n > 0 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'zones_under', 'severity', 'warning',
      'title', v_under.n || ' CP cibles sous 70 % du plan',
      'detail', ROUND(v_under.sp) || ' € de spend · '
        || ROUND(v_under.im::numeric / NULLIF(v_in_imps, 0) * 100, 1) || ' % du volume cible');
  END IF;
  IF s.out_mode = 'exclusion' AND COALESCE(v_out_share, 0) > 5 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'leak', 'severity', 'warning',
      'title', v_out_share || ' % du volume hors de la cible',
      'detail', 'Zones strictes : la diffusion hors cible devrait être ~0');
  END IF;

  v_level1 := jsonb_build_array(
    jsonb_build_object('zone', 'cible', 'impressions', v_in_imps, 'share_real', v_in_share,
      'share_plan', ROUND(v_in_planned * 100, 1),
      'cpm', CASE WHEN v_in_imps > 0 THEN ROUND(v_in_spend / v_in_imps * 1000, 2) END,
      'spend', ROUND(v_in_spend, 2)),
    jsonb_build_object('zone', 'hors_cible', 'impressions', v_out_imps, 'share_real', v_out_share,
      'share_plan', ROUND((1 - v_in_planned) * 100, 1),
      'cpm', CASE WHEN v_out_imps > 0 THEN ROUND(v_out_spend / v_out_imps * 1000, 2) END,
      'spend', ROUND(v_out_spend, 2)));

  -- Départements : CTE cp (délivrance FILTRÉE dans le SUM, CP conservés).
  WITH cp AS (
    SELECT postal_code, dept, in_target, planned_share,
           COALESCE(SUM(impressions) FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS impressions,
           COALESCE(SUM(spend)       FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS spend,
           COALESCE(SUM(imps_7d)     FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS imps_7d,
           COALESCE(SUM(imps_prev7d) FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS imps_prev7d
    FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id
    GROUP BY postal_code, dept, in_target, planned_share
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.hold_index ASC NULLS LAST), '[]'::jsonb)
  INTO v_depts
  FROM (
    SELECT dept, BOOL_OR(in_target) AS in_target, SUM(impressions) AS impressions,
           CASE WHEN SUM(planned_share) > 0 AND v_cp_total_imps > 0
                THEN ROUND((SUM(impressions)::numeric / v_cp_total_imps) / SUM(planned_share) * 100) END AS hold_index,
           CASE WHEN SUM(planned_share) FILTER (WHERE in_target) > 0 AND v_expected > 0
                THEN ROUND(SUM(impressions) FILTER (WHERE in_target)::numeric
                     / (SUM(planned_share) FILTER (WHERE in_target) * v_expected) * 100) END AS objective_alignment,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm,
           ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(imps_prev7d) > 0
                THEN ROUND((SUM(imps_7d) - SUM(imps_prev7d))::numeric / SUM(imps_prev7d) * 100, 1) END AS delta7_pct
    FROM cp WHERE dept IS NOT NULL GROUP BY dept
  ) t;

  -- Zones sous/au-dessus objectif (CP cibles) pour le bandeau d'écarts.
  IF v_expected IS NOT NULL AND v_expected > 0 THEN
    WITH cp AS (
      SELECT postal_code, in_target, planned_share,
             COALESCE(SUM(impressions) FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS impressions
      FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id
      GROUP BY postal_code, in_target, planned_share
    )
    SELECT COUNT(*) FILTER (WHERE impressions / (planned_share * v_expected) * 100 < 90),
           COUNT(*) FILTER (WHERE impressions / (planned_share * v_expected) * 100 > 110)
    INTO v_zones_under, v_zones_over
    FROM cp WHERE in_target AND planned_share > 0;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date), '[]'::jsonb) INTO v_daily
  FROM (
    SELECT date, SUM(impressions) AS impressions, ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm
    FROM campaign_daily_rollup
    WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors))
    GROUP BY date
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.impressions DESC), '[]'::jsonb) INTO v_medias
  FROM (
    SELECT media, SUM(impressions) AS impressions, ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm
    FROM campaign_daily_rollup
    WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors))
    GROUP BY media
  ) t;

  RETURN jsonb_build_object(
    'as_of', v_as_of, 'start_date', s.start_date, 'end_date', s.end_date,
    'pacing', jsonb_build_object('spend', ROUND(v_spend, 2), 'total_budget', s.total_budget,
      'budget_pct', v_budget_pct, 'time_pct', v_time_pct, 'index', v_index),
    'cpm', jsonb_build_object('real', v_cpm_real, 'forecast', ROUND(s.forecast_cpm, 2), 'delta_pct', v_cpm_delta),
    'pressure', jsonb_build_object('mode', COALESCE(s.out_mode, 'exclusion'),
      'requested', v_requested, 'obtained', v_obtained,
      'in_target_share', v_in_share, 'out_share', v_out_share),
    'objective', jsonb_build_object('code', s.objective_code, 'basis', v_obj_basis,
      'kpi_target', s.kpi_target, 'realized', v_realized,
      'expected', ROUND(COALESCE(v_expected, 0)), 'pct', v_obj_pct),
    'objective_zones', jsonb_build_object('under', v_zones_under, 'over', v_zones_over),
    'alerts', v_alerts, 'level1', v_level1, 'depts', v_depts, 'daily', v_daily, 'medias', v_medias);
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_suivi(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_suivi(uuid, text[]) TO service_role;
