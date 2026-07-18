-- ============================================================
-- 115 — simulate_dsp_report : agrège par date AVANT le CROSS JOIN canaux
-- ============================================================
-- Contexte : sql/113 (rollups par acteur) a fait grouper campaign_daily_rollup
-- par (date, media, actor) — une campagne avec plusieurs acteurs a désormais
-- PLUSIEURS lignes par date (une par acteur), alors que simulate_dsp_report
-- (sql/111) suppose encore 1 ligne/date et fait `campaign_daily_rollup r
-- CROSS JOIN ch` directement : avec N acteurs, N lignes daily × canaux →
-- violation idx_campaign_dsp_report_unique (campaign_id, date, channel,
-- postal_code, format, creative_ref) — plusieurs lignes retombent sur le
-- même (date, channel).
--
-- Découvert en appliquant sql/112 (attribution acteur du seed démo, task 6) :
-- 23505 duplicate key sur idx_campaign_dsp_report_unique après l'ajout de
-- l'attribution à 5 acteurs.
--
-- Fix : agréger campaign_daily_rollup par date (SUM impressions/clicks tous
-- médias/acteurs confondus) dans un CTE `daily` avant de croiser avec les
-- canaux déclarés — restaure le grain « 1 ligne/date » attendu par le reste
-- de la fonction. Non-régression stricte pour les campagnes sans acteur
-- (actor = '' partout → 1 ligne/date déjà, SUM = valeur inchangée).
-- Grain CP (campaign_cp_rollup) inchangé : sql/113 y a AUSSI ajouté `actor`
-- au GROUP BY mais campaign_cp_rollup collapse par (postal_code, actor) —
-- cette INSERT lit campaign_cp_rollup directement (pas de re-scan ici) et
-- boucle déjà 1 ligne/CP-acteur ; la PK CP a été redéfinie sur
-- (campaign_id, postal_code, actor) dans sql/113, donc l'unicité de
-- campaign_dsp_report côté CP (campaign_id, date=NULL, channel='',
-- postal_code, format, creative_ref) resterait, elle aussi, en conflit si
-- plusieurs acteurs partagent le même postal_code : cf. remarque ci-dessous.

CREATE OR REPLACE FUNCTION public.simulate_dsp_report(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_channels text[];
  v_budgets jsonb;
  v_demo_cpm jsonb;
  v_total_budget numeric;
  v_daily int := 0; v_cp int := 0;
BEGIN
  SELECT ARRAY(
           SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'dsps','[]'::jsonb))
           UNION
           SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'socials','[]'::jsonb))),
         COALESCE(geo_strategy->'channels'->'budgets', '{}'::jsonb),
         COALESCE(geo_strategy->'channels'->'demo_cpm', '{}'::jsonb)
    INTO v_channels, v_budgets, v_demo_cpm
  FROM dsp_campaigns WHERE id = p_campaign_id;

  IF v_channels IS NULL OR array_length(v_channels, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'no_channels');
  END IF;

  SELECT GREATEST(SUM(COALESCE((v_budgets->>ch)::numeric, 0)), 0)
    INTO v_total_budget FROM unnest(v_channels) ch;

  DELETE FROM campaign_dsp_report WHERE campaign_id = p_campaign_id AND source = 'simulated';

  -- Grain daily : date × canal (depuis campaign_daily_rollup, ~30 lignes).
  -- `daily` collapse d'abord tous médias/acteurs par date (grain attendu par
  -- ce générateur) — sinon N lignes/date (N acteurs) × canaux dupliquerait
  -- la clé (campaign_id, date, channel, '', '', '').
  WITH ch AS (
    SELECT c AS channel,
           CASE WHEN v_total_budget > 0
                THEN COALESCE((v_budgets->>c)::numeric, 0) / v_total_budget
                ELSE 1.0 / array_length(v_channels, 1) END AS share,
           -- CPM : override démo (geo_strategy.channels.demo_cpm) sinon défaut par canal.
           COALESCE((v_demo_cpm->>c)::numeric,
                    CASE c WHEN 'dv360' THEN 6.1 WHEN 'ttd' THEN 6.4
                           WHEN 'tiktok' THEN 6.0 WHEN 'meta' THEN 6.6 ELSE 6.2 END) AS cpm
    FROM unnest(v_channels) c
  ),
  daily AS (
    SELECT date, SUM(impressions) AS impressions, SUM(clicks) AS clicks
    FROM campaign_daily_rollup
    WHERE campaign_id = p_campaign_id
    GROUP BY date
  )
  INSERT INTO campaign_dsp_report
    (campaign_id, date, channel, postal_code, impressions, clicks, spend, source, pulled_at)
  SELECT p_campaign_id, daily.date, ch.channel, '',
         round(daily.impressions * 1.03 * ch.share),
         round(daily.clicks * 1.03 * ch.share),
         round(daily.impressions * 1.03 * ch.share * ch.cpm / 1000.0, 2),
         'simulated', now()
  FROM daily CROSS JOIN ch;
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  -- Grain CP : postal_code (depuis campaign_cp_rollup, collapse par
  -- (postal_code) tous acteurs confondus — même raison que ci-dessus : la PK
  -- de campaign_cp_rollup est (campaign_id, postal_code, actor) depuis
  -- sql/113, donc un CP livré par plusieurs acteurs y a plusieurs lignes.
  -- Sur-déclaration variable par CP (1,01-1,10) → taux de mesure 91-99 %.
  INSERT INTO campaign_dsp_report
    (campaign_id, date, channel, postal_code, impressions, clicks, spend, source, pulled_at)
  SELECT p_campaign_id, NULL, '', c.postal_code,
         round(c.impressions * f.factor),
         round(c.clicks * f.factor),
         round(c.spend * f.factor, 2),
         'simulated', now()
  FROM (
    SELECT postal_code, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(spend) AS spend
    FROM campaign_cp_rollup
    WHERE campaign_id = p_campaign_id
    GROUP BY postal_code
  ) c
  CROSS JOIN LATERAL (
    SELECT 1.01 + (('x' || substr(md5(c.postal_code), 1, 4))::bit(16)::int % 10) / 100.0 AS factor
  ) f;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp,
                            'channels', to_jsonb(v_channels));
END;
$$;
REVOKE ALL ON FUNCTION public.simulate_dsp_report(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_dsp_report(uuid) TO service_role;
