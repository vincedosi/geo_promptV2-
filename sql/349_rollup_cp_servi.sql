-- sql/349 — Optimisation en Python, correctifs de la phase 2 (relecture, point I2) : distinguer « au plan » et « servi »
-- dans `campaign_cp_rollup`, et auditer CHAQUE lecteur de la table.
--
-- LE DÉFAUT. Avec le réglage `tableaux_depuis_plan` (sql/346), le rollup reçoit une ligne par code du plan JAMAIS servi
-- (acteur '', tout à 0). Ces lignes sont voulues là où l'on MESURE contre le plan, fausses là où l'on DÉCRIT ce qui a
-- été livré : `compte_cp_campagne` passait de 0 à 88 sur `4935811d`, et le pré-vol annonçait 88 CP « poussés ».
-- Une ligne non servie ne se reconnaît pas sûrement à ses zéros (une ligne livrée peut valoir 0 sous l'acteur '').
--
-- CE QUE POSE CETTE MIGRATION (aucun DROP ; base locale PARTAGÉE) :
--   1. `campaign_cp_rollup.servi boolean not null default true` — ajout de colonne à défaut constant : métadonnée
--      seule en PG17, aucune réécriture. Toute insertion existante (colonnes nommées) écrit `true` ; seule la seconde
--      insertion de `refresh_campaign_rollups_depuis_plan` écrit `false`.
--   2. `refresh_campaign_rollups_depuis_plan` : CREATE OR REPLACE, corps de sql/346 recopié, seule la seconde insertion
--      change (colonne `servi`, valeur `false`).
--   3. Les lecteurs qui DÉCRIVENT la livraison filtrent `servi` (CREATE OR REPLACE, corps en base recopié, seules les
--      lignes « sql/349 » changent) :
--        - `compte_cp_campagne` : « codes poussés » du pré-vol (`activation/prevol/route.ts:94`) et « la campagne
--          touche N CP » de la corrélation (`analyses/correlation/route.ts:131`) ;
--        - `correlation_campagne_indicateur` : une paire à 0 impression n'est pas une observation de diffusion ;
--        - `get_campaign_reconciliation_map` : l'acteur '' y vaut « mesure tous canaux » — un code non servi n'en est pas
--          une, et sa présence dépendrait du réglage, pas de la donnée ;
--        - `simulate_dsp_report` : pas de rapport DSP simulé à 0 pour un code jamais servi.
--      Les lecteurs qui MESURENT contre le plan gardent les codes non servis — c'est l'objet de la correction 2.1 :
--      `get_campaign_suivi` (alerte « CP sous X % »), `get_campaign_suivi_map` (indice 0 visible sur la carte),
--      `calculer_alignement_geo` (manque, conformes ; `n_cp` = codes mesurés, plan ∪ livraison),
--      `alignement_par_maille`, `alignement_par_maille_geo`, `alignement_dispersion_cp` (tranche < −50 %),
--      `pression_par_classe` (part du plan complète par classe). Audit complet, lecteur par lecteur :
--      `.superpowers/sdd/2026-11-04-optimisation-python/phase2-correctifs-report.md` ; preuve :
--      `tests/integration/rollups-lecteurs-servis.test.ts`.
--
-- SANS RÉGLAGE, RIEN NE CHANGE : toutes les lignes existantes valent `servi = true`, donc le filtre est neutre ; md5 des
-- sorties des 9 lecteurs sur les 11 campagnes locales identiques avant / après (rapport).
--
-- Rejouable (`add column if not exists`, `create or replace`). Appliquer par `psql -1 -v ON_ERROR_STOP=1`.

alter table public.campaign_cp_rollup add column if not exists servi boolean not null default true;

comment on column public.campaign_cp_rollup.servi is
  'sql/349 : false = code du plan jamais servi, ajouté à 0 par refresh_campaign_rollups_depuis_plan(…, true). '
  'Les lecteurs qui décrivent la livraison filtrent servi ; ceux qui mesurent contre le plan les gardent.';

-- 2. La jumelle : corps de sql/346, seconde insertion avec servi = false.
CREATE OR REPLACE FUNCTION public.refresh_campaign_rollups_depuis_plan(p_campaign_id uuid, p_depuis_plan boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_source text; v_as_of date; v_strategy_id uuid; v_out_mode text;
  v_daily int := 0; v_cp int := 0; v_non_servis int := 0;
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
           -- A8 (sql/306) : un plan qui porte sa PART PRÉVUE (jeu de zone, formule E5, sommée par unité CP, HORS_ZONE
           -- comprise) la donne telle quelle ; un plan sans part prévue (chemin risque, plans ⑥ hors jeu de zone)
           -- garde m ÷ Σ m, inchangé. Discriminant PAR STRATÉGIE : une ligne à part prévue NULL dans un plan qui en
           -- porte (unité à population inconnue, ARB-3) reste NULL, jamais m ÷ Σ m.
           CASE WHEN BOOL_OR(z.part_prevue IS NOT NULL) OVER () THEN z.part_prevue
                ELSE z.bid_multiplier / NULLIF(SUM(z.bid_multiplier) OVER (), 0) END AS planned_share,
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

  IF NOT p_depuis_plan THEN
    RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp, 'as_of', v_as_of);
  END IF;

  -- sql/346 : les codes du plan JAMAIS servis (aucune ligne livrée, tous acteurs confondus), à 0. Le CTE `plan` est
  -- celui de l'insertion ci-dessus, recopié tel quel (mêmes part et cible que pour un code servi).
  INSERT INTO campaign_cp_rollup
    (campaign_id, postal_code, actor, dept, impressions, clicks, spend,
     imps_7d, imps_prev7d, in_target, planned_share, servi)  -- sql/349 : servi = false
  WITH plan AS (
    SELECT z.postal_code,
           CASE WHEN BOOL_OR(z.part_prevue IS NOT NULL) OVER () THEN z.part_prevue
                ELSE z.bid_multiplier / NULLIF(SUM(z.bid_multiplier) OVER (), 0) END AS planned_share,
           CASE WHEN v_out_mode = 'exclusion' THEN z.bid_multiplier > 0 ELSE z.bid_multiplier > 1 END AS in_target
    FROM bidding_zone_configs z WHERE z.strategy_id = v_strategy_id AND z.is_active
  )
  SELECT p_campaign_id, q.postal_code, '', LEFT(q.postal_code, 2), 0, 0, 0, 0, 0, q.in_target, q.planned_share, false
  FROM (SELECT postal_code, BOOL_OR(in_target) AS in_target, MAX(planned_share) AS planned_share
          FROM plan GROUP BY postal_code) q
  WHERE (q.in_target OR q.planned_share > 0)
    AND NOT EXISTS (SELECT 1 FROM campaign_cp_rollup c
                     WHERE c.campaign_id = p_campaign_id AND c.postal_code = q.postal_code);
  GET DIAGNOSTICS v_non_servis = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp + v_non_servis, 'as_of', v_as_of,
                            'cp_non_servis', v_non_servis);
END; $function$;

-- 3. Lecteurs de la livraison.
CREATE OR REPLACE FUNCTION public.compte_cp_campagne(p_campaign_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(DISTINCT r.postal_code)::integer
  FROM public.campaign_cp_rollup r
  WHERE r.campaign_id = p_campaign_id AND r.postal_code IS NOT NULL
    AND r.servi;  -- sql/349 : les codes LIVRÉS seulement (pré-vol, corrélation)
$function$;


CREATE OR REPLACE FUNCTION public.correlation_campagne_indicateur(p_campaign_id uuid, p_indicator_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH imps AS (
    SELECT r.postal_code, SUM(r.impressions)::bigint AS impressions
    FROM public.campaign_cp_rollup r
    WHERE r.campaign_id = p_campaign_id AND r.servi  -- sql/349 : paires des codes livrés seulement
    GROUP BY r.postal_code
  ), paires AS (
    SELECT i.postal_code, i.impressions, v.value
    FROM imps i
    JOIN public.indicator_cp_values v
      ON v.postal_code = i.postal_code AND v.indicator_code = p_indicator_code
    ORDER BY i.postal_code
  )
  SELECT jsonb_build_object(
    'n', (SELECT count(*) FROM paires),
    'paires', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'code', postal_code, 'x', impressions, 'y', valeur))
              FROM (SELECT postal_code, impressions, value AS valeur FROM paires) p), '[]'::jsonb)
  );
$function$;


CREATE OR REPLACE FUNCTION public.get_campaign_reconciliation_map(p_campaign_id uuid, p_metric text DEFAULT 'measure'::text, p_bbox_xmin double precision DEFAULT '-5.5'::numeric, p_bbox_ymin double precision DEFAULT 41.2, p_bbox_xmax double precision DEFAULT 9.8, p_bbox_ymax double precision DEFAULT 51.2)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
      AND r.servi  -- sql/349 : l'acteur '' d'un code non servi n'est pas une mesure « tous canaux »
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
$function$;


CREATE OR REPLACE FUNCTION public.simulate_dsp_report(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
      AND servi  -- sql/349 : aucun rapport simulé pour un code jamais servi
    GROUP BY postal_code
  ) c
  CROSS JOIN LATERAL (
    SELECT 1.01 + (('x' || substr(md5(c.postal_code), 1, 4))::bit(16)::int % 10) / 100.0 AS factor
  ) f;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp, 'channels', to_jsonb(v_channels));
END; $function$;


notify pgrst, 'reload schema';
