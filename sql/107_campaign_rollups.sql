-- ============================================================
-- 107 — Rollups de suivi campagne + refresh_campaign_rollups
-- ============================================================
-- Appliquée le 2026-07-17 via MCP Supabase (migration `campaign_rollups`).
--
-- Le cockpit de suivi (onglet Suivi campagne) ne lit QUE ces agrégats —
-- jamais dsp_campaign_data (185k–70M lignes) à l'ouverture. Refresh appelé
-- à l'import DSP, à l'absorb et à l'armement d'une stratégie ; backfill
-- lazy dans la route /api/digital/[campaignId]/suivi.
--
-- Recalibrage démo exécuté le même jour (données, pas schéma) :
--   UPDATE bidding_strategies SET total_budget = 600000, end_date = '2026-05-31'
--   WHERE id = 'dccc0000-0000-4000-8000-000000000012';
--   SELECT refresh_campaign_rollups('dccc0000-0000-4000-8000-000000000002');
-- → lecture en vol crédible (temps ~49 %, budget ~51 %, CPM 6,20 vs 7,10).

CREATE TABLE IF NOT EXISTS public.campaign_daily_rollup (
  campaign_id uuid NOT NULL REFERENCES public.dsp_campaigns(id) ON DELETE CASCADE,
  date date NOT NULL,
  media text NOT NULL DEFAULT '',
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  spend numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, date, media)
);
CREATE TABLE IF NOT EXISTS public.campaign_cp_rollup (
  campaign_id uuid NOT NULL REFERENCES public.dsp_campaigns(id) ON DELETE CASCADE,
  postal_code text NOT NULL,
  dept text,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  spend numeric NOT NULL DEFAULT 0,
  imps_7d bigint NOT NULL DEFAULT 0,
  imps_prev7d bigint NOT NULL DEFAULT 0,
  in_target boolean NOT NULL DEFAULT false,
  planned_share numeric,
  PRIMARY KEY (campaign_id, postal_code)
);
-- RLS deny-all : lecture exclusivement via les routes (service role bypass).
ALTER TABLE public.campaign_daily_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_cp_rollup ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.refresh_campaign_rollups(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_source text;
  v_as_of date;
  v_strategy_id uuid;
  v_out_mode text;
  v_daily int := 0;
  v_cp int := 0;
BEGIN
  SELECT dsp_source INTO v_source FROM dsp_campaigns WHERE id = p_campaign_id;
  IF v_source IS NULL THEN
    RETURN jsonb_build_object('error', 'campaign_not_found');
  END IF;

  DELETE FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;
  INSERT INTO campaign_daily_rollup (campaign_id, date, media, impressions, clicks, spend)
  SELECT p_campaign_id, d.date, COALESCE(d.media, ''),
         SUM(CASE WHEN v_source = 'adform' THEN COALESCE(d.tracked_ads, 0)
                  ELSE COALESCE(NULLIF(d.impressions, 0), d.tracked_ads, 0) END),
         SUM(COALESCE(d.clicks, 0)),
         SUM(COALESCE(d.spend, 0))
  FROM dsp_campaign_data d
  WHERE d.campaign_id = p_campaign_id AND d.date IS NOT NULL
  GROUP BY d.date, COALESCE(d.media, '');
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  SELECT MAX(date) INTO v_as_of
  FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;

  SELECT s.id, s.out_zone_weights->>'mode' INTO v_strategy_id, v_out_mode
  FROM bidding_strategies s
  WHERE s.campaign_id = p_campaign_id
  ORDER BY s.created_at DESC LIMIT 1;

  DELETE FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id;
  INSERT INTO campaign_cp_rollup
    (campaign_id, postal_code, dept, impressions, clicks, spend,
     imps_7d, imps_prev7d, in_target, planned_share)
  WITH raw AS (
    SELECT d.postal_code, d.date,
           CASE WHEN v_source = 'adform' THEN COALESCE(d.tracked_ads, 0)
                ELSE COALESCE(NULLIF(d.impressions, 0), d.tracked_ads, 0) END AS imp,
           COALESCE(d.clicks, 0) AS clk,
           COALESCE(d.spend, 0) AS sp
    FROM dsp_campaign_data d
    WHERE d.campaign_id = p_campaign_id AND d.postal_code IS NOT NULL
  ),
  plan AS (
    SELECT z.postal_code,
           -- ⚠ REMPLACÉE par sql/306 (A8, E5) : part prévue de l'extraction quand le plan en porte. Rejouer ce fichier
           -- seul après sql/306 ramènerait m ÷ Σ m pour tous les plans : rejouer sql/306 ensuite.
           z.bid_multiplier / NULLIF(SUM(z.bid_multiplier) OVER (), 0) AS planned_share,
           CASE WHEN v_out_mode = 'exclusion' THEN z.bid_multiplier > 0
                ELSE z.bid_multiplier > 1 END AS in_target
    FROM bidding_zone_configs z
    WHERE z.strategy_id = v_strategy_id AND z.is_active
  )
  SELECT p_campaign_id, r.postal_code, LEFT(r.postal_code, 2),
         SUM(r.imp), SUM(r.clk), SUM(r.sp),
         COALESCE(SUM(r.imp) FILTER (WHERE r.date > v_as_of - 7), 0),
         COALESCE(SUM(r.imp) FILTER (WHERE r.date <= v_as_of - 7 AND r.date > v_as_of - 14), 0),
         COALESCE(BOOL_OR(p.in_target), false),
         MAX(p.planned_share)
  FROM raw r
  LEFT JOIN plan p ON p.postal_code = r.postal_code
  GROUP BY r.postal_code;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp, 'as_of', v_as_of);
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_campaign_rollups(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_rollups(uuid) TO service_role;
