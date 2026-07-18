-- ============================================================
-- 111 — Réconciliation DSP ⇔ ad server : générateur démo + RPC de lecture
-- ============================================================
-- Appliquée le 2026-07-18 via MCP Supabase (migration `reconciliation_rpc`).
--
-- Lit UNIQUEMENT campaign_dsp_report (110) + les rollups de suivi (107) +
-- ref_codes_postaux (géométries) — jamais dsp_campaign_data à la lecture.
--
-- Backfill démo exécuté le même jour :
--   SELECT public.simulate_dsp_report('dccc0000-0000-4000-8000-000000000002');
-- → 120 lignes daily (30 j × 4 canaux) + 6186 CP ; taux de mesure global ~97 %
--   (sur-déclaration ×1,03), dispersion 91-99 % par CP (jitter déterministe).

CREATE OR REPLACE FUNCTION public.simulate_dsp_report(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_channels text[];
  v_budgets jsonb;
  v_total_budget numeric;
  v_daily int := 0; v_cp int := 0;
BEGIN
  SELECT ARRAY(
           SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'dsps','[]'::jsonb))
           UNION
           SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'socials','[]'::jsonb))),
         COALESCE(geo_strategy->'channels'->'budgets', '{}'::jsonb)
    INTO v_channels, v_budgets
  FROM dsp_campaigns WHERE id = p_campaign_id;

  IF v_channels IS NULL OR array_length(v_channels, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'no_channels');
  END IF;

  SELECT GREATEST(SUM(COALESCE((v_budgets->>ch)::numeric, 0)), 0)
    INTO v_total_budget FROM unnest(v_channels) ch;

  DELETE FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND source = 'simulated';

  -- Grain daily : date × canal (depuis campaign_daily_rollup, ~30 lignes).
  WITH ch AS (
    SELECT c AS channel,
           CASE WHEN v_total_budget > 0
                THEN COALESCE((v_budgets->>c)::numeric, 0) / v_total_budget
                ELSE 1.0 / array_length(v_channels, 1) END AS share,
           CASE c WHEN 'dv360' THEN 6.1 WHEN 'ttd' THEN 6.4
                  WHEN 'tiktok' THEN 6.0 WHEN 'meta' THEN 6.6 ELSE 6.2 END AS cpm
    FROM unnest(v_channels) c
  )
  INSERT INTO campaign_dsp_report
    (campaign_id, date, channel, postal_code, impressions, clicks, spend, source, pulled_at)
  SELECT p_campaign_id, r.date, ch.channel, '',
         round(r.impressions * 1.03 * ch.share),
         round(r.clicks * 1.03 * ch.share),
         round(r.impressions * 1.03 * ch.share * ch.cpm / 1000.0, 2),
         'simulated', now()
  FROM campaign_daily_rollup r CROSS JOIN ch
  WHERE r.campaign_id = p_campaign_id;
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  -- Grain CP : postal_code (depuis campaign_cp_rollup, ~6 k lignes).
  -- Sur-déclaration variable par CP (1,01-1,10) → taux de mesure 91-99 %.
  INSERT INTO campaign_dsp_report
    (campaign_id, date, channel, postal_code, impressions, clicks, spend, source, pulled_at)
  SELECT p_campaign_id, NULL, '', c.postal_code,
         round(c.impressions * f.factor),
         round(c.clicks * f.factor),
         round(c.spend * f.factor, 2),
         'simulated', now()
  FROM campaign_cp_rollup c
  CROSS JOIN LATERAL (
    SELECT 1.01 + (('x' || substr(md5(c.postal_code), 1, 4))::bit(16)::int % 10) / 100.0 AS factor
  ) f
  WHERE c.campaign_id = p_campaign_id;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp,
                            'channels', to_jsonb(v_channels));
END;
$$;
REVOKE ALL ON FUNCTION public.simulate_dsp_report(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_dsp_report(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_reconciliation(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_source text;
  v_dsp_imps bigint; v_dsp_spend numeric;
  v_as_imps bigint; v_as_as_of date;
  v_global jsonb; v_by_channel jsonb; v_daily jsonb;
BEGIN
  SELECT source INTO v_source
  FROM campaign_dsp_report WHERE campaign_id = p_campaign_id LIMIT 1;
  IF v_source IS NULL THEN
    RETURN jsonb_build_object('has_dsp_report', false);
  END IF;

  SELECT COALESCE(SUM(impressions), 0), COALESCE(SUM(spend), 0)
    INTO v_dsp_imps, v_dsp_spend
  FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND date IS NOT NULL;

  SELECT COALESCE(SUM(impressions), 0), MAX(date)
    INTO v_as_imps, v_as_as_of
  FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;

  v_global := jsonb_build_object(
    'dsp_impressions', v_dsp_imps,
    'adserver_impressions', v_as_imps,
    'measure_rate', CASE WHEN v_dsp_imps > 0 THEN round(v_as_imps::numeric / v_dsp_imps * 100, 1) END,
    'gap_pct', CASE WHEN v_dsp_imps > 0 THEN round((v_dsp_imps - v_as_imps)::numeric / v_dsp_imps * 100, 1) END,
    'dsp_spend', round(v_dsp_spend, 2),
    'dsp_cpm', CASE WHEN v_dsp_imps > 0 THEN round(v_dsp_spend / v_dsp_imps * 1000, 2) END);

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.impressions DESC), '[]'::jsonb) INTO v_by_channel
  FROM (
    SELECT channel, SUM(impressions) AS impressions, round(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN round(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm,
           CASE WHEN v_dsp_imps > 0 THEN round(SUM(impressions)::numeric / v_dsp_imps * 100, 1) END AS share_pct
    FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND date IS NOT NULL
    GROUP BY channel
  ) t;

  -- Pré-agréger chaque côté par date AVANT de joindre (le rollup ad server est
  -- par date×media : joindre brut multiplierait les lignes en multi-média).
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date), '[]'::jsonb) INTO v_daily
  FROM (
    SELECT a.date,
           a.imps AS adserver_impressions,
           COALESCE(dsp.imps, 0) AS dsp_impressions,
           round(COALESCE(dsp.spend, 0), 2) AS dsp_spend
    FROM (SELECT date, SUM(impressions) AS imps
          FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id GROUP BY date) a
    LEFT JOIN (SELECT date, SUM(impressions) AS imps, SUM(spend) AS spend
               FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND date IS NOT NULL
               GROUP BY date) dsp ON dsp.date = a.date
  ) t;

  RETURN jsonb_build_object(
    'has_dsp_report', true, 'source', v_source, 'as_of', v_as_as_of,
    'global', v_global, 'by_channel', v_by_channel, 'daily', v_daily);
END;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_reconciliation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_reconciliation(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_reconciliation_map(
  p_campaign_id uuid, p_metric text DEFAULT 'measure',
  p_bbox_xmin float8 DEFAULT -5.5, p_bbox_ymin float8 DEFAULT 41.2,
  p_bbox_xmax float8 DEFAULT 9.8, p_bbox_ymax float8 DEFAULT 51.2)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT dsp.postal_code AS code, rcp.nom_principal AS nom,
           CASE WHEN p_metric = 'dspcpm'
                THEN CASE WHEN dsp.impressions > 0 THEN round(dsp.spend / dsp.impressions * 1000, 2) END
                ELSE CASE WHEN dsp.impressions > 0 THEN round(cp.impressions::numeric / dsp.impressions * 100, 1) END
           END AS value,
           ST_AsGeoJSON(rcp.geom_simplified)::json AS geometry
    FROM campaign_dsp_report dsp
    JOIN campaign_cp_rollup cp
      ON cp.campaign_id = dsp.campaign_id AND cp.postal_code = dsp.postal_code
    JOIN ref_codes_postaux rcp ON rcp.code_postal = dsp.postal_code
    WHERE dsp.campaign_id = p_campaign_id AND dsp.date IS NULL AND dsp.postal_code <> ''
      AND rcp.geom_simplified && ST_MakeEnvelope(p_bbox_xmin, p_bbox_ymin, p_bbox_xmax, p_bbox_ymax, 4326)
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_reconciliation_map(uuid, text, float8, float8, float8, float8) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_reconciliation_map(uuid, text, float8, float8, float8, float8) TO service_role;
