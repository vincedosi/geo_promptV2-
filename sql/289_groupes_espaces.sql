-- 289 — Groupes d'espaces (2026-10-28, lot « Catalogue et groupes », T3)
--
-- Plan : docs/superpowers/plans/2026-10-28-carte-en-parcours-catalogue-groupes.md (A-9, Q-5 tranchée par Vincent le
-- 28/10 : un nom saisi dans les Réglages de l'espace, avec suggestions, sans écran de gestion des groupes).
-- Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md § 7.3, V9.
--
-- POURQUOI une colonne texte et pas une table groupes_espaces : un groupe RANGE la colonne d'Accès en dossiers, et
-- RIEN d'autre — aucun droit, aucune donnée, aucune recommandation ne s'y attache (V9). Un nom suffit ; renommer un
-- groupe = le changer dans chacun de ses espaces (5 espaces au 28/10). Le jour où un groupe doit porter autre chose
-- qu'un nom, une table le remplacera.
--
-- Lu par l'administration seule (GET /api/admin/espaces, PATCH /api/admin/organizations/[id]) :
-- tests/unit/espaces/groupe-ne-porte-rien.test.ts échoue si la carte ou une route hors /api/admin le lit.
--
-- Le CHECK est la borne de la route (Zod : chaîne rognée, 1 à 60 caractères, ou NULL) refaite en base. Rejouable :
-- colonne IF NOT EXISTS, contrainte posée seulement si absente. Aucune donnée écrite.

begin;

alter table public.organizations add column if not exists groupe_espace text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_groupe_espace_check' and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_groupe_espace_check
      check (char_length(btrim(groupe_espace)) between 1 and 60);
  end if;
end
$$;

comment on column public.organizations.groupe_espace is
  'Groupe d espaces (nom libre, 1 a 60 caracteres, NULL = sans groupe). Range la colonne d Acces en dossiers ; ne porte AUCUN droit. Lu par l administration seule (sql/289).';

commit;
