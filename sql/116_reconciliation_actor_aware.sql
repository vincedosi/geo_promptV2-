-- ============================================================
-- 116 — Réconciliation « actor-aware » (supersede sql/115 simulate + sql/111 reco)
-- ============================================================
-- Appliquée le 2026-07-18 via MCP. La dimension acteur (sql/113) a rendu
-- campaign_daily_rollup / campaign_cp_rollup per-acteur (N lignes/date, N/CP).
-- La réconciliation lisait ces rollups sans en tenir compte → (1) fan-out N×
-- des features de get_campaign_reconciliation_map ; (2) simulate_dsp_report
-- répartissait le TOTAL (régies incluses) sur les canaux DSP par budget →
-- conflation du volume régie dans les canaux programmatiques.
--
-- Modèle corrigé : le rapport DSP ne couvre QUE le programmatique + le volume
-- non attribué. Par canal = (délivrance propre de l'acteur = canal) + (volume
-- actor='' × part de budget), ×1,03. Les régies (actor non vide, hors canaux)
-- sont EXCLUES. Le mesuré ad server est scopé « actor='' OU actor ∈ canaux »
-- (no-op = total pour les campagnes non taguées → non-régression stricte).
-- Supersede la fonction simulate_dsp_report de sql/115 et les 2 fonctions de reco de sql/111.

CREATE OR REPLACE FUNCTION public.simulate_dsp_report(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_channels text[]; v_budgets jsonb; v_demo_cpm jsonb; v_total_budget numeric;
  v_daily int := 0; v_cp int := 0;
BEGIN
  SELECT ARRAY(
           SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'dsps','[]'::jsonb))
           UNION SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'socials','[]'::jsonb))),
         COALESCE(geo_strategy->'channels'->'budgets','{}'::jsonb),
         COALESCE(geo_strategy->'channels'->'demo_cpm','{}'::jsonb)
    INTO v_channels, v_budgets, v_demo_cpm
  FROM dsp_campaigns WHERE id = p_campaign_id;
  IF v_channels IS NULL OR array_length(v_channels,1) IS NULL THEN
    RETURN jsonb_build_object('error','no_channels'); END IF;
  SELECT GREATEST(SUM(COALESCE((v_budgets->>ch)::numeric,0)),0) INTO v_total_budget FROM unnest(v_channels) ch;

  DELETE FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND source = 'simulated';

  WITH ch AS (
    SELECT c AS channel,
           CASE WHEN v_total_budget > 0 THEN COALESCE((v_budgets->>c)::numeric,0)/v_total_budget
                ELSE 1.0/array_length(v_channels,1) END AS share,
           COALESCE((v_demo_cpm->>c)::numeric,
                    CASE c WHEN 'dv360' THEN 6.1 WHEN 'ttd' THEN 6.4
                           WHEN 'tiktok' THEN 6.0 WHEN 'meta' THEN 6.6 ELSE 6.2 END) AS cpm
    FROM unnest(v_channels) c
  ),
  tagged AS (
    SELECT date, actor AS channel, SUM(impressions) AS impressions, SUM(clicks) AS clicks
    FROM campaign_daily_rollup
    WHERE campaign_id = p_campaign_id AND actor = ANY(v_channels)
    GROUP BY date, actor
  ),
  untag AS (
    SELECT date, SUM(impressions) AS impressions, SUM(clicks) AS clicks
    FROM campaign_daily_rollup
    WHERE campaign_id = p_campaign_id AND actor = ''
    GROUP BY date
  ),
  dates AS (SELECT DISTINCT date FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id)
  INSERT INTO campaign_dsp_report
    (campaign_id, date, channel, postal_code, impressions, clicks, spend, source, pulled_at)
  SELECT p_campaign_id, d.date, ch.channel, '',
         round((COALESCE(t.impressions,0) + COALESCE(u.impressions,0)*ch.share) * 1.03),
         round((COALESCE(t.clicks,0)      + COALESCE(u.clicks,0)*ch.share)      * 1.03),
         round((COALESCE(t.impressions,0) + COALESCE(u.impressions,0)*ch.share) * 1.03 * ch.cpm / 1000.0, 2),
         'simulated', now()
  FROM dates d CROSS JOIN ch
  LEFT JOIN tagged t ON t.date = d.date AND t.channel = ch.channel
  LEFT JOIN untag u ON u.date = d.date;
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  INSERT INTO campaign_dsp_report
    (campaign_id, date, channel, postal_code, impressions, clicks, spend, source, pulled_at)
  SELECT p_campaign_id, NULL, '', c.postal_code,
         round(c.impressions * f.factor), round(c.clicks * f.factor), round(c.spend * f.factor, 2),
         'simulated', now()
  FROM (
    SELECT postal_code, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(spend) AS spend
    FROM campaign_cp_rollup
    WHERE campaign_id = p_campaign_id AND (actor = '' OR actor = ANY(v_channels))
    GROUP BY postal_code
  ) c
  CROSS JOIN LATERAL (
    SELECT 1.01 + (('x' || substr(md5(c.postal_code), 1, 4))::bit(16)::int % 10) / 100.0 AS factor
  ) f;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp, 'channels', to_jsonb(v_channels));
END; $$;
REVOKE ALL ON FUNCTION public.simulate_dsp_report(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_dsp_report(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_reconciliation(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_source text; v_channels text[];
  v_dsp_imps bigint := 0; v_dsp_spend numeric := 0;
  v_as_imps bigint; v_as_as_of date; v_by_channel jsonb;
BEGIN
  SELECT source INTO v_source FROM campaign_dsp_report WHERE campaign_id = p_campaign_id LIMIT 1;
  IF v_source IS NULL THEN RETURN jsonb_build_object('has_dsp_report', false); END IF;

  SELECT ARRAY(
           SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'dsps','[]'::jsonb))
           UNION SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'socials','[]'::jsonb)))
    INTO v_channels FROM dsp_campaigns WHERE id = p_campaign_id;

  SELECT COALESCE(SUM(imps),0), COALESCE(SUM(spend),0),
         COALESCE(jsonb_agg(jsonb_build_object('channel',channel,'impressions',imps,'spend',spend,'cpm',cpm,'share_pct',share_pct)
                            ORDER BY imps DESC), '[]'::jsonb)
  INTO v_dsp_imps, v_dsp_spend, v_by_channel
  FROM (
    SELECT channel, SUM(impressions) AS imps, round(SUM(spend),2) AS spend,
           CASE WHEN SUM(impressions)>0 THEN round(SUM(spend)/SUM(impressions)*1000,2) END AS cpm,
           CASE WHEN SUM(SUM(impressions)) OVER () > 0
                THEN round(SUM(impressions)::numeric/SUM(SUM(impressions)) OVER ()*100,1) END AS share_pct
    FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND date IS NOT NULL
    GROUP BY channel
  ) t;

  SELECT COALESCE(SUM(impressions),0), MAX(date) INTO v_as_imps, v_as_as_of
  FROM campaign_daily_rollup
  WHERE campaign_id = p_campaign_id AND (actor = '' OR actor = ANY(v_channels));

  RETURN jsonb_build_object(
    'has_dsp_report', true, 'source', v_source, 'as_of', v_as_as_of,
    'global', jsonb_build_object(
      'dsp_impressions', v_dsp_imps, 'adserver_impressions', v_as_imps,
      'measure_rate', CASE WHEN v_dsp_imps>0 THEN round(v_as_imps::numeric/v_dsp_imps*100,1) END,
      'gap_pct', CASE WHEN v_dsp_imps>0 THEN round((v_dsp_imps-v_as_imps)::numeric/v_dsp_imps*100,1) END,
      'dsp_spend', round(v_dsp_spend,2),
      'dsp_cpm', CASE WHEN v_dsp_imps>0 THEN round(v_dsp_spend/v_dsp_imps*1000,2) END),
    'by_channel', v_by_channel);
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_reconciliation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_reconciliation(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_reconciliation_map(
  p_campaign_id uuid, p_metric text DEFAULT 'measure',
  p_bbox_xmin float8 DEFAULT -5.5, p_bbox_ymin float8 DEFAULT 41.2,
  p_bbox_xmax float8 DEFAULT 9.8, p_bbox_ymax float8 DEFAULT 51.2)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  WITH prog AS (
    SELECT ARRAY(
             SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'dsps','[]'::jsonb))
             UNION SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'socials','[]'::jsonb))) AS chans
    FROM dsp_campaigns WHERE id = p_campaign_id
  ),
  cp AS (
    SELECT r.postal_code, SUM(r.impressions) AS impressions
    FROM campaign_cp_rollup r, prog
    WHERE r.campaign_id = p_campaign_id AND (r.actor = '' OR r.actor = ANY(prog.chans))
    GROUP BY r.postal_code
  )
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT dsp.postal_code AS code, rcp.nom_principal AS nom,
           CASE WHEN p_metric = 'dspcpm'
                THEN CASE WHEN dsp.impressions>0 THEN round(dsp.spend/dsp.impressions*1000,2) END
                ELSE CASE WHEN dsp.impressions>0 THEN round(cp.impressions::numeric/dsp.impressions*100,1) END
           END AS value,
           ST_AsGeoJSON(rcp.geom_simplified)::json AS geometry
    FROM campaign_dsp_report dsp
    JOIN cp ON cp.postal_code = dsp.postal_code
    JOIN ref_codes_postaux rcp ON rcp.code_postal = dsp.postal_code
    WHERE dsp.campaign_id = p_campaign_id AND dsp.date IS NULL AND dsp.postal_code <> ''
      AND rcp.geom_simplified && ST_MakeEnvelope(p_bbox_xmin, p_bbox_ymin, p_bbox_xmax, p_bbox_ymax, 4326)
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_reconciliation_map(uuid, text, float8, float8, float8, float8) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_reconciliation_map(uuid, text, float8, float8, float8, float8) TO service_role;
