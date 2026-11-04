-- sql/346 — Optimisation en Python, tâche 2.1 : tableaux par code postal construits DEPUIS LE PLAN.
--
-- POURQUOI. `refresh_campaign_rollups` (sql/306) part de la LIVRAISON (`dsp_campaign_data`) et lui joint le plan
-- (`raw LEFT JOIN plan`) : un code postal du plan jamais servi n'a aucune ligne dans `campaign_cp_rollup`, donc
-- n'apparaît ni dans le score (`calculer_alignement_geo` ne compte pas son manque), ni dans l'alerte « CP cibles sous
-- 70 % du plan » de `get_campaign_suivi`, ni dans les mesures du service Python. Le cahier (« Corrections de données »)
-- demande l'inverse : partir du plan, 0 si non servi.
--
-- CE QUE POSE CETTE MIGRATION (patron « jumelle » de CLAUDE.md, aucun DROP, base locale PARTAGÉE) :
--   1. `refresh_campaign_rollups_depuis_plan(p_campaign_id, p_depuis_plan)` porte LE corps. Jusqu'au premier
--      `RETURN`, c'est le corps de sql/306 recopié À L'IDENTIQUE (md5 de `prosrc` fd959875… vérifié le 05/11 contre
--      la base et contre le fichier) : avec `false`, la sortie et les tables écrites sont celles d'avant (vérifié par
--      md5 sur les 11 campagnes locales, transaction annulée). Avec `true`, une SECONDE insertion ajoute UNE ligne par
--      code du plan jamais servi : acteur '', `dept` = LEFT(code, 2), impressions, clics, dépense et fenêtres à 0,
--      `in_target` et `planned_share` du plan (même CTE `plan`). « Du plan » = ligne active de la stratégie la plus
--      récente avec `in_target` OU `planned_share > 0` (un code à multiplicateur 0 en mode strict n'est pas au plan).
--      Les codes livrés HORS plan restent (la fuite et la sur-pression en ont besoin) : plan ∪ livraison, 0 là où
--      rien n'a été servi. Une seule ligne par code non servi, acteur '' : les mesures regroupent par code
--      (`_par_code`, CTE `cp` du SQL) ; filtrées par acteur, ses sommes valent 0 (l'alerte la compte quand même).
--      La réponse ajoute `cp_non_servis` (avec `true` seulement ; sinon elle est celle d'avant, clé pour clé).
--   2. `refresh_campaign_rollups(p_campaign_id)` devient une ENVELOPPE MINCE : elle lit le réglage
--      `optimisation_reglages.parametres.tableaux_depuis_plan` (sql/345) de la campagne, `false` sans réglage — donc
--      le comportement d'avant tant que personne ne règle la campagne. Mêmes signature, droits, appelants (import
--      DSP, absorb, stratégies : aucun changement côté Next).
--
-- Le service Python construit le même tableau sans passer par cette fonction (`lecture/mesures.py`,
-- `lire_tableau_cp`, noyau `tableaux.py`) ; les deux sont tenus égaux par la fixture partagée
-- `services/optimisation/tests/parite/fixtures/tableau-depuis-plan.json` (pytest et
-- `tests/integration/rollups-depuis-plan.test.ts`).
--
-- EXPLAIN ANALYZE : voir ARCHITECTURE.md (`refresh_campaign_rollups_depuis_plan`) et le rapport de la tâche 2.4.
-- Appliquer par `psql -1 -v ON_ERROR_STOP=1`. Rejouable (`create or replace`).

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
     imps_7d, imps_prev7d, in_target, planned_share)
  WITH plan AS (
    SELECT z.postal_code,
           CASE WHEN BOOL_OR(z.part_prevue IS NOT NULL) OVER () THEN z.part_prevue
                ELSE z.bid_multiplier / NULLIF(SUM(z.bid_multiplier) OVER (), 0) END AS planned_share,
           CASE WHEN v_out_mode = 'exclusion' THEN z.bid_multiplier > 0 ELSE z.bid_multiplier > 1 END AS in_target
    FROM bidding_zone_configs z WHERE z.strategy_id = v_strategy_id AND z.is_active
  )
  SELECT p_campaign_id, q.postal_code, '', LEFT(q.postal_code, 2), 0, 0, 0, 0, 0, q.in_target, q.planned_share
  FROM (SELECT postal_code, BOOL_OR(in_target) AS in_target, MAX(planned_share) AS planned_share
          FROM plan GROUP BY postal_code) q
  WHERE (q.in_target OR q.planned_share > 0)
    AND NOT EXISTS (SELECT 1 FROM campaign_cp_rollup c
                     WHERE c.campaign_id = p_campaign_id AND c.postal_code = q.postal_code);
  GET DIAGNOSTICS v_non_servis = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp + v_non_servis, 'as_of', v_as_of,
                            'cp_non_servis', v_non_servis);
END; $function$;

-- L'originale : enveloppe mince, le réglage décide (défaut : comme avant).
CREATE OR REPLACE FUNCTION public.refresh_campaign_rollups(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT public.refresh_campaign_rollups_depuis_plan(
    p_campaign_id,
    COALESCE((SELECT CASE WHEN jsonb_typeof(r.parametres -> 'tableaux_depuis_plan') = 'boolean'
                          THEN (r.parametres ->> 'tableaux_depuis_plan')::boolean END
                FROM public.optimisation_reglages r WHERE r.campagne_id = p_campaign_id), false));
$function$;

revoke all on function public.refresh_campaign_rollups_depuis_plan(uuid, boolean) from public, anon, authenticated;
grant execute on function public.refresh_campaign_rollups_depuis_plan(uuid, boolean) to service_role;
revoke all on function public.refresh_campaign_rollups(uuid) from public, anon, authenticated;
grant execute on function public.refresh_campaign_rollups(uuid) to service_role;

notify pgrst, 'reload schema';
