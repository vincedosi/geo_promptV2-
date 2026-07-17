-- ============================================================
-- 108 — get_campaign_suivi : payload complet du cockpit de suivi
-- ============================================================
-- Appliquée le 2026-07-17 via MCP Supabase (migrations `get_campaign_suivi`
-- puis `get_campaign_suivi_fix_objective` — version finale ci-dessous).
--
-- Lit UNIQUEMENT les rollups (107) + la stratégie + le plan
-- (bidding_zone_configs). Seuils d'alerte v1 (constantes) :
--   pacing < 0,85 ou > 1,15 (danger < 0,70 / > 1,30) ;
--   CPM réel > prévu × 1,25 ;
--   CP cibles hold_index < 70 (agrégé) ;
--   fuite hors cible > 5 % (mode exclusion).
-- Objectif : kpi_target seulement si objective_code = maximize_impressions
-- (sinon unité non mesurable côté ad server → trajectoire budget ÷ CPM prévu,
-- champ objective.basis = 'kpi' | 'forecast').

CREATE OR REPLACE FUNCTION public.get_campaign_suivi(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  s record;
  v_as_of date;
  v_spend numeric := 0;
  v_imps bigint := 0;
  v_budget_pct numeric; v_time_pct numeric; v_index numeric;
  v_cpm_real numeric; v_cpm_delta numeric;
  v_cp_total_imps bigint := 0;
  v_in_imps bigint := 0; v_in_spend numeric := 0;
  v_out_imps bigint := 0; v_out_spend numeric := 0;
  v_in_planned numeric := 0;
  v_in_share numeric; v_out_share numeric;
  v_plan_in_cps int := 0; v_plan_out_cps int := 0;
  v_requested numeric; v_obtained numeric;
  v_realized bigint; v_expected numeric; v_obj_pct numeric;
  v_obj_basis text;
  v_alerts jsonb := '[]'::jsonb;
  v_level1 jsonb; v_depts jsonb; v_daily jsonb; v_medias jsonb;
  v_under record;
BEGIN
  SELECT s2.id, s2.total_budget, s2.forecast_cpm, s2.start_date, s2.end_date,
         s2.out_zone_weights->>'mode' AS out_mode, s2.kpi_target, s2.objective_code
  INTO s
  FROM bidding_strategies s2
  WHERE s2.campaign_id = p_campaign_id
  ORDER BY s2.created_at DESC LIMIT 1;
  IF s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_strategy');
  END IF;

  SELECT MAX(date), COALESCE(SUM(spend), 0), COALESCE(SUM(impressions), 0)
  INTO v_as_of, v_spend, v_imps
  FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;
  IF v_as_of IS NULL THEN
    RETURN jsonb_build_object('error', 'no_rollup');
  END IF;

  -- Pacing (à la date des données, pas à aujourd'hui)
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

  -- CPM
  IF v_imps > 0 THEN v_cpm_real := ROUND(v_spend / v_imps * 1000, 2); END IF;
  IF v_cpm_real IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_cpm_delta := ROUND((v_cpm_real - s.forecast_cpm) / s.forecast_cpm * 100, 1);
  END IF;

  -- Cible / hors cible (rollup CP)
  SELECT COALESCE(SUM(impressions), 0),
         COALESCE(SUM(impressions) FILTER (WHERE in_target), 0),
         COALESCE(SUM(spend) FILTER (WHERE in_target), 0),
         COALESCE(SUM(impressions) FILTER (WHERE NOT in_target), 0),
         COALESCE(SUM(spend) FILTER (WHERE NOT in_target), 0),
         COALESCE(SUM(planned_share) FILTER (WHERE in_target), 0)
  INTO v_cp_total_imps, v_in_imps, v_in_spend, v_out_imps, v_out_spend, v_in_planned
  FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id;

  IF v_cp_total_imps > 0 THEN
    v_in_share := ROUND(v_in_imps::numeric / v_cp_total_imps * 100, 1);
    v_out_share := ROUND(v_out_imps::numeric / v_cp_total_imps * 100, 1);
  END IF;

  -- Pression : nb de CP du PLAN (pas de la délivrance) + demandé/obtenu hors exclusion
  SELECT COUNT(*) FILTER (WHERE CASE WHEN s.out_mode = 'exclusion' THEN bid_multiplier > 0 ELSE bid_multiplier > 1 END),
         COUNT(*) FILTER (WHERE NOT (CASE WHEN s.out_mode = 'exclusion' THEN bid_multiplier > 0 ELSE bid_multiplier > 1 END)),
         MAX(bid_multiplier)
  INTO v_plan_in_cps, v_plan_out_cps, v_requested
  FROM bidding_zone_configs WHERE strategy_id = s.id AND is_active;

  IF s.out_mode = 'exclusion' THEN
    v_requested := NULL; v_obtained := NULL;
  ELSIF v_plan_in_cps > 0 AND v_plan_out_cps > 0 AND v_out_imps > 0 THEN
    v_obtained := ROUND(
      (v_in_imps::numeric / v_plan_in_cps) / NULLIF(v_out_imps::numeric / v_plan_out_cps, 0), 2);
  END IF;

  -- Objectif
  v_realized := v_imps;
  IF s.kpi_target IS NOT NULL AND s.kpi_target > 0 AND s.objective_code = 'maximize_impressions' THEN
    v_expected := s.kpi_target * COALESCE(v_time_pct, 0) / 100;
    v_obj_basis := 'kpi';
  ELSIF s.total_budget IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_expected := s.total_budget * COALESCE(v_time_pct, 0) / 100 / s.forecast_cpm * 1000;
    v_obj_basis := 'forecast';
  END IF;
  IF v_expected IS NOT NULL AND v_expected > 0 THEN
    v_obj_pct := ROUND(v_realized / v_expected * 100, 1);
  END IF;

  -- Alertes
  IF v_index IS NOT NULL AND v_index < 0.85 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind', 'pacing', 'severity', CASE WHEN v_index < 0.70 THEN 'danger' ELSE 'warning' END,
      'title', 'Pacing en retard de ' || ROUND(v_time_pct - v_budget_pct) || ' points',
      'detail', v_budget_pct || ' % du budget pour ' || v_time_pct || ' % du temps');
  ELSIF v_index IS NOT NULL AND v_index > 1.15 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind', 'pacing', 'severity', CASE WHEN v_index > 1.30 THEN 'danger' ELSE 'warning' END,
      'title', 'Pacing en avance de ' || ROUND(v_budget_pct - v_time_pct) || ' points',
      'detail', v_budget_pct || ' % du budget pour ' || v_time_pct || ' % du temps');
  END IF;

  IF v_cpm_real IS NOT NULL AND s.forecast_cpm IS NOT NULL AND v_cpm_real > s.forecast_cpm * 1.25 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind', 'cpm', 'severity', 'danger',
      'title', 'CPM à ' || v_cpm_real || ' € — +' || v_cpm_delta || ' % vs prévu',
      'detail', 'CPM prévu : ' || ROUND(s.forecast_cpm, 2) || ' €');
  END IF;

  SELECT COUNT(*) AS n, COALESCE(SUM(spend), 0) AS sp, COALESCE(SUM(impressions), 0) AS im
  INTO v_under
  FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND in_target AND planned_share > 0
    AND (impressions::numeric / NULLIF(v_cp_total_imps, 0)) / planned_share * 100 < 70;
  IF v_under.n > 0 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind', 'zones_under', 'severity', 'warning',
      'title', v_under.n || ' CP cibles sous 70 % du plan',
      'detail', ROUND(v_under.sp) || ' € de spend · '
        || ROUND(v_under.im::numeric / NULLIF(v_in_imps, 0) * 100, 1) || ' % du volume cible');
  END IF;

  IF s.out_mode = 'exclusion' AND COALESCE(v_out_share, 0) > 5 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind', 'leak', 'severity', 'warning',
      'title', v_out_share || ' % du volume hors de la cible',
      'detail', 'Zones strictes : la diffusion hors cible devrait être ~0');
  END IF;

  -- Niveau 1
  v_level1 := jsonb_build_array(
    jsonb_build_object('zone', 'cible', 'impressions', v_in_imps,
      'share_real', v_in_share, 'share_plan', ROUND(v_in_planned * 100, 1),
      'cpm', CASE WHEN v_in_imps > 0 THEN ROUND(v_in_spend / v_in_imps * 1000, 2) END,
      'spend', ROUND(v_in_spend, 2)),
    jsonb_build_object('zone', 'hors_cible', 'impressions', v_out_imps,
      'share_real', v_out_share, 'share_plan', ROUND((1 - v_in_planned) * 100, 1),
      'cpm', CASE WHEN v_out_imps > 0 THEN ROUND(v_out_spend / v_out_imps * 1000, 2) END,
      'spend', ROUND(v_out_spend, 2)));

  -- Départements (pires indices d'abord)
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.hold_index ASC NULLS LAST), '[]'::jsonb)
  INTO v_depts
  FROM (
    SELECT dept,
           BOOL_OR(in_target) AS in_target,
           SUM(impressions) AS impressions,
           CASE WHEN SUM(planned_share) > 0 AND v_cp_total_imps > 0
                THEN ROUND((SUM(impressions)::numeric / v_cp_total_imps) / SUM(planned_share) * 100)
           END AS hold_index,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm,
           ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(imps_prev7d) > 0
                THEN ROUND((SUM(imps_7d) - SUM(imps_prev7d))::numeric / SUM(imps_prev7d) * 100, 1)
           END AS delta7_pct
    FROM campaign_cp_rollup
    WHERE campaign_id = p_campaign_id AND dept IS NOT NULL
    GROUP BY dept
  ) t;

  -- Quotidien (tous médias confondus) + cumul par média
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date), '[]'::jsonb) INTO v_daily
  FROM (
    SELECT date, SUM(impressions) AS impressions, ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm
    FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id GROUP BY date
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.impressions DESC), '[]'::jsonb) INTO v_medias
  FROM (
    SELECT media, SUM(impressions) AS impressions, ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm
    FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id GROUP BY media
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
      'kpi_target', s.kpi_target,
      'realized', v_realized, 'expected', ROUND(COALESCE(v_expected, 0)), 'pct', v_obj_pct),
    'alerts', v_alerts,
    'level1', v_level1,
    'depts', v_depts,
    'daily', v_daily,
    'medias', v_medias);
END;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_suivi(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_suivi(uuid) TO service_role;
