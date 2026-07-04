-- ============================================================
-- 096 — Pacing plan-vs-réel : snapshot du plan poussé + RPC pacing
-- ============================================================
-- Appliquée le 2026-07-04 via MCP Supabase.
--
-- campaign_plan_snapshot fige, au moment du push (génération export DSP),
-- l'intention par item de zone, expansée en codes postaux. expected_share est
-- normalisé INTRA-ZONE (fidèle à l'export, une requête par zone). Une ligne par
-- (snapshot, item, code postal). Versionné : un push = une version.
--
-- get_campaign_pacing joint le snapshot à dsp_campaign_data au code postal,
-- borné à la campagne + version → index scan (jamais de full scan, contrainte Nano).

CREATE TABLE IF NOT EXISTS public.campaign_plan_snapshot (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid NOT NULL,
  version        int  NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  dsp            text,
  budget         numeric,
  cpm            numeric,
  cible          text,
  zone_id        text NOT NULL,
  zone_name      text,
  item_id        text NOT NULL,
  item_name      text,
  item_weight    numeric NOT NULL,
  expected_share numeric NOT NULL,
  postal_code    text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_snapshot_campaign_version
  ON public.campaign_plan_snapshot (campaign_id, version);
CREATE INDEX IF NOT EXISTS idx_plan_snapshot_join
  ON public.campaign_plan_snapshot (campaign_id, version, postal_code);

ALTER TABLE public.campaign_plan_snapshot ENABLE ROW LEVEL SECURITY;

-- Lecture scopée org (miroir de dsp_campaign_data via la campagne), écriture service-role.
DROP POLICY IF EXISTS plan_snapshot_read ON public.campaign_plan_snapshot;
CREATE POLICY plan_snapshot_read ON public.campaign_plan_snapshot
  FOR SELECT USING (
    campaign_id IN (
      SELECT id FROM public.dsp_campaigns
      WHERE organization_id = public.get_user_org()
    )
    OR public.get_user_org() IS NULL  -- super_admin sans org
  );

-- get_campaign_pacing : agrégation par item + spillover, bornée campagne+version.
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
    RETURN NULL;  -- aucun snapshot
  END IF;

  -- Réel par code postal de la campagne (métrique dynamique bornée à des colonnes connues)
  WITH real_cp AS (
    SELECT d.postal_code,
           SUM(CASE p_metric_field
                 WHEN 'tracked_ads' THEN d.tracked_ads
                 WHEN 'unique_impressions' THEN d.unique_impressions
                 ELSE d.impressions END)::numeric AS imp,
           SUM(COALESCE(d.spend, 0))::numeric AS spend
    FROM public.dsp_campaign_data d
    WHERE d.campaign_id = p_campaign_id
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

  -- Totaux campagne (pour le spillover hors-plan)
  SELECT
    COALESCE(SUM(CASE p_metric_field
                   WHEN 'tracked_ads' THEN d.tracked_ads
                   WHEN 'unique_impressions' THEN d.unique_impressions
                   ELSE d.impressions END), 0)::numeric,
    COALESCE(SUM(COALESCE(d.spend, 0)), 0)::numeric
  INTO v_total_imp, v_total_spend
  FROM public.dsp_campaign_data d
  WHERE d.campaign_id = p_campaign_id;

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
