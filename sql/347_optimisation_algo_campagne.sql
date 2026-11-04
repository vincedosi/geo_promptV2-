-- sql/347 — Optimisation en Python, tâche 2.7 : algorithme de correction PAR CAMPAGNE, et son journal.
--
-- POURQUOI. Le plan (2026-11-04-optimisation-python-architecture.md § 16.2) : un seul algorithme de correction actif par
-- campagne, défaut « uniformiser au global », changeable EN COURS de campagne (décision du propriétaire du 05/11), effet
-- au cycle suivant. Chaque changement est tracé : qui, quand, algorithme et paramètres avant, après.
--
-- CE QUE POSE CETTE MIGRATION.
--   1. `optimisation_reglages.algo_parametres` (jsonb, défaut `{}`) : les SURCHARGES des paramètres de l'algorithme
--      choisi (`{"alpha": 0.4}`), jamais les valeurs effectives — un paramètre absent prend le défaut du catalogue
--      (`services/optimisation/src/optimisation/algos/registre.py`). Séparé de `parametres` (sql/345), dont les clés
--      sont fermées et ne dépendent pas de l'algorithme. Le CHECK ne vérifie que la FORME (objet de nombres) : les
--      noms et les bornes dépendent de l'algorithme et vivent dans le catalogue Python, seul écrivain (plan § 16.1 :
--      aucun algorithme hors du service, ni en SQL).
--      `algo_id` (posée par sql/345, défaut `uniformiser_global`) n'est PAS contrainte ici, pour la même raison.
--   2. `optimisation_reglages_journal` : une ligne par changement, jamais modifiée ni supprimée (le service a
--      SELECT et INSERT seulement). `workspace_id` = espace propriétaire de la campagne à l'écriture (plan § 9.1).
--   3. RLS ACTIVE AVEC POLICY ÉCRITE sur le journal, la même que `optimisation_reglages_select` (plan § 9.3) ; aucune
--      écriture pour `anon` / `authenticated`. Testé par `tests/integration/optimisation-rls.test.ts`.
--
-- Idempotente : `if not exists`, `create or replace`, policy créée sous garde (sinon `alter policy`), contrainte
-- ajoutée sous garde ; AUCUN DROP. Appliquer par `psql -1 -v ON_ERROR_STOP=1`.

-- 1. Forme des surcharges : un objet dont chaque valeur est un nombre.
create or replace function public.optimisation_algo_parametres_valides(p jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(jsonb_typeof(p) = 'object', false)
     and case when jsonb_typeof(p) = 'object'
              then not exists (select 1 from jsonb_each(p) e(cle, valeur)
                                where jsonb_typeof(e.valeur) <> 'number' or length(e.cle) not between 1 and 64)
              else false end
$$;

revoke all on function public.optimisation_algo_parametres_valides(jsonb) from public, anon, authenticated;
grant execute on function public.optimisation_algo_parametres_valides(jsonb) to service_role, optimisation_service;

alter table public.optimisation_reglages
  add column if not exists algo_parametres jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.optimisation_reglages'::regclass
                  and conname = 'optimisation_reglages_algo_parametres_valides') then
    alter table public.optimisation_reglages
      add constraint optimisation_reglages_algo_parametres_valides
      check (public.optimisation_algo_parametres_valides(algo_parametres));
  end if;
end $$;

comment on column public.optimisation_reglages.algo_parametres is
  'Surcharges des paramètres de l''algorithme algo_id (sql/347) ; un paramètre absent = défaut du catalogue Python.';

-- 2. Le journal.
create table if not exists public.optimisation_reglages_journal (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.organizations(id),
  campagne_id        uuid not null references public.dsp_campaigns(id) on delete cascade,
  modifie_par        uuid references auth.users(id) on delete set null,
  role_auteur        text,
  modifie_le         timestamptz not null default now(),
  algo_avant         text not null,
  parametres_avant   jsonb not null
                     constraint optimisation_reglages_journal_parametres_avant_valides
                     check (public.optimisation_algo_parametres_valides(parametres_avant)),
  algo_apres         text not null,
  algo_version_apres integer not null check (algo_version_apres >= 1),
  parametres_apres   jsonb not null
                     constraint optimisation_reglages_journal_parametres_apres_valides
                     check (public.optimisation_algo_parametres_valides(parametres_apres))
);

-- Lecture du journal d'une campagne, du plus récent au plus ancien, bornée (`limit`) : un parcours d'index.
create index if not exists optimisation_reglages_journal_campagne
  on public.optimisation_reglages_journal (campagne_id, modifie_le desc, id desc);
create index if not exists optimisation_reglages_journal_workspace
  on public.optimisation_reglages_journal (workspace_id);

comment on table public.optimisation_reglages_journal is
  'Journal des changements d''algorithme de correction par campagne (sql/347, tâche 2.7) : qui, quand, avant, après. '
  'Écrit par le service Python seul (INSERT), jamais modifié ni supprimé.';

-- 3. RLS avec policy écrite (plan § 9.3), la même que sql/345.
alter table public.optimisation_reglages_journal enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'public.optimisation_reglages_journal'::regclass
                  and polname = 'optimisation_reglages_journal_select') then
    create policy optimisation_reglages_journal_select on public.optimisation_reglages_journal
      for select to authenticated
      using (
        public.get_user_role() = 'super_admin'
        or workspace_id = public.get_user_org()
        or public.campagne_partagee_avec_mon_espace(campagne_id)
      );
  else
    alter policy optimisation_reglages_journal_select on public.optimisation_reglages_journal
      to authenticated
      using (
        public.get_user_role() = 'super_admin'
        or workspace_id = public.get_user_org()
        or public.campagne_partagee_avec_mon_espace(campagne_id)
      );
  end if;
end $$;

revoke all on table public.optimisation_reglages_journal from anon;
revoke insert, update, delete, truncate, references, trigger on table public.optimisation_reglages_journal
  from authenticated;
grant select on table public.optimisation_reglages_journal to authenticated;

-- Le service : lire et ajouter. Ni UPDATE ni DELETE — un journal ne se réécrit pas.
grant select, insert on table public.optimisation_reglages_journal to optimisation_service;
revoke update, delete, truncate on table public.optimisation_reglages_journal from optimisation_service;

notify pgrst, 'reload schema';
