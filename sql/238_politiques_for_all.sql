-- 238 — Plus aucune politique FOR ALL pour un client (2026-10-09)
--
-- ── LE CONSTAT ─────────────────────────────────────────────────────────────
--
-- sql/234 a retiré les `*_select USING (true)` des tables bidding_*, mais il
-- restait des politiques plus anciennes écrites `FOR ALL USING
-- (get_user_role() in ('super_admin','admin'))`, SANS filtre d'organisation.
-- Une politique FOR ALL vaut aussi pour SELECT. Mesuré le 2026-10-09, base
-- locale, PostgREST et un vrai compte `admin` de l'espace DRHAT :
-- bidding_zone_configs rendait ses 13 377 lignes, toutes d'une AUTRE
-- organisation.
--
-- Or sql/234 a retiré TOUT droit d'écriture (INSERT/UPDATE/DELETE) à anon et
-- authenticated : ces politiques FOR ALL ne servaient donc plus QU'À LIRE.
-- Elles avaient le nom d'une politique d'écriture et l'effet d'une politique
-- de lecture — exactement le piège qui les a fait survivre à sql/234.
--
-- ── CE QUE FAIT CETTE MIGRATION ────────────────────────────────────────────
--
-- 1. Toute politique `FOR ALL` du schéma public qui n'est pas réservée à
--    service_role est éclatée en trois politiques INSERT / UPDATE / DELETE de
--    même condition, puis supprimée. L'écriture ne change pas (elle reste de
--    toute façon fermée par les GRANT) ; la lecture ne passe plus que par les
--    politiques SELECT, qui sont la règle écrite.
--    Lecture légitime vérifiée table par table avant d'écrire ceci :
--      • catalogues partagés (bidding_objectives, bidding_algorithms,
--        dsp_metrics_registry, dsp_source_mappings, data_registry,
--        iris_metadata) : SELECT `true` conservé ;
--      • organizations, data_sources, poi_france, panneaux_affichage,
--        campaign_organizations, dsp_campaign_data : leur SELECT couvre déjà
--        super_admin ET l'organisation de l'appelant ;
--      • bidding_zone_configs, _daily_state, _drift_events, _simulations,
--        _strategy_subzones, adaptive_model_state : AUCUN SELECT client, par
--        décision de sql/234 (« lues côté serveur par service_role ») ;
--      • smart_prompt_feedback : chacun lit ses retours (spf_select).
--    Aucun code navigateur ne lit ces tables : le seul `.from()` du navigateur
--    est `profiles` (lib/auth-client.ts, angular auth.service.ts).
-- 2. Les trois SELECT `*_org_read` (agent_chat_messages, agent_recommendations,
--    bidding_curve_history) finissaient par `OR get_user_role() in
--    ('super_admin','admin')` — la même fuite — et levaient de toute façon
--    « infinite recursion » (42P17) pour TOUT compte, par la RLS de
--    campaign_organizations / dsp_campaigns. Supprimées : comme
--    bidding_strategies (sql/234), ces tables se lisent côté serveur.
-- 3. Même défaut sur trois SELECT « le mien ou admin » (bidding_agent_actions,
--    bidding_strategy_drafts, agent_autonomy_settings) : un admin d'espace
--    lisait les brouillons de tous les utilisateurs. Ramenées à « le mien, ou
--    super_admin ».
--
-- Rejouable : la boucle ne trouve plus rien au second passage, et chaque
-- création est précédée de son `drop policy if exists`.
-- Verrouillé par tests/integration/cloisonnement-rls.test.ts (compte admin
-- d'espace) et tests/integration/politiques-for-all.test.ts.

begin;

-- ── 1. FOR ALL → INSERT / UPDATE / DELETE ──────────────────────────────────
do $do$
declare
  p record;
  v_roles text;
  v_mode text;
  v_check text;
begin
  for p in
    select tablename, policyname, permissive, roles, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and cmd = 'ALL'
       and roles <> '{service_role}'::name[]
       and coalesce(qual, '') <> '(auth.role() = ''service_role''::text)'
  loop
    select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ')
      into v_roles from unnest(p.roles) as r;
    v_mode := case when p.permissive = 'RESTRICTIVE' then 'restrictive' else 'permissive' end;
    v_check := coalesce(p.with_check, p.qual);

    execute format('drop policy if exists %I on public.%I', p.policyname || '_insert', p.tablename);
    execute format('drop policy if exists %I on public.%I', p.policyname || '_update', p.tablename);
    execute format('drop policy if exists %I on public.%I', p.policyname || '_delete', p.tablename);

    execute format('create policy %I on public.%I as %s for insert to %s with check (%s)',
                   p.policyname || '_insert', p.tablename, v_mode, v_roles, v_check);
    execute format('create policy %I on public.%I as %s for update to %s using (%s)%s',
                   p.policyname || '_update', p.tablename, v_mode, v_roles, p.qual,
                   case when p.with_check is not null
                        then format(' with check (%s)', p.with_check) else '' end);
    execute format('create policy %I on public.%I as %s for delete to %s using (%s)',
                   p.policyname || '_delete', p.tablename, v_mode, v_roles, p.qual);

    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    raise notice 'FOR ALL éclatée : %.%', p.tablename, p.policyname;
  end loop;
end
$do$;

-- ── 2. Les SELECT `*_org_read` : fuite admin + récursion ───────────────────
drop policy if exists agent_chat_org_read on public.agent_chat_messages;
drop policy if exists agent_reco_org_read on public.agent_recommendations;
drop policy if exists curve_history_org_read on public.bidding_curve_history;

-- ── 3. « Le mien, ou admin » → « le mien, ou super_admin » ─────────────────
drop policy if exists baa_select_own_or_admin on public.bidding_agent_actions;
drop policy if exists baa_select_own on public.bidding_agent_actions;
create policy baa_select_own on public.bidding_agent_actions for select to authenticated
  using (user_id = auth.uid() or get_user_role() = 'super_admin');

drop policy if exists bsd_select on public.bidding_strategy_drafts;
create policy bsd_select on public.bidding_strategy_drafts for select to authenticated
  using (user_id = auth.uid() or get_user_role() = 'super_admin');

drop policy if exists aas_select_own on public.agent_autonomy_settings;
create policy aas_select_own on public.agent_autonomy_settings for select to authenticated
  using (user_id = auth.uid() or get_user_role() = 'super_admin');

commit;

notify pgrst, 'reload schema';
