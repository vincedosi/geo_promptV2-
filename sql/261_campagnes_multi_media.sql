-- 261 — Campagnes multi-média d'un espace de travail (2026-10-16)
--
-- Spec : docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md § 1 (décisions 2, 3, 5), § 4.2.
-- Une CAMPAGNE appartient à un espace (`organization_id`) et porte des LIGNES, chacune d'un média parmi digital, ooh,
-- tv, radio, presse. Une ligne OOH réserve des panneaux (`campagne_ligne_panneaux`). Modèle 1 : de nouvelles tables
-- AU-DESSUS ; `dsp_campaigns` et tout le pilotage digital restent intacts. Le mot « campagne » est déjà pris
-- (`dsp_campaigns`, `CampagnePlan`, étape campagne du module risque) : voir ARCHITECTURE « Campagnes multi-média ».
--
-- `cle_import` : identité stable d'une campagne pour le rejeu du script d'import (`scripts/ooh/importer-plan.ts`) ;
-- unique dans un espace (NULLS DISTINCT : une campagne saisie sans clé n'est pas contrainte).
-- `on delete restrict` côté panneau : un panneau réservé par une campagne ne disparaît pas en silence lors d'un
-- remplacement d'import ; la suppression échoue (23503) en le disant.
-- `unique (campagne_id, ordre)` : l'ordre du plan est une identité de ligne (son index sert aussi `campagne_id`).
--
-- RLS : lecture par `authenticated` pour son espace (`get_user_org()`), ou super_admin — même règle que `ds_select`
-- (sql/234). Aucune écriture client : les écritures passent par `service_role` (script, routes). Les politiques
-- sont créées dans un bloc DO gardé par `pg_policies` (aucun DROP).
-- Coût : tables de quelques dizaines de campagnes et de lignes ; liens ≈ 1 200 par campagne OOH (TF4).
-- Droits : `select` à `authenticated` (sous RLS), tout à `service_role`. Rejouable.

begin;

create table if not exists public.campagnes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  nom              text not null,
  annonceur        text,
  vague            text,
  date_debut       date,
  date_fin         date,
  budget_total_ttc numeric,
  cle_import       text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint campagnes_org_cle_import_key unique (organization_id, cle_import),
  constraint campagnes_dates_check check (date_debut is null or date_fin is null or date_fin >= date_debut)
);

create table if not exists public.campagne_lignes (
  id               uuid primary key default gen_random_uuid(),
  campagne_id      uuid not null references public.campagnes(id) on delete cascade,
  media            text not null check (media in ('digital', 'ooh', 'tv', 'radio', 'presse')),
  ordre            integer not null,
  regie            text,
  reseau           text,
  territoire       text,
  nb_ecrans        integer,
  format           text,
  nb_diffusions    integer,
  date_debut       date,
  date_fin         date,
  duree_libelle    text,
  rang_option      text,
  plage_horaire    text,
  montant_brut     numeric,
  montant_net      numeric,
  frais            numeric,
  honoraires       numeric,
  total_ttc        numeric,
  contacts_15_plus bigint,
  contacts_18_24   bigint,
  details          jsonb not null default '{}'::jsonb,
  data_source_id   uuid references public.data_sources(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint campagne_lignes_ordre_key unique (campagne_id, ordre),
  constraint campagne_lignes_dates_check check (date_debut is null or date_fin is null or date_fin >= date_debut)
);

create table if not exists public.campagne_ligne_panneaux (
  ligne_id   uuid not null references public.campagne_lignes(id) on delete cascade,
  panneau_id uuid not null references public.panneaux_affichage(id) on delete restrict,
  nb_ecrans  integer,
  formats    text[],
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (ligne_id, panneau_id)
);

create index if not exists campagnes_organization_id_idx on public.campagnes (organization_id);
create index if not exists campagne_lignes_campagne_id_idx on public.campagne_lignes (campagne_id);
create index if not exists campagne_ligne_panneaux_panneau_id_idx on public.campagne_ligne_panneaux (panneau_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_campagnes_updated_at' and tgrelid = 'public.campagnes'::regclass) then
    create trigger trg_campagnes_updated_at before update on public.campagnes
      for each row execute function public.set_updated_at();
  end if;
end
$$;

comment on table public.campagnes is
  'Campagne multi-media d un espace de travail (spec 2026-10-16-ooh-campagnes). Distincte de dsp_campaigns. Ecrite par scripts/ooh/importer-plan.ts (sql/261).';
comment on table public.campagne_lignes is
  'Ligne d une campagne, un media parmi digital/ooh/tv/radio/presse ; details = la ligne d origine du plan (sql/261).';
comment on table public.campagne_ligne_panneaux is
  'Panneaux reserves par une ligne OOH ; ON DELETE RESTRICT cote panneau (sql/261).';

alter table public.campagnes enable row level security;
alter table public.campagne_lignes enable row level security;
alter table public.campagne_ligne_panneaux enable row level security;

revoke all on table public.campagnes, public.campagne_lignes, public.campagne_ligne_panneaux from public, anon, authenticated;
grant select on table public.campagnes, public.campagne_lignes, public.campagne_ligne_panneaux to authenticated;
grant select, insert, update, delete on table public.campagnes, public.campagne_lignes, public.campagne_ligne_panneaux to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'campagnes' and policyname = 'campagnes_select') then
    create policy campagnes_select on public.campagnes for select to authenticated
      using (get_user_role() = 'super_admin' or organization_id = get_user_org());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'campagne_lignes' and policyname = 'campagne_lignes_select') then
    create policy campagne_lignes_select on public.campagne_lignes for select to authenticated
      using (exists (
        select 1 from public.campagnes c
         where c.id = campagne_lignes.campagne_id
           and (get_user_role() = 'super_admin' or c.organization_id = get_user_org())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'campagne_ligne_panneaux' and policyname = 'campagne_ligne_panneaux_select') then
    create policy campagne_ligne_panneaux_select on public.campagne_ligne_panneaux for select to authenticated
      using (exists (
        select 1 from public.campagne_lignes l
          join public.campagnes c on c.id = l.campagne_id
         where l.id = campagne_ligne_panneaux.ligne_id
           and (get_user_role() = 'super_admin' or c.organization_id = get_user_org())));
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
