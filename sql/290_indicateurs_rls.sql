-- 290 — Lecture des indicateurs par PostgREST direct : la règle des sources (2026-10-28, lot « Catalogue et groupes »,
-- tour 1 de relecture, constat n° 2)
--
-- POURQUOI : depuis sql/288, un indicateur peut être privé à un espace (cible_indicator_registry.data_source_id). Les
-- routes le cachent (indicateursVisibles, service_role), mais la clé PUBLIQUE est dans le bundle du navigateur : un
-- compte connecté peut appeler /rest/v1/<table> avec son propre jeton, et pour lui la RLS est la SEULE barrière
-- (tests/integration/cloisonnement-rls.test.ts). Trois policies le laissaient tout lire :
--   cible_indicator_registry  cible_registry_read_auth  USING (true)
--   indicator_cp_values       icv_read_auth             USING (true)
--   dataset_abstention_2022   abstention_2022_select    USING (auth.uid() IS NOT NULL)
-- soit les VALEURS de l'abstention, même privée à Bercy, pour un compte BMW.
--
-- RÈGLE : celle de poi_france_select (sql/234) — source_visible(data_source_id) : sans source = socle, sinon la
-- source doit être visible de l'espace du compte (super_admin : tout, comme source_visible).
--   · registre : par sa colonne data_source_id ;
--   · indicator_cp_values : par la ligne du registre de son indicateur (semi-jointure) ;
--   · dataset_abstention_2022 : par l'indicateur du registre qui LIT cette table (data_source = 'abstention') —
--     aucun identifiant écrit en dur.
-- service_role contourne la RLS : les routes sont inchangées.
--
-- Coût mesuré (EXPLAIN dans le rapport du tour 1) : le registre fait 19 lignes ; la condition des deux autres tables
-- est un sous-plan évalué une fois (initPlan) ou une semi-jointure hachée sur ces 19 lignes.
--
-- Rejouable : DROP POLICY IF EXISTS + CREATE POLICY dans une transaction. Aucune fonction créée ni supprimée.

begin;

drop policy if exists cible_registry_read_auth on public.cible_indicator_registry;
create policy cible_registry_read_auth on public.cible_indicator_registry
  for select to authenticated
  using (public.source_visible(data_source_id));

drop policy if exists icv_read_auth on public.indicator_cp_values;
create policy icv_read_auth on public.indicator_cp_values
  for select to authenticated
  using (exists (
    select 1 from public.cible_indicator_registry r
    where r.indicator_code = indicator_cp_values.indicator_code
      and public.source_visible(r.data_source_id)
  ));

drop policy if exists abstention_2022_select on public.dataset_abstention_2022;
create policy abstention_2022_select on public.dataset_abstention_2022
  for select to authenticated
  using (exists (
    select 1 from public.cible_indicator_registry r
    where r.data_source = 'abstention'
      and public.source_visible(r.data_source_id)
  ));

commit;
