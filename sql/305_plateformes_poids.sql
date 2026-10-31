-- sql/305 — A1 (plan de corrections du découpage des zones, 2026-10-31, lot 1) : le registre des MÉCANISMES DE POIDS
-- (amendement E2), `plateformes_poids`.
--
-- POURQUOI UNE TABLE À PART DE `plateformes_geo`.
--   `plateformes_geo` est indexée (plateforme, maille). Or les poids d'un plan transitent par des MÉCANISMES distincts,
--   et une même (plateforme, maille) peut en avoir plusieurs : DV360 au CP a un multiplicateur géographique (plage
--   0,1 à 10, non confirmée) ET un script de custom bidding (scores par paliers, au plus 2 000 CP par envoi). Une plage
--   posée sur la ligne (DV360, CP) — c'était la première version de A1, sql/302 sur la branche `wip/A1-plan-cp`, jamais
--   appliquée ici — ne sait pas dire à quel mécanisme elle appartient. D'où une ligne par (plateforme, maille,
--   mécanisme). A1 (le plan CP), le noyau d'optimisation (Q33) et la quantification en paliers (Q36) lisent CETTE table.
--   Multiplicateur et paliers sont deux SORTIES du même plan, pas deux plans.
--
-- CE QUE PORTE UNE LIGNE.
--   mecanisme      multiplicateur | script | budget_ligne | aucun
--   valeur_min/max la plage admise d'un poids envoyé (les deux ou aucune) ; le plan est écrêté à cette plage
--                  (séquence E4 : normaliser, PUIS écrêter, sans renormaliser)
--   pas            le pas d'un poids envoyé, s'il est connu
--   nb_max_entrees le nombre maximal d'ENTRÉES par envoi, compté en CODES envoyés (membres des groupes développés),
--                  pas en groupes : 981 codes pour 895 groupes sur la zone composite (relecture de A2, M-2)
--   nb_paliers_max le nombre maximal de paliers d'un script (lu par la quantification, Q36)
--   poids_groupe_cp ce que reçoit chaque membre d'un groupe de CP indiscernables — `meme` ou `divise` (ligne CP
--                  seulement). REMPLACE `plateformes_geo.poids_groupe_cp` (sql/304), que personne ne lisait et qui ne
--                  pouvait pas varier par mécanisme ; la colonne de `plateformes_geo` reste en place (pas de DROP),
--                  commentée « remplacée ».
--   branche        le produit transmet-il ces poids à la plateforme par API ? Au 31/10 : non, nulle part (la poussée
--                  DV360 ne pose que le ciblage, `lib/dsp/dv360/pousser-ciblage.ts`)
--   parametres_a_verifier  la liste des PARAMÈTRES non confirmés (amendement E9), affichée à côté de chaque valeur
--
-- SEED (relevé du 31/10, CP seulement : c'est la seule maille qui porte un plan).
--   dv360 multiplicateur 0,1 à 10, « à vérifier » sur valeur_min et valeur_max (Q1 : tant que dentsu ne l'a pas
--     confirmée dans un compte) ;
--   dv360 script, 2 000 entrées par envoi (le garde-fou existant `MAX_GEO_IDS_PER_PUSH`, rebid-v2 INV10), à vérifier ;
--   ttd budget_ligne, mécanisme lui-même « à vérifier » (« TTD ? » du brief : des bid lists géo en feraient un
--     multiplicateur) ;
--   meta, tiktok : aucun (paliers non gérés).
--   `poids_groupe_cp` = `meme` partout (valeur de sql/304), « à vérifier » partout.
--   `on conflict do nothing` : une ligne corrigée par `update` n'est pas remise au seed par un rejeu.
--
-- Rejouable : `create table if not exists`, contraintes gardées par `do`, `create or replace`, aucun DROP.
-- Droits : service_role seul, RLS activée sans policy (patron sql/274). Pas de begin/commit : appliquer par `psql -1`.

create or replace function public.plateformes_poids_parametres_valides(p text[])
returns boolean
language sql immutable set search_path to 'public' as $fn$
  select p is not null
     and p <@ array['mecanisme', 'valeur_min', 'valeur_max', 'pas', 'nb_max_entrees', 'nb_paliers_max',
                    'poids_groupe_cp', 'branche']::text[]
     and cardinality(p) = (select count(distinct x) from unnest(p) x)
$fn$;
revoke all on function public.plateformes_poids_parametres_valides(text[]) from public, anon, authenticated;
grant execute on function public.plateformes_poids_parametres_valides(text[]) to service_role;

create table if not exists public.plateformes_poids (
  plateforme            text    not null,
  maille                text    not null,
  mecanisme             text    not null check (mecanisme in ('multiplicateur', 'script', 'budget_ligne', 'aucun')),
  valeur_min            numeric,
  valeur_max            numeric,
  pas                   numeric,
  nb_max_entrees        integer,
  nb_paliers_max        integer,
  poids_groupe_cp       text,
  branche               boolean not null default false,
  parametres_a_verifier text[]  not null default '{}',
  note                  text,
  releve_le             date    not null,
  primary key (plateforme, maille, mecanisme),
  foreign key (plateforme, maille) references public.plateformes_geo (plateforme, maille) on delete cascade
);

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_poids'::regclass and conname = 'plateformes_poids_plage_valide') then
    alter table public.plateformes_poids add constraint plateformes_poids_plage_valide check (
      (valeur_min is null and valeur_max is null)
      or (valeur_min is not null and valeur_max is not null and valeur_min > 0 and valeur_min <= valeur_max
          and valeur_max <= 999.999));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_poids'::regclass and conname = 'plateformes_poids_nombres_valides') then
    alter table public.plateformes_poids add constraint plateformes_poids_nombres_valides check (
      (pas is null or pas > 0) and (nb_max_entrees is null or nb_max_entrees > 0)
      and (nb_paliers_max is null or nb_paliers_max > 0));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_poids'::regclass and conname = 'plateformes_poids_aucun_sans_valeur') then
    -- « aucun » : aucun poids ne part, donc ni plage, ni pas, ni paliers.
    alter table public.plateformes_poids add constraint plateformes_poids_aucun_sans_valeur check (
      mecanisme <> 'aucun' or (valeur_min is null and pas is null and nb_paliers_max is null));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_poids'::regclass and conname = 'plateformes_poids_groupe_cp_valide') then
    alter table public.plateformes_poids add constraint plateformes_poids_groupe_cp_valide check (
      (maille = 'cp' and poids_groupe_cp in ('meme', 'divise')) or (maille <> 'cp' and poids_groupe_cp is null));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_poids'::regclass and conname = 'plateformes_poids_parametres_a_verifier_valides') then
    alter table public.plateformes_poids add constraint plateformes_poids_parametres_a_verifier_valides
      check (public.plateformes_poids_parametres_valides(parametres_a_verifier));
  end if;
end
$do$;

comment on table public.plateformes_poids is
  'Mecanismes de poids des plateformes, une ligne par (plateforme, maille, mecanisme) : plage d''un poids envoye, pas, '
  'entrees par envoi (en CODES envoyes), paliers, regle d''un groupe de CP, branchement, parametres a verifier. '
  'Lue par le plan CP (A1), le noyau (Q33) et la quantification (Q36). Editee par SQL (update). sql/305 (A1, E2).';
comment on column public.plateformes_poids.nb_max_entrees is
  'Entrees maximales par envoi, comptees en CODES envoyes (membres des groupes de CP developpes), pas en groupes. '
  'Au-dela : plan decoupe en plusieurs envois, annonce. sql/305 (A1).';
comment on column public.plateformes_poids.poids_groupe_cp is
  'Ligne CP : ce que recoit chaque membre d''un groupe de CP indiscernables — meme (poids de l''unite, repete) ou '
  'divise (divise par le nombre de membres). Remplace plateformes_geo.poids_groupe_cp (sql/304). sql/305 (A1).';
comment on column public.plateformes_poids.parametres_a_verifier is
  'Les parametres non confirmes de la ligne (amendement E9), affiches a cote de chaque valeur. sql/305 (A1).';

-- La colonne de sql/304 reste (pas de DROP), mais n'est plus la règle.
comment on column public.plateformes_geo.poids_groupe_cp is
  'REMPLACEE par plateformes_poids.poids_groupe_cp (sql/305, A1) : la regle d''un groupe de CP depend du mecanisme de '
  'poids, pas de la seule (plateforme, maille). Gardee sans lecteur (pas de DROP sur la base partagee). sql/304 (A2).';

alter table public.plateformes_poids enable row level security;
revoke all on table public.plateformes_poids from public, anon, authenticated;
grant select, insert, update, delete on table public.plateformes_poids to service_role;

insert into public.plateformes_poids
  (plateforme, maille, mecanisme, valeur_min, valeur_max, pas, nb_max_entrees, nb_paliers_max, poids_groupe_cp,
   branche, parametres_a_verifier, note, releve_le)
values
  ('dv360', 'cp', 'multiplicateur', 0.1, 10, null, null, null, 'meme', false,
   '{valeur_min,valeur_max,poids_groupe_cp}',
   'Multiplicateur geographique. Plage 0,1 a 10 non confirmee dans un compte dentsu (Q1).', '2026-10-31'),
  ('dv360', 'cp', 'script', null, null, null, 2000, null, 'meme', false,
   '{nb_max_entrees,poids_groupe_cp}',
   'Script de custom bidding, scores par paliers. 2 000 = garde-fou existant (MAX_GEO_IDS_PER_PUSH, rebid-v2 INV10).',
   '2026-10-31'),
  ('ttd', 'cp', 'budget_ligne', null, null, null, null, null, 'meme', false,
   '{mecanisme,poids_groupe_cp}',
   'Repartition de budget par ligne supposee (« TTD ? ») ; des bid lists geo en feraient un multiplicateur.',
   '2026-10-31'),
  ('meta', 'cp', 'aucun', null, null, null, null, null, 'meme', false,
   '{mecanisme,poids_groupe_cp}', 'Paliers non geres : la liste part sans poids.', '2026-10-31'),
  ('tiktok', 'cp', 'aucun', null, null, null, null, null, 'meme', false,
   '{mecanisme,poids_groupe_cp}', 'Paliers non geres : la liste part sans poids.', '2026-10-31')
on conflict (plateforme, maille, mecanisme) do nothing;

notify pgrst, 'reload schema';
