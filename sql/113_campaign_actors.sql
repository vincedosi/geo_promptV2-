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
