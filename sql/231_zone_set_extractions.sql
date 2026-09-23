-- sql/231 — Les EXTRACTIONS d'un jeu de zones (Phase 4 du chantier zones -> CP).
--
-- ── POURQUOI UNE TABLE, ALORS QUE L'EXPORT EXCEL EXISTE DÉJÀ ────────────────
--
-- `/api/zones/jeux/[id]/export` fabrique un classeur À LA VOLÉE : il relit
-- `zone_set_cp` et rappelle `genererPlanCp` à chaque téléchargement. C'est le
-- bon geste pour REGARDER un plan — le fichier reflète toujours l'état courant.
--
-- C'est exactement le mauvais geste pour SE SOUVENIR de ce qui est parti au
-- custom bidding. Un seuil de couverture qu'on déplace, un poids de classe
-- qu'on retouche, et le même bouton rend un autre fichier sous le même nom,
-- sans que rien ne le dise. Or au moment de comprendre pourquoi une campagne
-- a sur-diffusé, la seule question qui compte est « qu'est-ce qu'on a envoyé,
-- exactement ? » — et la réponse ne doit pas dépendre de ce qu'on a réglé
-- depuis.
--
-- Une extraction est donc un CONSTAT FIGÉ : les multiplicateurs tels qu'ils
-- étaient, avec le seuil et le mode qui les ont produits.
--
-- ── IMMUABLE VEUT DIRE : PAS D'UPDATE, JAMAIS ──────────────────────────────
--
-- Un recalage ne corrige pas l'extraction précédente, il en crée une NOUVELLE
-- version. C'est ce qui permet à la Phase 5 de montrer « avant / après » : si
-- v1 pouvait être réécrite, la courbe d'alignement annotée « recalage v2 »
-- comparerait v2 à elle-même.
--
-- Le trigger porte sur UPDATE et sur lui seul. DELETE reste permis, sans quoi
-- supprimer un jeu de zones deviendrait impossible — la cascade s'y casserait
-- les dents, et on aurait échangé une garantie utile contre une table qu'on ne
-- peut plus nettoyer. Immuable n'est pas indestructible.
--
-- ── POURQUOI UNE TABLE FILLE, ET NON UN jsonb « poids par CP » ─────────────
--
-- Le brief dit « poids par CP » au singulier, ce qui se lit comme une colonne.
-- Un jeu national en porte près de 2 000 : en jsonb, la Phase 5 devrait relire
-- et désérialiser l'objet entier pour chaque requête de simulation, et aucune
-- jointure ne serait possible — or simuler une diffusion, c'est précisément
-- joindre ces poids aux codes postaux jour après jour. La table fille est le
-- même contenu, sous la forme que le travail suivant réclame.
--
-- ── LA VERSION EST ATTRIBUÉE EN BASE, SOUS VERROU ──────────────────────────
--
-- `pg_advisory_xact_lock`, comme `publier_strategie` (sql/157, corrigée
-- sql/159). La leçon de cette migration-là s'applique mot pour mot : un
-- `INSERT … SELECT max+1` SANS verrou est aussi exposé à la course qu'un
-- `SELECT max` suivi d'un `INSERT`. Deux clics rapprochés sur « Extraire »
-- réserveraient le même numéro.
--
-- ── IDEMPOTENTE À CONTENU IDENTIQUE ────────────────────────────────────────
--
-- L'empreinte couvre ce qui DÉFINIT l'extraction — le seuil, le mode, et les
-- multiplicateurs eux-mêmes. Ré-extraire sans avoir rien changé rend la
-- version existante et `deja_extraite: true`, plutôt que d'empiler des v2, v3,
-- v4 rigoureusement identiques que personne ne saura départager six mois plus
-- tard. Un recalage change les poids, donc l'empreinte, donc crée bien une
-- version.
--
-- ⚠ L'empreinte NE porte PAS le commentaire : deux extractions au même contenu
-- ne se distinguent pas parce qu'on les a annotées différemment.

create table if not exists public.zone_set_extractions (
  id            uuid primary key default gen_random_uuid(),
  zone_set_id   uuid not null references public.zone_sets(id) on delete cascade,
  -- 1, 2, 3… L'interface écrit « v1 » ; le stockage reste un entier, qui se
  -- trie et s'incrémente. Un texte « v10 » se classerait avant « v2 ».
  version       int  not null,
  -- `initiale` : la première extraction d'un jeu, ou toute extraction faite
  -- hors d'un recalage. `recalage` : celle qui corrige une diffusion déjà
  -- mesurée. La Phase 5 s'en sert pour annoter la courbe d'alignement.
  origine       text not null default 'initiale'
                check (origine in ('initiale', 'recalage')),
  commentaire   text not null default '',

  -- Les réglages qui ont produit ces poids. Recopiés et non référencés : le
  -- jeu peut être re-réglé, l'extraction doit rester lisible telle quelle.
  seuil_couverture_cp numeric not null,
  mode_plan     text not null,

  -- Les trois chiffres qui doivent voyager avec un plan (cf. `genererPlanCp`).
  -- `taux_utile` est nullable : aucun code postal retenu n'est pas zéro pour
  -- cent, c'est l'absence de ratio.
  n_cp          int not null,
  n_retenus     int not null,
  taux_utile    numeric,
  part_plan_en_zone numeric,
  population_exposee numeric not null default 0,

  -- md5 du contenu — voir l'en-tête.
  empreinte     text not null,

  created_at    timestamptz not null default now(),
  created_by    uuid,

  constraint zse_version_unique unique (zone_set_id, version),
  constraint zse_empreinte_unique unique (zone_set_id, empreinte)
);

comment on table public.zone_set_extractions is
  'Extraction figée d''un jeu de zones pour le custom bidding. IMMUABLE : un '
  'recalage crée une version, il n''écrase jamais. L''export Excel recalcule à '
  'la volée et ne peut donc pas dire ce qui est réellement parti au DSP.';

comment on column public.zone_set_extractions.empreinte is
  'md5 du seuil, du mode et des multiplicateurs. Ré-extraire à contenu '
  'identique rend la version existante au lieu d''en empiler une jumelle.';

create index if not exists idx_zse_jeu
  on public.zone_set_extractions (zone_set_id, version desc);

alter table public.zone_set_extractions enable row level security;
revoke all on table public.zone_set_extractions from public, anon, authenticated;
grant select, insert, delete on table public.zone_set_extractions to service_role;

-- ── Les lignes figées ──────────────────────────────────────────────────────

create table if not exists public.zone_set_extraction_cp (
  extraction_id uuid not null
                references public.zone_set_extractions(id) on delete cascade,
  code_postal   text not null,
  -- Le code postal sous lequel la population du groupe est comptée. Égal à
  -- `code_postal` pour l'immense majorité ; différent pour les 181 codes que
  -- `ref_codes_postaux` ne distingue pas (sql/228).
  code_canonique text not null,
  classe        text not null,
  -- La GRAPPE dominante de ce code postal : celle qui y porte le plus de
  -- population exposée. Figée ici plutôt que jointe à l'export, pour que
  -- l'extraction soit auto-portante — et parce que la Phase 5 note le score
  -- par zone, qui ne doit pas changer si les grappes sont reconstruites.
  -- ⚠ `cluster_rang` et non l'`id` seul : un rang se lit (« zone 3 »), un uuid
  -- devient illisible dès qu'on le sort de la base.
  cluster_id    uuid,
  cluster_rang  int,
  zone_nom      text,
  -- ⚠ NULLABLES, et c'est le point délicat. Un membre non canonique — Nantes
  -- 44200 quand 44000 porte le groupe — n'a PAS de population propre :
  -- l'information n'est pas dans la donnée, les quatre codes partagent une
  -- géométrie identique. Lui attribuer un quart du groupe inventerait une
  -- répartition que personne n'a mesurée ; lui attribuer 0 ferait lire « ce
  -- code postal n'expose personne », ce qui est faux. La population du groupe
  -- est portée EN ENTIER par la ligne canonique, et sommer la colonne reste
  -- donc juste.
  pop_en_zone   numeric,
  pop_totale    numeric,
  -- La part du code postal qui tombe en zone, en pourcentage. Le brief
  -- l'appelle « taux d'exposition » ; le reste du module dit `part_en_zone`,
  -- et c'est ce nom-là qui est gardé — une grandeur ne change pas de nom
  -- entre deux écrans.
  part_en_zone  numeric,
  retenu        boolean not null default false,
  -- Ce qui part réellement au DSP. `numeric(6,3)`, le type de
  -- `bidding_zone_configs.bid_multiplier` : figer ici dans un type plus large
  -- laisserait passer une valeur que la table de destination refuserait.
  multiplicateur numeric(6,3) not null default 0,

  primary key (extraction_id, code_postal)
);

comment on table public.zone_set_extraction_cp is
  'Un multiplicateur par code postal, figé. ⚠ UNE LIGNE PAR CODE POSTAL et non '
  'par (code postal x grappe) comme `zone_set_cp` : le DSP ne sait porter qu''un '
  'multiplicateur par code postal, et `genererPlanCp` a déjà replié les grappes. '
  'Les membres d''un groupe indiscernable (sql/228) ont chacun leur ligne, au '
  'multiplicateur divisé — le plan achète tout le groupe.';

alter table public.zone_set_extraction_cp enable row level security;
revoke all on table public.zone_set_extraction_cp from public, anon, authenticated;
grant select, insert, delete on table public.zone_set_extraction_cp to service_role;

-- ── L'immuabilité, par trigger et non par convention ───────────────────────
--
-- Une route qui n'expose pas de PATCH suffit tant que personne n'écrit une
-- seconde route. La garantie doit tenir en base, là où la Phase 5 viendra lire.

-- ⚠ Le même trigger sert les DEUX tables, qui n'ont pas les mêmes colonnes :
-- la fille n'a ni `id` ni `version`. Nommer ces champs directement faisait
-- lever « record "old" has no field "id" » — un refus qui FONCTIONNE, mais
-- dont le message envoie chercher un défaut de schéma là où il n'y a qu'une
-- règle appliquée. On passe donc par `to_jsonb(old)`, qui rend ce qui existe
-- et `null` pour le reste.
create or replace function public.zse_refuser_update()
returns trigger
language plpgsql
as $$
declare
  v_old jsonb := to_jsonb(old);
begin
  raise exception
    'Une extraction est immuable (table %, extraction %, version %). Un recalage '
    'crée une nouvelle version : appeler creer_zone_set_extraction avec '
    'origine = ''recalage''.',
    tg_table_name,
    coalesce(v_old->>'id', v_old->>'extraction_id', '?'),
    coalesce(v_old->>'version', '?')
    using errcode = 'restrict_violation';
end $$;

comment on function public.zse_refuser_update is
  'Refuse tout UPDATE sur une extraction, mère ou fille. DELETE reste permis : '
  'sans quoi la cascade depuis zone_sets échouerait et un jeu deviendrait '
  'indestructible. Lit `old` par to_jsonb, les deux tables n''ayant pas les '
  'mêmes colonnes.';

drop trigger if exists trg_zse_immuable on public.zone_set_extractions;
create trigger trg_zse_immuable
  before update on public.zone_set_extractions
  for each row execute function public.zse_refuser_update();

drop trigger if exists trg_zse_cp_immuable on public.zone_set_extraction_cp;
create trigger trg_zse_cp_immuable
  before update on public.zone_set_extraction_cp
  for each row execute function public.zse_refuser_update();

-- ── La création ────────────────────────────────────────────────────────────
--
-- ⚠ Les multiplicateurs arrivent CALCULÉS, en argument. Ils ne sont pas
-- recalculés ici, et c'est délibéré : la règle du plan vit dans
-- `genererPlanCp` (`lib/zones/plan.ts`), fonction pure et testée, qui produit
-- AUSSI celui qu'on pousse au DSP. En réécrire une version SQL donnerait deux
-- implémentations qui divergeraient au premier correctif — et l'extraction
-- archivée ne serait plus ce qui est parti.
--
-- La base fait donc ce que seule la base peut faire : sérialiser l'attribution
-- du numéro de version, et figer.

create or replace function public.creer_zone_set_extraction(
  p_zone_set_id uuid,
  p_lignes      jsonb,
  p_resume      jsonb,
  p_origine     text default 'initiale',
  p_commentaire text default '',
  p_created_by  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t0        timestamptz := clock_timestamp();
  v_jeu       public.zone_sets%rowtype;
  v_empreinte text;
  v_existante public.zone_set_extractions%rowtype;
  v_version   int;
  v_id        uuid;
  v_n         int;
begin
  select * into v_jeu from public.zone_sets where id = p_zone_set_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'jeu_introuvable');
  end if;
  if v_jeu.construit_le is null then
    return jsonb_build_object('ok', false, 'error', 'jeu_non_construit');
  end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    -- Un plan vide n'est pas une extraction vide : c'est un appel fautif.
    -- L'archiver produirait une version qu'on croirait valide.
    return jsonb_build_object('ok', false, 'error', 'plan_vide');
  end if;

  -- L'empreinte porte le CONTENU, dans un ordre stable. Sans le `order by`,
  -- deux appels identiques rendraient deux empreintes selon l'ordre où le
  -- client a sérialisé ses lignes, et l'idempotence ne se déclencherait jamais.
  select md5(
           coalesce(v_jeu.seuil_couverture_cp::text, '') || '|' ||
           coalesce(v_jeu.mode_plan, '') || '|' ||
           coalesce(string_agg(l.cp || ':' || l.mult, ',' order by l.cp), '')
         )
    into v_empreinte
    from (
      select e->>'code_postal' as cp,
             round(coalesce((e->>'multiplicateur')::numeric, 0), 3)::text as mult
        from jsonb_array_elements(p_lignes) e
    ) l;

  -- ⚠ Le verrou couvre la lecture d'idempotence ET l'attribution du numéro.
  -- Le poser après le test laisserait deux appels concurrents conclure tous
  -- les deux « elle n'existe pas ».
  perform pg_advisory_xact_lock(hashtext('zone_set_extraction'), hashtext(p_zone_set_id::text));

  select * into v_existante
    from public.zone_set_extractions
   where zone_set_id = p_zone_set_id and empreinte = v_empreinte;

  if found then
    return jsonb_build_object(
      'ok', true, 'deja_extraite', true,
      'id', v_existante.id, 'version', v_existante.version,
      'origine', v_existante.origine, 'created_at', v_existante.created_at,
      'n_cp', v_existante.n_cp, 'n_retenus', v_existante.n_retenus,
      'taux_utile', v_existante.taux_utile,
      'part_plan_en_zone', v_existante.part_plan_en_zone,
      'duree_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000)
    );
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.zone_set_extractions where zone_set_id = p_zone_set_id;

  insert into public.zone_set_extractions (
    zone_set_id, version, origine, commentaire,
    seuil_couverture_cp, mode_plan,
    n_cp, n_retenus, taux_utile, part_plan_en_zone, population_exposee,
    empreinte, created_by
  ) values (
    p_zone_set_id, v_version,
    coalesce(nullif(p_origine, ''), 'initiale'),
    coalesce(p_commentaire, ''),
    v_jeu.seuil_couverture_cp, v_jeu.mode_plan,
    coalesce((p_resume->>'n_cp')::int, jsonb_array_length(p_lignes)),
    coalesce((p_resume->>'n_retenus')::int, 0),
    (p_resume->>'taux_utile')::numeric,
    (p_resume->>'part_plan_en_zone')::numeric,
    coalesce((p_resume->>'population_exposee')::numeric, 0),
    v_empreinte, p_created_by
  )
  returning id into v_id;

  insert into public.zone_set_extraction_cp (
    extraction_id, code_postal, code_canonique, classe,
    cluster_id, cluster_rang, zone_nom, pop_en_zone, pop_totale,
    part_en_zone, retenu, multiplicateur
  )
  select
    v_id,
    e->>'code_postal',
    -- Un code postal seul est son propre canonique : le repli vaut pour tous
    -- les appels qui ignorent la notion de groupe.
    coalesce(nullif(e->>'code_canonique', ''), e->>'code_postal'),
    coalesce(e->>'classe', 'hors'),
    nullif(e->>'cluster_id', '')::uuid,
    (e->>'cluster_rang')::int,
    nullif(e->>'zone_nom', ''),
    -- ⚠ Pas de `coalesce(…, 0)` : NULL veut dire « indiscernable », pas zéro.
    (e->>'pop_en_zone')::numeric,
    (e->>'pop_totale')::numeric,
    (e->>'part_en_zone')::numeric,
    coalesce((e->>'retenu')::boolean, false),
    -- Borné au type de destination : `genererPlanCp` plafonne déjà à 999.999,
    -- mais une valeur venue d'ailleurs ferait échouer l'insert entier.
    least(greatest(coalesce((e->>'multiplicateur')::numeric, 0), 0), 999.999)
  from jsonb_array_elements(p_lignes) e
  -- ⚠ Le client peut émettre deux fois le même code postal (membres d'un
  -- groupe mal dépliés). La clé primaire le refuserait et ferait échouer
  -- l'extraction entière ; on garde la première occurrence.
  on conflict (extraction_id, code_postal) do nothing;

  get diagnostics v_n = row_count;

  return jsonb_build_object(
    'ok', true, 'deja_extraite', false,
    'id', v_id, 'version', v_version,
    'origine', coalesce(nullif(p_origine, ''), 'initiale'),
    'lignes_ecrites', v_n,
    'n_cp', coalesce((p_resume->>'n_cp')::int, jsonb_array_length(p_lignes)),
    'n_retenus', coalesce((p_resume->>'n_retenus')::int, 0),
    'taux_utile', (p_resume->>'taux_utile')::numeric,
    'part_plan_en_zone', (p_resume->>'part_plan_en_zone')::numeric,
    'duree_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000)
  );
end $$;

comment on function public.creer_zone_set_extraction is
  'Fige un plan en extraction versionnée. Les multiplicateurs arrivent calculés '
  'par genererPlanCp (lib/zones/plan.ts) : les recalculer ici donnerait une '
  'seconde implémentation de la règle du plan. Idempotente à contenu identique. '
  'Version attribuée sous pg_advisory_xact_lock (leçon de sql/159).';

revoke all on function public.creer_zone_set_extraction(uuid, jsonb, jsonb, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.creer_zone_set_extraction(uuid, jsonb, jsonb, text, text, uuid)
  to service_role;
