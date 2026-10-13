-- 251 — Sélection recommandée de données par espace (2026-10-13)
--
-- Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md § 7.2 (V6).
-- À l'étape ② de la carte, « Données communes » s'ouvre sur la sélection recommandée de l'espace ; le reste se range
-- dans « Autres données communes ». Une recommandation RANGE : elle ne donne ni ne retire aucun droit (les droits
-- restent ceux de data_sources / getOrgSourceIds), et ne précharge aucun calque.
--
-- cle_jeu : la clé d'un jeu de la carte, `famille:nom` — registre lib/carte/jeux-carte.ts (référentiels, ex.
-- `iris:socio-demo`) ou `poi:<categorie>`. Le CHECK est la MÊME expression que RE_CLE_JEU de ce registre.
--
-- Écriture : UNIQUEMENT par remplacer_jeux_recommandes (une transaction : la liste entière remplace l'ancienne ; une
-- clé refusée laisse l'ancienne intacte). Taille : ≤ 200 lignes par espace (garde de la fonction) — sous le plafond
-- PostgREST de 1 000, la lecture de table par espace est bornée par construction.
--
-- Coût : lecture par la clé primaire (organization_id en tête) ; quelques dizaines de lignes au plus.
-- Droits : service_role seul (les routes passent par createAdminClient). Rejouable.

begin;

create table if not exists public.espace_jeux_recommandes (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cle_jeu         text not null check (cle_jeu ~ '^[a-z]+:[a-z0-9_-]{1,64}$'),
  cree_le         timestamptz not null default now(),
  primary key (organization_id, cle_jeu)
);

comment on table public.espace_jeux_recommandes is
  'Selection recommandee de jeux de la carte par espace (etape 2, bloc Donnees communes). Range, ne donne aucun droit. Ecrite par remplacer_jeux_recommandes (sql/251).';

alter table public.espace_jeux_recommandes enable row level security;
revoke all on table public.espace_jeux_recommandes from public, anon, authenticated;
grant select, insert, delete on table public.espace_jeux_recommandes to service_role;

create or replace function public.remplacer_jeux_recommandes(p_organization_id uuid, p_cles text[])
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if cardinality(coalesce(p_cles, '{}'::text[])) > 200 then
    raise exception 'au plus 200 jeux recommandes par espace' using errcode = '22023';
  end if;
  delete from public.espace_jeux_recommandes where organization_id = p_organization_id;
  insert into public.espace_jeux_recommandes (organization_id, cle_jeu)
    select distinct p_organization_id, c
    from unnest(coalesce(p_cles, '{}'::text[])) as c
    where c is not null;
  return jsonb_build_object(
    'cles',
    coalesce(
      (select jsonb_agg(r.cle_jeu order by r.cle_jeu)
       from public.espace_jeux_recommandes r
       where r.organization_id = p_organization_id),
      '[]'::jsonb
    )
  );
end;
$function$;

comment on function public.remplacer_jeux_recommandes(uuid, text[]) is
  'Remplace la selection recommandee d un espace en une transaction ; rend {cles} trie. RETURNS jsonb (sql/251).';

revoke all on function public.remplacer_jeux_recommandes(uuid, text[]) from public, anon, authenticated;
grant execute on function public.remplacer_jeux_recommandes(uuid, text[]) to service_role;

commit;
