-- sql/345 — Optimisation en Python, tâche 2.3 : table `optimisation_reglages` et seuils d'alerte réglables.
--
-- POURQUOI. Les seuils d'alerte du suivi étaient écrits en dur (plan 2026-11-04-optimisation-python-architecture.md
-- § 2.2) : rythme « en retard » 0,85 (grave 0,70) et « en avance » 1,15 (grave 1,30), CPM > prévu × 1,25, CP cibles
-- sous 70 % du plan, fuite hors cible > 5 % — dans `get_campaign_suivi` (sql/113:211-246) et recopiés à l'identique
-- dans le service Python (`noyau/mesures.py`) ; ± 20 % des constats (`lib/campagne/constats.ts:76`). Le cahier demande
-- qu'ils deviennent des paramètres PAR CAMPAGNE.
--
-- CE QUE POSE CETTE MIGRATION.
--   1. `optimisation_reglages` (plan § 9.2) : une ligne par campagne, `workspace_id` (même nom que la revendication JWT
--      du crochet `custom_access_token_hook`, plan § 9.1 ; vaut `dsp_campaigns.organization_id` à l'écriture),
--      `algo_id` (défaut `uniformiser_global` ; la colonne seule, sa logique est la tâche 2.7), `parametres jsonb`.
--      Forme de `parametres` (toutes les clés FACULTATIVES ; une clé absente = la valeur d'avant) :
--        { "seuils": { "rythme_retard": 0.85, "rythme_retard_grave": 0.70, "rythme_avance": 1.15,
--                      "rythme_avance_grave": 1.30, "cpm_depassement": 1.25, "cp_sous_plan_pct": 70,
--                      "fuite_pct": 5, "ecart_signale_pct": 20 },
--          "tableaux_depuis_plan": false,       -- tâche 2.1 (sql/346) : tableaux par CP depuis le plan
--          "univers_methode_a": "fige" }        -- tâche 2.2 : univers du plan méthode A ('fige' | 'referentiel')
--      Validée par `optimisation_parametres_valides` (CHECK) ET par Pydantic côté Python (`lecture/reglages.py`) ;
--      la fonction se remplace (`create or replace`) quand une phase ajoute une clé, sans toucher la contrainte.
--   2. RLS ACTIVE AVEC POLICY ÉCRITE (plan § 9.3) : lecture par `authenticated` calquée sur `dsp_campaigns_select`,
--      plus l'espace propriétaire, le partage lu par `campagne_partagee_avec_mon_espace` (voir § 4 : la forme
--      directe récursait) ; AUCUNE policy d'écriture et REVOKE explicite pour `anon` / `authenticated` (toute
--      écriture passe par Next → Python). Testé par `tests/integration/optimisation-rls.test.ts`.
--   3. Droits du rôle `optimisation_service` (sql/342) : SELECT, INSERT, UPDATE — pas DELETE.
--   4. `get_campaign_suivi` : CREATE OR REPLACE, même signature, corps en base RECOPIÉ (md5 de `prosrc` b27fd7c2… le
--      05/11) ; seules les lignes marquées « sql/345 » changent. Sans réglage, les seuils valent exactement les
--      littéraux d'avant : vérifié par md5 de la sortie des 11 campagnes locales, avant / après.
--
-- `ecart_signale_pct` (± 20 %) est accepté et validé mais N'EST LU PAR PERSONNE ici : il vit dans
-- `lib/campagne/constats.ts` (affichage React gelé, plan § 2.1) ; le brancher est hors de cette tâche.
--
-- Idempotente : `if not exists`, `create or replace`, policy créée sous garde, aucun DROP de table ni de fonction.
-- Appliquer par `psql -1 -v ON_ERROR_STOP=1`.

-- 1. Lecture d'un seuil : la valeur réglée si c'est un nombre, sinon le défaut (réglage absent, clé absente).
create or replace function public.optimisation_seuil(p_parametres jsonb, p_cle text, p_defaut numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case when jsonb_typeof(p_parametres -> 'seuils' -> p_cle) = 'number'
              then (p_parametres -> 'seuils' ->> p_cle)::numeric
              else p_defaut end
$$;

-- 2. Validation de `parametres` (immuable : utilisable dans un CHECK).
create or replace function public.optimisation_parametres_valides(p jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_typeof(p) = 'object', false)
     -- Clés connues seulement (comme `extra="forbid"` côté Python) : une faute de frappe est refusée, jamais ignorée.
     and case when jsonb_typeof(p) = 'object'
              then not exists (select 1 from jsonb_object_keys(p) k
                                where k not in ('seuils', 'tableaux_depuis_plan', 'univers_methode_a'))
              else false end
     and (not (p ? 'seuils') or (
           jsonb_typeof(p -> 'seuils') = 'object'
       and not exists (
             select 1 from jsonb_each(p -> 'seuils') e(cle, valeur)
              where e.cle not in ('rythme_retard', 'rythme_retard_grave', 'rythme_avance', 'rythme_avance_grave',
                                  'cpm_depassement', 'cp_sous_plan_pct', 'fuite_pct', 'ecart_signale_pct')
                 -- CASE et non OR : l'ordre d'évaluation d'un OR n'est pas garanti, le cast d'un texte lèverait.
                 or case when jsonb_typeof(e.valeur) = 'number' then (e.valeur #>> '{}')::numeric <= 0
                         else true end)))
     and (not (p ? 'tableaux_depuis_plan') or jsonb_typeof(p -> 'tableaux_depuis_plan') = 'boolean')
     and (not (p ? 'univers_methode_a') or (p ->> 'univers_methode_a') in ('fige', 'referentiel'))
     -- Ordre des seuils de rythme, défauts compris (mêmes règles que `Seuils._ordonnes` côté Python).
     and public.optimisation_seuil(p, 'rythme_retard_grave', 0.70) <= public.optimisation_seuil(p, 'rythme_retard', 0.85)
     and public.optimisation_seuil(p, 'rythme_avance_grave', 1.30) >= public.optimisation_seuil(p, 'rythme_avance', 1.15)
     and public.optimisation_seuil(p, 'rythme_retard', 0.85) < public.optimisation_seuil(p, 'rythme_avance', 1.15)
$$;

-- 3. La table.
create table if not exists public.optimisation_reglages (
  campagne_id  uuid primary key references public.dsp_campaigns(id) on delete cascade,
  workspace_id uuid not null references public.organizations(id),
  algo_id      text not null default 'uniformiser_global',
  parametres   jsonb not null default '{}'::jsonb
               constraint optimisation_reglages_parametres_valides
               check (public.optimisation_parametres_valides(parametres)),
  maj_par      uuid references auth.users(id) on delete set null,
  maj_le       timestamptz not null default now()
);

create index if not exists optimisation_reglages_workspace on public.optimisation_reglages (workspace_id);

comment on table public.optimisation_reglages is
  'Réglages d''optimisation par campagne (sql/345) : algo_id (tâche 2.7) et parametres (seuils d''alerte, bascules '
  'des tâches 2.1-2.2). Écrit par le service Python seul ; lu par get_campaign_suivi, refresh_campaign_rollups et Python.';

-- 4. RLS avec policy écrite (plan § 9.3).
--
-- Le partage passe par une fonction SECURITY DEFINER et non par un `exists (… campaign_organizations …)` écrit dans la
-- policy : mesuré le 05/11, la forme directe rend 42P17 « infinite recursion detected in policy » à TOUT compte connecté
-- — la policy `campaign_orgs_select` lit `dsp_campaigns`, dont la policy `dsp_campaigns_select` relit
-- `campaign_organizations`. La fonction lit `campaign_organizations` sans RLS et ne rend qu'un booléen pour l'espace
-- du jeton (`get_user_org()`), jamais une ligne.
create or replace function public.campagne_partagee_avec_mon_espace(p_campagne uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (select 1 from public.campaign_organizations co
                  where co.campaign_id = p_campagne and co.organization_id = public.get_user_org())
$$;

revoke all on function public.campagne_partagee_avec_mon_espace(uuid) from public, anon;
grant execute on function public.campagne_partagee_avec_mon_espace(uuid) to authenticated, service_role;

alter table public.optimisation_reglages enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'public.optimisation_reglages'::regclass
                  and polname = 'optimisation_reglages_select') then
    create policy optimisation_reglages_select on public.optimisation_reglages
      for select to authenticated
      using (
        public.get_user_role() = 'super_admin'
        or workspace_id = public.get_user_org()
        or public.campagne_partagee_avec_mon_espace(campagne_id)
      );
  else
    -- Rejouable sans DROP : la condition est réécrite telle quelle si la policy existe déjà.
    alter policy optimisation_reglages_select on public.optimisation_reglages
      to authenticated
      using (
        public.get_user_role() = 'super_admin'
        or workspace_id = public.get_user_org()
        or public.campagne_partagee_avec_mon_espace(campagne_id)
      );
  end if;
end $$;

revoke all on table public.optimisation_reglages from anon;
revoke insert, update, delete, truncate, references, trigger on table public.optimisation_reglages from authenticated;
grant select on table public.optimisation_reglages to authenticated;

grant select, insert, update on table public.optimisation_reglages to optimisation_service;
revoke delete, truncate on table public.optimisation_reglages from optimisation_service;

revoke all on function public.optimisation_parametres_valides(jsonb) from public, anon, authenticated;
revoke all on function public.optimisation_seuil(jsonb, text, numeric) from public, anon, authenticated;
grant execute on function public.optimisation_parametres_valides(jsonb) to service_role, optimisation_service;
grant execute on function public.optimisation_seuil(jsonb, text, numeric) to service_role, optimisation_service;

-- 5. get_campaign_suivi : seuils lus dans les réglages (lignes « sql/345 »), le reste recopié de la base.
CREATE OR REPLACE FUNCTION public.get_campaign_suivi(p_campaign_id uuid, p_actors text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  s record;
  v_as_of date; v_spend numeric := 0; v_imps bigint := 0;
  v_budget_pct numeric; v_time_pct numeric; v_index numeric;
  v_cpm_real numeric; v_cpm_delta numeric;
  v_cp_total_imps bigint := 0; v_in_imps bigint := 0; v_in_spend numeric := 0;
  v_out_imps bigint := 0; v_out_spend numeric := 0; v_in_planned numeric := 0;
  v_in_share numeric; v_out_share numeric;
  v_plan_in_cps int := 0; v_plan_out_cps int := 0;
  v_requested numeric; v_obtained numeric;
  v_realized bigint; v_expected numeric; v_obj_pct numeric; v_obj_basis text;
  v_zones_under int := 0; v_zones_over int := 0;
  v_alerts jsonb := '[]'::jsonb;
  v_level1 jsonb; v_depts jsonb; v_daily jsonb; v_medias jsonb;
  v_under record;
  -- sql/345 : seuils d'alerte lus dans optimisation_reglages.parametres.seuils ; défaut = les valeurs d'avant.
  v_p jsonb;
  v_rythme_retard numeric; v_rythme_retard_grave numeric; v_rythme_avance numeric; v_rythme_avance_grave numeric;
  v_cpm_depassement numeric; v_cp_sous_plan_pct numeric; v_fuite_pct numeric;
BEGIN
  SELECT r.parametres INTO v_p FROM optimisation_reglages r WHERE r.campagne_id = p_campaign_id;  -- sql/345
  v_rythme_retard       := public.optimisation_seuil(v_p, 'rythme_retard', 0.85);        -- sql/345
  v_rythme_retard_grave := public.optimisation_seuil(v_p, 'rythme_retard_grave', 0.70);  -- sql/345
  v_rythme_avance       := public.optimisation_seuil(v_p, 'rythme_avance', 1.15);        -- sql/345
  v_rythme_avance_grave := public.optimisation_seuil(v_p, 'rythme_avance_grave', 1.30);  -- sql/345
  v_cpm_depassement     := public.optimisation_seuil(v_p, 'cpm_depassement', 1.25);      -- sql/345
  v_cp_sous_plan_pct    := public.optimisation_seuil(v_p, 'cp_sous_plan_pct', 70);       -- sql/345
  v_fuite_pct           := public.optimisation_seuil(v_p, 'fuite_pct', 5);               -- sql/345

  SELECT s2.id, s2.total_budget, s2.forecast_cpm, s2.start_date, s2.end_date,
         s2.out_zone_weights->>'mode' AS out_mode, s2.kpi_target, s2.objective_code
  INTO s FROM bidding_strategies s2 WHERE s2.campaign_id = p_campaign_id
  ORDER BY s2.created_at DESC LIMIT 1;
  IF s.id IS NULL THEN RETURN jsonb_build_object('error', 'no_strategy'); END IF;

  -- Daily (filtré par acteur)
  SELECT MAX(date), COALESCE(SUM(spend), 0), COALESCE(SUM(impressions), 0)
  INTO v_as_of, v_spend, v_imps
  FROM campaign_daily_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));
  IF v_as_of IS NULL THEN RETURN jsonb_build_object('error', 'no_rollup'); END IF;

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

  IF v_imps > 0 THEN v_cpm_real := ROUND(v_spend / v_imps * 1000, 2); END IF;
  IF v_cpm_real IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_cpm_delta := ROUND((v_cpm_real - s.forecast_cpm) / s.forecast_cpm * 100, 1);
  END IF;

  -- Délivrance cible/hors cible (filtrée). in_target constant par CP → FILTER sûr.
  SELECT COALESCE(SUM(impressions), 0),
         COALESCE(SUM(impressions) FILTER (WHERE in_target), 0),
         COALESCE(SUM(spend) FILTER (WHERE in_target), 0),
         COALESCE(SUM(impressions) FILTER (WHERE NOT in_target), 0),
         COALESCE(SUM(spend) FILTER (WHERE NOT in_target), 0)
  INTO v_cp_total_imps, v_in_imps, v_in_spend, v_out_imps, v_out_spend
  FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));

  -- Part planifiée cible = PLAN (non filtré par acteur, distinct par CP).
  SELECT COALESCE(SUM(planned_share), 0) INTO v_in_planned
  FROM (SELECT DISTINCT postal_code, planned_share, in_target
        FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id) t
  WHERE in_target;

  IF v_cp_total_imps > 0 THEN
    v_in_share := ROUND(v_in_imps::numeric / v_cp_total_imps * 100, 1);
    v_out_share := ROUND(v_out_imps::numeric / v_cp_total_imps * 100, 1);
  END IF;

  SELECT COUNT(*) FILTER (WHERE CASE WHEN s.out_mode = 'exclusion' THEN bid_multiplier > 0 ELSE bid_multiplier > 1 END),
         COUNT(*) FILTER (WHERE NOT (CASE WHEN s.out_mode = 'exclusion' THEN bid_multiplier > 0 ELSE bid_multiplier > 1 END)),
         MAX(bid_multiplier)
  INTO v_plan_in_cps, v_plan_out_cps, v_requested
  FROM bidding_zone_configs WHERE strategy_id = s.id AND is_active;

  IF s.out_mode = 'exclusion' THEN
    v_requested := NULL; v_obtained := NULL;
  ELSIF v_plan_in_cps > 0 AND v_plan_out_cps > 0 AND v_out_imps > 0 THEN
    v_obtained := ROUND((v_in_imps::numeric / v_plan_in_cps) / NULLIF(v_out_imps::numeric / v_plan_out_cps, 0), 2);
  END IF;

  -- Objectif (expected = global via helper ; realized = filtré)
  v_realized := v_imps;
  v_expected := public.get_campaign_expected(p_campaign_id);
  IF s.kpi_target IS NOT NULL AND s.kpi_target > 0 AND s.objective_code = 'maximize_impressions' THEN
    v_obj_basis := 'kpi';
  ELSIF s.total_budget IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_obj_basis := 'forecast';
  END IF;
  IF v_expected IS NOT NULL AND v_expected > 0 THEN
    v_obj_pct := ROUND(v_realized / v_expected * 100, 1);
  END IF;

  -- Alertes (identiques ; sur données filtrées)
  IF v_index IS NOT NULL AND v_index < v_rythme_retard THEN  -- sql/345
    v_alerts := v_alerts || jsonb_build_object('kind', 'pacing',
      'severity', CASE WHEN v_index < v_rythme_retard_grave THEN 'danger' ELSE 'warning' END,
      'title', 'Pacing en retard de ' || ROUND(v_time_pct - v_budget_pct) || ' points',
      'detail', v_budget_pct || ' % du budget pour ' || v_time_pct || ' % du temps');
  ELSIF v_index IS NOT NULL AND v_index > v_rythme_avance THEN  -- sql/345
    v_alerts := v_alerts || jsonb_build_object('kind', 'pacing',
      'severity', CASE WHEN v_index > v_rythme_avance_grave THEN 'danger' ELSE 'warning' END,
      'title', 'Pacing en avance de ' || ROUND(v_budget_pct - v_time_pct) || ' points',
      'detail', v_budget_pct || ' % du budget pour ' || v_time_pct || ' % du temps');
  END IF;
  IF v_cpm_real IS NOT NULL AND s.forecast_cpm IS NOT NULL AND v_cpm_real > s.forecast_cpm * v_cpm_depassement THEN  -- sql/345
    v_alerts := v_alerts || jsonb_build_object('kind', 'cpm', 'severity', 'danger',
      'title', 'CPM à ' || v_cpm_real || ' € — +' || v_cpm_delta || ' % vs prévu',
      'detail', 'CPM prévu : ' || ROUND(s.forecast_cpm, 2) || ' €');
  END IF;

  WITH cp AS (
    SELECT postal_code, in_target, planned_share,
           COALESCE(SUM(impressions) FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS impressions,
           COALESCE(SUM(spend)       FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS spend
    FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id
    GROUP BY postal_code, in_target, planned_share
  )
  SELECT COUNT(*) AS n, COALESCE(SUM(spend), 0) AS sp, COALESCE(SUM(impressions), 0) AS im
  INTO v_under
  FROM cp
  WHERE in_target AND planned_share > 0
    AND (impressions::numeric / NULLIF(v_cp_total_imps, 0)) / planned_share * 100 < v_cp_sous_plan_pct;  -- sql/345
  IF v_under.n > 0 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'zones_under', 'severity', 'warning',
      'title', v_under.n || ' CP cibles sous ' || v_cp_sous_plan_pct || ' % du plan',  -- sql/345
      'detail', ROUND(v_under.sp) || ' € de spend · '
        || ROUND(v_under.im::numeric / NULLIF(v_in_imps, 0) * 100, 1) || ' % du volume cible');
  END IF;
  IF s.out_mode = 'exclusion' AND COALESCE(v_out_share, 0) > v_fuite_pct THEN  -- sql/345
    v_alerts := v_alerts || jsonb_build_object('kind', 'leak', 'severity', 'warning',
      'title', v_out_share || ' % du volume hors de la cible',
      'detail', 'Zones strictes : la diffusion hors cible devrait être ~0');
  END IF;

  v_level1 := jsonb_build_array(
    jsonb_build_object('zone', 'cible', 'impressions', v_in_imps, 'share_real', v_in_share,
      'share_plan', ROUND(v_in_planned * 100, 1),
      'cpm', CASE WHEN v_in_imps > 0 THEN ROUND(v_in_spend / v_in_imps * 1000, 2) END,
      'spend', ROUND(v_in_spend, 2)),
    jsonb_build_object('zone', 'hors_cible', 'impressions', v_out_imps, 'share_real', v_out_share,
      'share_plan', ROUND((1 - v_in_planned) * 100, 1),
      'cpm', CASE WHEN v_out_imps > 0 THEN ROUND(v_out_spend / v_out_imps * 1000, 2) END,
      'spend', ROUND(v_out_spend, 2)));

  -- Départements : CTE cp (délivrance FILTRÉE dans le SUM, CP conservés).
  WITH cp AS (
    SELECT postal_code, dept, in_target, planned_share,
           COALESCE(SUM(impressions) FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS impressions,
           COALESCE(SUM(spend)       FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS spend,
           COALESCE(SUM(imps_7d)     FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS imps_7d,
           COALESCE(SUM(imps_prev7d) FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS imps_prev7d
    FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id
    GROUP BY postal_code, dept, in_target, planned_share
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.hold_index ASC NULLS LAST), '[]'::jsonb)
  INTO v_depts
  FROM (
    SELECT dept, BOOL_OR(in_target) AS in_target, SUM(impressions) AS impressions,
           CASE WHEN SUM(planned_share) > 0 AND v_cp_total_imps > 0
                THEN ROUND((SUM(impressions)::numeric / v_cp_total_imps) / SUM(planned_share) * 100) END AS hold_index,
           CASE WHEN SUM(planned_share) FILTER (WHERE in_target) > 0 AND v_expected > 0
                THEN ROUND(SUM(impressions) FILTER (WHERE in_target)::numeric
                     / (SUM(planned_share) FILTER (WHERE in_target) * v_expected) * 100) END AS objective_alignment,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm,
           ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(imps_prev7d) > 0
                THEN ROUND((SUM(imps_7d) - SUM(imps_prev7d))::numeric / SUM(imps_prev7d) * 100, 1) END AS delta7_pct
    FROM cp WHERE dept IS NOT NULL GROUP BY dept
  ) t;

  -- Zones sous/au-dessus objectif (CP cibles) pour le bandeau d'écarts.
  IF v_expected IS NOT NULL AND v_expected > 0 THEN
    WITH cp AS (
      SELECT postal_code, in_target, planned_share,
             COALESCE(SUM(impressions) FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS impressions
      FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id
      GROUP BY postal_code, in_target, planned_share
    )
    SELECT COUNT(*) FILTER (WHERE impressions / (planned_share * v_expected) * 100 < 90),
           COUNT(*) FILTER (WHERE impressions / (planned_share * v_expected) * 100 > 110)
    INTO v_zones_under, v_zones_over
    FROM cp WHERE in_target AND planned_share > 0;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date), '[]'::jsonb) INTO v_daily
  FROM (
    SELECT date, SUM(impressions) AS impressions, ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm
    FROM campaign_daily_rollup
    WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors))
    GROUP BY date
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.impressions DESC), '[]'::jsonb) INTO v_medias
  FROM (
    SELECT media, SUM(impressions) AS impressions, ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm
    FROM campaign_daily_rollup
    WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors))
    GROUP BY media
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
      'kpi_target', s.kpi_target, 'realized', v_realized,
      'expected', ROUND(COALESCE(v_expected, 0)), 'pct', v_obj_pct),
    'objective_zones', jsonb_build_object('under', v_zones_under, 'over', v_zones_over),
    'alerts', v_alerts, 'level1', v_level1, 'depts', v_depts, 'daily', v_daily, 'medias', v_medias);
END; $function$

;

notify pgrst, 'reload schema';
