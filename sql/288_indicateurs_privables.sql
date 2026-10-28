-- 288 — Un indicateur peut devenir un jeu de données (2026-10-28, lot « Catalogue et groupes », T1)
--
-- Plan : docs/superpowers/plans/2026-10-28-carte-en-parcours-catalogue-groupes.md (A-1 à A-4).
-- Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md § 7.1, V7.
--
-- POURQUOI une ligne data_sources et pas une table « catalogue » : un indicateur privable doit suivre EXACTEMENT les
-- règles des jeux importés (socle, privé à un espace, partagé — getOrgSourceIds / source_visible, sql/234) et les
-- MÊMES gestes d'Accès (Transférer, Retirer du socle, Partager). En faire une ligne data_sources de type 'indicateur'
-- et y faire pointer cible_indicator_registry.data_source_id les lui donne sans une ligne de règle nouvelle.
--
-- A-1 : seul abstention_pres_2022 reçoit une source. Les indicateurs iris_column restent sans source — leur colonne
-- est lisible par les tuiles IRIS, les dire « privés » serait une fausse promesse ; pollen et atmo sont des données
-- publiques servies en direct. Un registre SANS source = référentiel du socle (filtrerParSourcesVisibles,
-- referentiels: true). tests/integration/indicateurs-privables.test.ts échoue si un iris_column reçoit une source.
--
-- A-3 : ON DELETE RESTRICT. Supprimer la source ne doit JAMAIS rendre l'indicateur au socle en silence (un SET NULL
-- le rendrait public). DELETE /api/admin/sources/[id] répond 409 avant toute écriture ; la FK est le second verrou.
--
-- Aucune donnée de démo : la seule ligne écrite est l'entrée de catalogue d'un jeu réel, au socle (A-2). Le passage
-- à un espace se fait par l'écran d'Accès.
--
-- Coût : data_sources ≈ 10 lignes, registre 19 lignes ; index partiel sur la seule ligne qui porte une source.
-- Rejouable : contrainte remplacée dans la même instruction, colonne et index IF NOT EXISTS, insertion WHERE NOT
-- EXISTS, mise à jour idempotente.

begin;

-- La seule exception aux migrations additives (plan, Global Constraints) : un CHECK ne s'étend pas autrement.
-- DROP + ADD dans la même instruction : aucune fenêtre sans contrainte, données intactes.
alter table public.data_sources
  drop constraint if exists data_sources_type_check,
  add constraint data_sources_type_check
    check (type = any (array['panneaux'::text, 'poi'::text, 'carreaux'::text, 'indicateur'::text]));

alter table public.cible_indicator_registry
  add column if not exists data_source_id uuid references public.data_sources(id) on delete restrict;

create index if not exists idx_cible_indicator_registry_data_source
  on public.cible_indicator_registry (data_source_id)
  where data_source_id is not null;

comment on column public.cible_indicator_registry.data_source_id is
  'Source data_sources (type indicateur) qui rend cet indicateur privable a un espace. NULL = referentiel du socle, visible de tous. ON DELETE RESTRICT : supprimer la source ne rend jamais l indicateur public (sql/288).';

-- A-2 : propriétaire = défaut de la colonne (GENESIS (Global)) ; valid_count = codes postaux de
-- dataset_abstention_2022, mesuré (6 186) et relu ici plutôt qu'écrit en dur ; origine = en-tête de
-- scripts/import_abstention_2022.ts.
insert into public.data_sources (name, type, category, visibilite, status, row_count, valid_count, metadata)
select 'Taux d''abstention (présidentielle 2022)', 'indicateur', 'abstention_pres_2022', 'socle', 'active',
       n, n, jsonb_build_object('origine', 'Ministère de l''Intérieur (data.gouv.fr)')
from (select count(*)::int as n from public.dataset_abstention_2022) as effectif
where not exists (
  select 1 from public.data_sources where type = 'indicateur' and category = 'abstention_pres_2022'
);

update public.cible_indicator_registry r
set data_source_id = s.id
from public.data_sources s
where r.indicator_code = 'abstention_pres_2022'
  and s.type = 'indicateur' and s.category = 'abstention_pres_2022'
  and r.data_source_id is distinct from s.id;

commit;
