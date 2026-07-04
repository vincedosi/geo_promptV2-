-- ============================================================
-- 097 — Pacing période-aware : chaque version mesurée sur SA période
-- ============================================================
-- Appliquée le 2026-07-04 via MCP Supabase.
--
-- Une version de plan est active sur [period_start, period_end). get_campaign_pacing
-- filtre la délivrance (dsp_campaign_data.date) à cette fenêtre. period_* NULL →
-- fenêtre ouverte = comportement d'origine (rétrocompat : aucun snapshot en prod).

ALTER TABLE public.campaign_plan_snapshot
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end   date;

CREATE OR REPLACE FUNCTION public.get_campaign_pacing(
  p_campaign_id uuid,
  p_metric_field text,
  p_version int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_version int;
  v_pstart date;
  v_pend date;
  v_result jsonb;
  v_in_plan_imp numeric;
  v_total_imp numeric;
  v_total_spend numeric;
  v_in_plan_spend numeric;
BEGIN
  v_version := COALESCE(
    p_version,
    (SELECT max(version) FROM public.campaign_plan_snapshot WHERE campaign_id = p_campaign_id)
  );
  IF v_version IS NULL THEN
    RETURN NULL;
  END IF;

  -- Période de la version (NULL → fenêtre ouverte)
  SELECT max(period_start), max(period_end) INTO v_pstart, v_pend
  FROM public.campaign_plan_snapshot
  WHERE campaign_id = p_campaign_id AND version = v_version;

  WITH real_cp AS (
    SELECT d.postal_code,
           SUM(CASE p_metric_field
                 WHEN 'tracked_ads' THEN d.tracked_ads
                 WHEN 'unique_impressions' THEN d.unique_impressions
                 ELSE d.impressions END)::numeric AS imp,
           SUM(COALESCE(d.spend, 0))::numeric AS spend
    FROM public.dsp_campaign_data d
    WHERE d.campaign_id = p_campaign_id
      AND (v_pstart IS NULL OR d.date >= v_pstart)
      AND (v_pend   IS NULL OR d.date <  v_pend)
    GROUP BY d.postal_code
  ),
  snap AS (
    SELECT zone_id, zone_name, item_id, item_name,
           max(item_weight) AS item_weight,
           max(expected_share) AS expected_share,
           array_agg(DISTINCT postal_code) AS cps,
           count(DISTINCT postal_code) AS cp_count
    FROM public.campaign_plan_snapshot
    WHERE campaign_id = p_campaign_id AND version = v_version
    GROUP BY zone_id, zone_name, item_id, item_name
  ),
  per_item AS (
    SELECT s.zone_id, s.zone_name, s.item_id, s.item_name, s.item_weight,
           s.expected_share, s.cp_count,
           COALESCE(SUM(rc.imp), 0)   AS actual_imp,
           COALESCE(SUM(rc.spend), 0) AS actual_spend
    FROM snap s
    LEFT JOIN real_cp rc ON rc.postal_code = ANY(s.cps)
    GROUP BY s.zone_id, s.zone_name, s.item_id, s.item_name, s.item_weight, s.expected_share, s.cp_count
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'zone_id', zone_id, 'zone_name', zone_name,
      'item_id', item_id, 'item_name', item_name,
      'item_weight', item_weight, 'expected_share', expected_share,
      'actual_imp', actual_imp, 'actual_spend', actual_spend, 'cp_count', cp_count
    )),
    COALESCE(SUM(actual_imp), 0),
    COALESCE(SUM(actual_spend), 0)
  INTO v_result, v_in_plan_imp, v_in_plan_spend
  FROM per_item;

  SELECT
    COALESCE(SUM(CASE p_metric_field
                   WHEN 'tracked_ads' THEN d.tracked_ads
                   WHEN 'unique_impressions' THEN d.unique_impressions
                   ELSE d.impressions END), 0)::numeric,
    COALESCE(SUM(COALESCE(d.spend, 0)), 0)::numeric
  INTO v_total_imp, v_total_spend
  FROM public.dsp_campaign_data d
  WHERE d.campaign_id = p_campaign_id
    AND (v_pstart IS NULL OR d.date >= v_pstart)
    AND (v_pend   IS NULL OR d.date <  v_pend);

  RETURN jsonb_build_object(
    'version', v_version,
    'items', COALESCE(v_result, '[]'::jsonb),
    'in_plan_imp', v_in_plan_imp,
    'total_imp', v_total_imp,
    'spillover', jsonb_build_object(
      'imp', GREATEST(v_total_imp - v_in_plan_imp, 0),
      'spend', GREATEST(v_total_spend - v_in_plan_spend, 0)
    )
  );
END $$;
