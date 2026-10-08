-- 234 — Cloisonnement entre organisations (2026-10-08)
--
-- ── LE CONSTAT QUI A DÉCLENCHÉ CETTE MIGRATION ─────────────────────────────
--
-- On répétait que les RLS étaient « dormantes » parce que l'application passe
-- par la clé service_role. C'est vrai pour l'APPLICATION, faux pour un client :
-- la clé PUBLIQUE est dans le bundle du navigateur, et tout compte connecté
-- peut appeler `/rest/v1/<table>` avec son propre jeton. Pour cet appelant-là,
-- la RLS et les GRANT sont la seule barrière.
--
-- Mesuré le 2026-10-08, base locale, par PostgREST et un vrai compte client :
--   • `profiles_update` (id = auth.uid()) sans restriction de colonne : un
--     client DRHAT s'est fait `super_admin` de BMW GROUP, puis a lu les 177
--     concessions — et toutes les routes /api/admin lui étaient ouvertes ;
--   • `USING (true)` sur isochrones_cache, geography_zones (les 93 zones CIRFA)
--     et huit tables bidding_* : tout client lisait les données de tous ;
--   • organizations lisible en entier : chaque client voyait la liste des
--     autres clients ;
--   • quatre fonctions SECURITY DEFINER exécutables SANS CONNEXION, dont trois
--     reconstruisent des tables entières — la famille de l'incident du 28/03.
--
-- Verrouillé par tests/integration/cloisonnement-rls.test.ts, qui rejoue
-- chaque attaque avec de vrais comptes.
--
-- ── LA RÈGLE DE VISIBILITÉ D'UNE DONNÉE ────────────────────────────────────
--
-- Trois niveaux, portés par `data_sources.visibilite` :
--   • 'socle'  — données MAGELIAN (référentiels, lycées, carroyage) : tout le
--                monde les voit, sans action ;
--   • 'privee' — la source d'un client : son organisation, et elle seule ;
--   • partage  — une source privée dont `shared_with` contient l'organisation.
-- Un POI SANS source (`data_source_id is null`) est un référentiel système
-- chargé par script (arrêts de transport, installations classées) : socle.
-- Corollaire OBLIGATOIRE : un import client ne doit JAMAIS écrire un POI sans
-- source — `app/api/admin/import-poi/execute` échoue désormais plutôt que de
-- le faire.
--
-- La même règle est écrite en TypeScript dans `lib/auth/perimetre-donnees.ts`
-- pour les routes (qui contournent la RLS). Les deux doivent rester égales.

begin;

-- ── 1. Le navigateur LIT, il n'écrit jamais par PostgREST ──────────────────
-- Recensé le 2026-10-08 : le seul accès direct du navigateur est la LECTURE
-- de son propre profil (lib/auth-client.ts, angular auth.service.ts). Toute
-- écriture passe par une route serveur et la clé service_role. Retirer les
-- droits d'écriture ferme d'un coup l'auto-promotion ET toute la famille des
-- politiques d'écriture mal bornées, présentes et futures.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;

-- Les politiques qui n'ont plus d'objet : sans GRANT, elles ne s'appliqueraient
-- jamais, et les laisser ferait croire qu'elles protègent quelque chose.
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists profiles_update on public.profiles;

-- ── 2. Visibilité des sources ──────────────────────────────────────────────
alter table public.data_sources
  add column if not exists visibilite text not null default 'privee';

alter table public.data_sources drop constraint if exists data_sources_visibilite_check;
alter table public.data_sources
  add constraint data_sources_visibilite_check check (visibilite in ('socle', 'privee'));

comment on column public.data_sources.visibilite is
  'socle = visible de toutes les organisations ; privee = organisation propriétaire et shared_with. Défaut privee : une source oubliée reste FERMÉE. Règle jumelle : lib/auth/perimetre-donnees.ts';

-- Une source visible de l'organisation courante (RLS) — une seule écriture de
-- la règle côté SQL, reprise par les trois politiques ci-dessous.
create or replace function public.source_visible(p_source uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $fn$
  select p_source is null
      or get_user_role() = 'super_admin'
      or exists (
        select 1 from data_sources ds
         where ds.id = p_source
           and ds.status is distinct from 'deleted'
           and (ds.visibilite = 'socle'
                or ds.organization_id = get_user_org()
                or get_user_org() = any (ds.shared_with))
      );
$fn$;
revoke all on function public.source_visible(uuid) from public, anon;
grant execute on function public.source_visible(uuid) to authenticated, service_role;

drop policy if exists ds_select on public.data_sources;
create policy ds_select on public.data_sources for select to authenticated
  using (get_user_role() = 'super_admin'
         or (status is distinct from 'deleted'
             and (visibilite = 'socle'
                  or organization_id = get_user_org()
                  or get_user_org() = any (shared_with))));

drop policy if exists poi_france_select on public.poi_france;
create policy poi_france_select on public.poi_france for select to authenticated
  using (source_visible(data_source_id));

drop policy if exists panneaux_select on public.panneaux_affichage;
create policy panneaux_select on public.panneaux_affichage for select to authenticated
  using (source_visible(data_source_id));

-- ── 3. Les `USING (true)` sur des données de client ────────────────────────
-- Toutes lues côté serveur par service_role. Sans politique, la RLS refuse :
-- c'est l'état voulu.
drop policy if exists authenticated_read on public.isochrones_cache;          -- rend `poisForMap` : noms et coordonnées
drop policy if exists geography_zones_read on public.geography_zones;         -- les 93 zones CIRFA
drop policy if exists bidding_strategies_select on public.bidding_strategies;
drop policy if exists bidding_zone_configs_select on public.bidding_zone_configs;
drop policy if exists bidding_daily_state_select on public.bidding_daily_state;
drop policy if exists bidding_drift_events_select on public.bidding_drift_events;
drop policy if exists bidding_simulations_select on public.bidding_simulations;
drop policy if exists bss_select on public.bidding_strategy_subzones;
drop policy if exists sc_select on public.strategy_changes;
drop policy if exists adaptive_model_state_select on public.adaptive_model_state;

-- `get_user_org() IS NULL` ouvrait TOUT à un compte sans organisation.
drop policy if exists plan_snapshot_read on public.campaign_plan_snapshot;
create policy plan_snapshot_read on public.campaign_plan_snapshot for select to authenticated
  using (get_user_role() = 'super_admin'
         or campaign_id in (select id from dsp_campaigns where organization_id = get_user_org()));

-- `user_id IS NULL` rendait les retours anonymes de tous.
drop policy if exists spf_select on public.smart_prompt_feedback;
create policy spf_select on public.smart_prompt_feedback for select to authenticated
  using (user_id = auth.uid());

-- La liste des organisations est la liste des CLIENTS : un client ne voit que
-- les siennes.
-- `get_user_orgs()` (SECURITY DEFINER) lit organization_members SANS repasser
-- par sa RLS : une sous-requête directe déclencherait la récursion ci-dessous.
-- Elle était réservée à service_role depuis le durcissement du 06/07 ; une
-- politique s'évalue avec les droits de l'APPELANT, il lui faut donc
-- `authenticated`. Sans risque : comme `get_user_org`, déjà ouverte au même
-- titre, elle ne rend que les organisations de l'appelant lui-même.
grant execute on function public.get_user_orgs() to authenticated;

drop policy if exists orgs_select on public.organizations;
create policy orgs_select on public.organizations for select to authenticated
  using (get_user_role() = 'super_admin'
         or id = get_user_org()
         or id = any (get_user_orgs()));

-- Défaut PRÉEXISTANT, trouvé en écrivant la politique précédente : celle-ci
-- lisait organization_members dans sa propre condition. Toute lecture de la
-- table par un client levait « infinite recursion detected in policy ».
drop policy if exists org_members_select on public.organization_members;
create policy org_members_select on public.organization_members for select to authenticated
  using (get_user_role() = 'super_admin'
         or user_id = auth.uid()
         or (get_user_role() = 'admin' and organization_id = any (get_user_orgs())));
-- Même récursion dans la politique d'écriture ; l'écriture est retirée au §1,
-- la politique n'a plus d'objet.
drop policy if exists org_members_modify on public.organization_members;

-- ── 4. SECURITY DEFINER exécutables sans connexion ─────────────────────────
-- Appelées par les routes serveur (service_role) uniquement. `get_user_org`,
-- `get_user_role` et `st_estimatedextent` restent ouvertes À DESSEIN : les
-- politiques et PostGIS en ont besoin.
revoke execute on function public.construire_iris_bornes() from public, anon, authenticated;
revoke execute on function public.construire_iris_agg(text) from public, anon, authenticated;
revoke execute on function public.construire_zones_risque(jsonb, text, text[], numeric) from public, anon, authenticated;
revoke execute on function public.compute_filosofi_profiles_batch_2km(jsonb, numeric) from public, anon, authenticated;
grant execute on function public.construire_iris_bornes() to service_role;
grant execute on function public.construire_iris_agg(text) to service_role;
grant execute on function public.construire_zones_risque(jsonb, text, text[], numeric) to service_role;
grant execute on function public.compute_filosofi_profiles_batch_2km(jsonb, numeric) to service_role;

commit;

notify pgrst, 'reload schema';
