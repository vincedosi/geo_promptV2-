-- sql/277 — Les jeux de ZONE, à côté des jeux risque (lot 5, T6 ; arbitrages A-1, A-2, A-3, A-11 du plan
-- `docs/superpowers/plans/2026-10-24-carte-en-parcours-lot-5.md`).
--
-- UN TYPE, PAS UNE SECONDE TABLE. `zone_sets` porte les jeux du module risque (profil d'anneaux, grappes, classes,
-- simulation). Un jeu de zone est autre chose : UNE zone enregistrée (`custom_geo_zone_id`, colonne déjà là et déjà
-- lue par `zone_referencee`, sql/253), une cible, un mode de plan, et un choix de maille PAR PLATEFORME
-- (`zone_set_plateformes`). Les deux cohabitent par `type` ('risque' par défaut : les lignes existantes et tous les
-- écrivains du moteur risque restent valides sans changer une ligne). Le moteur risque n'est PAS modifié :
-- `remplir_zone_set_cp`, `appliquer_seuil_zone_set`, `construire_zone_set*`, `creer_zone_set_extraction` sont
-- intacts, caractérisés par `tests/integration/jeu-risque-caracterisation.test.ts` (T1).
--
-- PROFIL FACULTATIF, MAIS PAR TYPE. Seule exception écrite à « aucun DROP » du lot : `DROP NOT NULL` sur `profil` et
-- `profil_hash`, aussitôt remplacé par un CHECK — un jeu risque sans profil reste impossible, un jeu de zone n'en a
-- pas. Le CHECK est posé AVANT le relâchement : il n'y a aucun instant où un jeu risque sans profil passerait.
--
-- LA ZONE D'UN JEU NE DISPARAÎT PAS. `zone_referencee` refuse déjà, côté route, le recalcul et la suppression d'une
-- zone citée par un jeu ; la clé étrangère `on delete restrict` le garantit aussi en base, pour l'écrivain qui
-- n'appellerait pas la route.
--
-- PAS D'UNITÉS VIVANTES (A-2). Un jeu de zone ne stocke ni CP ni cercles : ses chiffres se relisent (couverture en
-- cache). C'est l'EXTRACTION qui fige : CP dans `zone_set_extraction_cp` (existante, `classe` 'zone' | 'hors',
-- `cluster_id` NULL), toute autre maille dans `zone_set_extraction_unites`, et la FORME de la zone copiée dans
-- `zone_set_extractions.forme` pour qu'une extraction se lise sans sa zone.
--
-- REJOUABLE : `if not exists`, contraintes ajoutées sous garde `pg_constraint`, `create or replace` (fonction et
-- déclencheur). Aucun DROP.
-- Pas de begin/commit dans le fichier (les tests le rejouent dans une transaction annulée) : appliquer par `psql -1`.
-- Droits : service_role seul, RLS activée sans policy (patron sql/231, sql/274).

-- ── zone_sets : le type ────────────────────────────────────────────────────────────────────────────────────────────

alter table public.zone_sets add column if not exists type text not null default 'risque';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.zone_sets'::regclass and conname = 'zone_sets_type_check') then
    alter table public.zone_sets add constraint zone_sets_type_check check (type in ('risque', 'zone'));
  end if;
  -- Un jeu risque sans profil n'a pas de géométrie : le moteur ne saurait pas le construire.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.zone_sets'::regclass and conname = 'zone_sets_profil_par_type') then
    alter table public.zone_sets add constraint zone_sets_profil_par_type
      check (type = 'zone' or (profil is not null and profil_hash is not null));
  end if;
  -- A-1 : un jeu de zone porte UNE zone. Plusieurs secteurs = une combinaison (union) faite en ③.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.zone_sets'::regclass and conname = 'zone_sets_zone_par_type') then
    alter table public.zone_sets add constraint zone_sets_zone_par_type
      check (type = 'risque' or custom_geo_zone_id is not null);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.zone_sets'::regclass and conname = 'zone_sets_custom_geo_zone_id_fkey') then
    alter table public.zone_sets add constraint zone_sets_custom_geo_zone_id_fkey
      foreign key (custom_geo_zone_id) references public.custom_geo_zones (id) on delete restrict;
  end if;
end $$;

alter table public.zone_sets alter column profil drop not null, alter column profil_hash drop not null;

-- `zone_referencee` et le contrôle `on delete restrict` cherchent les jeux d'une zone : sans index, chaque suppression
-- de zone parcourrait toute la table. Partiel : les jeux risque n'ont pas de zone.
create index if not exists idx_zone_sets_zone
  on public.zone_sets (custom_geo_zone_id) where custom_geo_zone_id is not null;

comment on column public.zone_sets.type is
  '''risque'' : jeu du module risque (profil, grappes, zone_set_cp). ''zone'' : une zone enregistrée '
  '(custom_geo_zone_id) + un choix de maille par plateforme (zone_set_plateformes), sans unités stockées avant '
  'l''extraction (sql/277).';

-- ── zone_set_plateformes : un choix par plateforme ─────────────────────────────────────────────────────────────────
--
-- A-4 : chaque plateforme a SA maille, SON seuil (part minimale de population en zone pour retenir une unité, en
-- POURCENTAGE comme `seuil_couverture_cp`) et, pour les cercles, SON rayon. La clé étrangère vers `plateformes_geo`
-- interdit une maille que le registre ne connaît pas ; « disponible » se vérifie à la route (une ligne indisponible
-- est connue, affichée grisée, mais ne s'achète pas).

create table if not exists public.zone_set_plateformes (
  zone_set_id uuid    not null references public.zone_sets (id) on delete cascade,
  plateforme  text    not null,
  maille      text    not null,
  seuil       numeric not null check (seuil >= 0 and seuil <= 100),
  rayon_m     integer check (rayon_m > 0),
  primary key (zone_set_id, plateforme),
  foreign key (plateforme, maille) references public.plateformes_geo (plateforme, maille),
  -- Un cercle sans rayon ne se pave pas ; un rayon sur une autre maille serait un réglage que personne ne lit.
  constraint zsp_rayon_cercle check ((maille = 'cercle') = (rayon_m is not null))
);

comment on table public.zone_set_plateformes is
  'Le choix de maille d''un jeu de zone, une ligne par plateforme : maille (clé étrangère vers plateformes_geo), '
  'seuil en pourcentage, rayon pour le cercle. Aucune unité ici : elles se figent à l''extraction (sql/277, A-2).';

alter table public.zone_set_plateformes enable row level security;
revoke all on table public.zone_set_plateformes from public, anon, authenticated;
grant select, insert, update, delete on table public.zone_set_plateformes to service_role;

-- ── zone_set_extractions : le résumé par plateforme et la forme ────────────────────────────────────────────────────

alter table public.zone_set_extractions
  add column if not exists plateformes jsonb,
  add column if not exists forme geometry(MultiPolygon, 4326);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.zone_set_extractions'::regclass and conname = 'zse_plateformes_tableau') then
    alter table public.zone_set_extractions add constraint zse_plateformes_tableau
      check (plateformes is null or jsonb_typeof(plateformes) = 'array');
  end if;
end $$;

create index if not exists idx_zse_forme on public.zone_set_extractions using gist (forme);

comment on column public.zone_set_extractions.plateformes is
  'Jeu de zone : un objet par plateforme choisie — choix lu dans zone_set_plateformes à l''extraction (plateforme, '
  'maille, seuil, rayon_m) + chiffres calculés par le serveur. NULL pour un jeu risque.';
comment on column public.zone_set_extractions.forme is
  'Jeu de zone : copie de la géométrie de la zone au moment de l''extraction, pour que l''extraction se lise sans '
  'elle. NULL pour un jeu risque.';

-- ── zone_set_extraction_unites : les unités figées hors CP ─────────────────────────────────────────────────────────

create table if not exists public.zone_set_extraction_unites (
  extraction_id uuid    not null references public.zone_set_extractions (id) on delete cascade,
  plateforme    text    not null,
  -- Les CP vont dans `zone_set_extraction_cp` (multiplicateur, groupes indiscernables) : une seule table par maille.
  maille        text    not null check (maille <> 'cp'),
  -- Rang dans l'ordre reçu, par (plateforme, maille) : un cercle n'a pas de code, c'est son rang qui le désigne.
  ordinal       integer not null,
  code          text,
  nom           text,
  centre        geometry(Point, 4326),
  rayon_m       integer,
  -- NULLABLES : une population inconnue n'est pas zéro (même règle que zone_set_extraction_cp).
  pop_en_zone   numeric,
  pop_totale    numeric,
  part          numeric,
  retenu        boolean not null default false,
  primary key (extraction_id, plateforme, maille, ordinal)
);

comment on table public.zone_set_extraction_unites is
  'Unités figées d''une extraction de jeu de zone, hors CP : communes, départements, IRIS, cercles, polygone. '
  'IMMUABLE (trg_zse_unites_immuable), écrite par creer_extraction_jeu_zone (sql/277).';

create index if not exists idx_zseu_centre on public.zone_set_extraction_unites using gist (centre);

alter table public.zone_set_extraction_unites enable row level security;
revoke all on table public.zone_set_extraction_unites from public, anon, authenticated;
grant select, insert, delete on table public.zone_set_extraction_unites to service_role;

-- Le même déclencheur que la mère et la table des CP (sql/231) : il lit `old` par to_jsonb, donc sans colonne imposée.
create or replace trigger trg_zse_unites_immuable
  before update on public.zone_set_extraction_unites
  for each row execute function public.zse_refuser_update();

-- ── creer_extraction_jeu_zone ──────────────────────────────────────────────────────────────────────────────────────
--
-- La jumelle de `creer_zone_set_extraction` (sql/231, inchangée) pour un jeu de zone. Mêmes principes : les unités
-- et les multiplicateurs arrivent CALCULÉS par le serveur (la règle du plan vit dans `genererPlanCp`, le seuil dans
-- `lib/zones/conversion.ts`) ; la base sérialise la version et fige.
--
-- Le verrou consultatif est le MÊME que celui de sql/231 (`hashtext('zone_set_extraction')`, id du jeu) : les deux
-- fonctions numérotent la même table, elles doivent s'exclure.
--
-- EMPREINTE, ordre déterministe : mode de plan | choix (lus en base, triés par plateforme) | CP `code:multiplicateur`
-- triés | unités `plateforme:maille:code:lon:lat:rayon:retenu:part` triées — tri en collation "C", indépendant de la
-- langue du serveur. L'ORDRE D'ENVOI des unités n'y entre pas (il ne fait que l'`ordinal`) : deux appels au même
-- contenu rendent `deja_extraite`, dans quelque ordre que le serveur ait sérialisé.
--
-- Refus : `jeu_introuvable`, `type_non_zone` (un jeu risque s'extrait par creer_zone_set_extraction), `plan_vide`
-- (ni CP ni unité, ou un argument qui n'est pas un tableau), `unites_hors_choix` (une unité d'une plateforme ou d'une
-- maille que le jeu n'a pas choisie, une unité 'cp' hors de p_cp, ou des CP sans aucun choix au CP).

create or replace function public.creer_extraction_jeu_zone(
  p_zone_set_id uuid,
  p_cp          jsonb,
  p_unites      jsonb,
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
  v_t0          timestamptz := clock_timestamp();
  v_jeu         public.zone_sets%rowtype;
  v_cp          jsonb := coalesce(p_cp, '[]'::jsonb);
  v_unites      jsonb := coalesce(p_unites, '[]'::jsonb);
  v_resumes     jsonb := case when jsonb_typeof(p_resume -> 'plateformes') = 'array'
                              then p_resume -> 'plateformes' else '[]'::jsonb end;
  v_plateformes jsonb;
  v_seuil       numeric;
  v_empreinte   text;
  v_existante   public.zone_set_extractions%rowtype;
  v_version     int;
  v_id          uuid;
  v_n_cp        int;
  v_n_unites    int;
begin
  select * into v_jeu from public.zone_sets where id = p_zone_set_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'jeu_introuvable');
  end if;
  if v_jeu.type <> 'zone' then
    return jsonb_build_object('ok', false, 'error', 'type_non_zone');
  end if;
  -- Deux tests et non un `or` : SQL ne garantit pas l'ordre d'évaluation, et jsonb_array_length lève sur un objet.
  if jsonb_typeof(v_cp) <> 'array' or jsonb_typeof(v_unites) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'plan_vide');
  end if;
  if jsonb_array_length(v_cp) + jsonb_array_length(v_unites) = 0 then
    return jsonb_build_object('ok', false, 'error', 'plan_vide');
  end if;

  if exists (select 1 from jsonb_array_elements(v_unites) e
              where e ->> 'maille' = 'cp'
                 or not exists (select 1 from public.zone_set_plateformes zp
                                 where zp.zone_set_id = p_zone_set_id
                                   and zp.plateforme = e ->> 'plateforme' and zp.maille = e ->> 'maille'))
     or (jsonb_array_length(v_cp) > 0
         and not exists (select 1 from public.zone_set_plateformes
                          where zone_set_id = p_zone_set_id and maille = 'cp')) then
    return jsonb_build_object('ok', false, 'error', 'unites_hors_choix');
  end if;

  -- Le CHOIX vient de la base, les CHIFFRES du résumé calculé par le serveur : le choix l'emporte sur une clé
  -- homonyme du résumé, un résumé ne réécrit pas ce qui a été enregistré.
  select coalesce(jsonb_agg(coalesce(r.resume, '{}'::jsonb)
                            || jsonb_build_object('plateforme', zp.plateforme, 'maille', zp.maille,
                                                  'seuil', zp.seuil, 'rayon_m', zp.rayon_m)
                            order by zp.plateforme), '[]'::jsonb)
    into v_plateformes
    from public.zone_set_plateformes zp
    left join lateral (select e as resume from jsonb_array_elements(v_resumes) e
                        where jsonb_typeof(e) = 'object' and e ->> 'plateforme' = zp.plateforme
                        limit 1) r on true
   where zp.zone_set_id = p_zone_set_id;

  -- `seuil_couverture_cp` dit le seuil des CP de CETTE extraction : celui du choix au CP ; à défaut (aucune
  -- plateforme au CP), la valeur du jeu. Les seuils des autres mailles sont dans `plateformes`.
  select min(seuil) into v_seuil from public.zone_set_plateformes
   where zone_set_id = p_zone_set_id and maille = 'cp';
  v_seuil := coalesce(v_seuil, v_jeu.seuil_couverture_cp);

  select md5(concat_ws('|',
           v_jeu.mode_plan,
           (select string_agg(concat_ws(':', plateforme, maille, seuil::text, coalesce(rayon_m::text, '')), ','
                              order by plateforme)
              from public.zone_set_plateformes where zone_set_id = p_zone_set_id),
           (select coalesce(string_agg(k, ',' order by k collate "C"), '')
              from (select concat_ws(':', e ->> 'code_postal',
                                     round(coalesce((e ->> 'multiplicateur')::numeric, 0), 3)::text) as k
                      from jsonb_array_elements(v_cp) e) c),
           (select coalesce(string_agg(k, ',' order by k collate "C"), '')
              from (select concat_ws(':', e ->> 'plateforme', e ->> 'maille', coalesce(e ->> 'code', ''),
                                     coalesce(round((e ->> 'lon')::numeric, 6)::text, ''),
                                     coalesce(round((e ->> 'lat')::numeric, 6)::text, ''),
                                     coalesce(e ->> 'rayon_m', ''),
                                     coalesce((e ->> 'retenu')::boolean, false)::text,
                                     coalesce(round((e ->> 'part')::numeric, 3)::text, '')) as k
                      from jsonb_array_elements(v_unites) e) u)))
    into v_empreinte;

  -- ⚠ Le verrou couvre la lecture d'idempotence ET l'attribution du numéro (leçon de sql/159, comme sql/231).
  perform pg_advisory_xact_lock(hashtext('zone_set_extraction'), hashtext(p_zone_set_id::text));

  select * into v_existante from public.zone_set_extractions
   where zone_set_id = p_zone_set_id and empreinte = v_empreinte;
  if found then
    return jsonb_build_object(
      'ok', true, 'deja_extraite', true,
      'id', v_existante.id, 'version', v_existante.version,
      'origine', v_existante.origine, 'created_at', v_existante.created_at,
      'n_cp', v_existante.n_cp, 'n_retenus', v_existante.n_retenus,
      'taux_utile', v_existante.taux_utile, 'part_plan_en_zone', v_existante.part_plan_en_zone,
      'plateformes', v_existante.plateformes,
      'duree_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000));
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.zone_set_extractions where zone_set_id = p_zone_set_id;

  insert into public.zone_set_extractions (
    zone_set_id, version, origine, commentaire, seuil_couverture_cp, mode_plan,
    n_cp, n_retenus, taux_utile, part_plan_en_zone, population_exposee,
    empreinte, created_by, plateformes, forme
  ) values (
    p_zone_set_id, v_version,
    coalesce(nullif(p_origine, ''), 'initiale'), coalesce(p_commentaire, ''),
    v_seuil, v_jeu.mode_plan,
    coalesce((p_resume ->> 'n_cp')::int, jsonb_array_length(v_cp)),
    coalesce((p_resume ->> 'n_retenus')::int, 0),
    (p_resume ->> 'taux_utile')::numeric,
    (p_resume ->> 'part_plan_en_zone')::numeric,
    coalesce((p_resume ->> 'population_exposee')::numeric, 0),
    v_empreinte, p_created_by, v_plateformes,
    (select z.geometry from public.custom_geo_zones z where z.id = v_jeu.custom_geo_zone_id)
  )
  returning id into v_id;

  -- Les CP : mêmes colonnes et mêmes replis que sql/231 ; pas de grappe pour un jeu de zone.
  insert into public.zone_set_extraction_cp (
    extraction_id, code_postal, code_canonique, classe, pop_en_zone, pop_totale, part_en_zone, retenu, multiplicateur
  )
  select v_id, e ->> 'code_postal',
         coalesce(nullif(e ->> 'code_canonique', ''), e ->> 'code_postal'),
         coalesce(e ->> 'classe', 'hors'),
         (e ->> 'pop_en_zone')::numeric, (e ->> 'pop_totale')::numeric, (e ->> 'part_en_zone')::numeric,
         coalesce((e ->> 'retenu')::boolean, false),
         least(greatest(coalesce((e ->> 'multiplicateur')::numeric, 0), 0), 999.999)
    from jsonb_array_elements(v_cp) e
  on conflict (extraction_id, code_postal) do nothing;
  get diagnostics v_n_cp = row_count;

  insert into public.zone_set_extraction_unites (
    extraction_id, plateforme, maille, ordinal, code, nom, centre, rayon_m, pop_en_zone, pop_totale, part, retenu
  )
  select v_id, e ->> 'plateforme', e ->> 'maille',
         row_number() over (partition by e ->> 'plateforme', e ->> 'maille' order by n),
         nullif(e ->> 'code', ''), nullif(e ->> 'nom', ''),
         case when e ? 'lon' and e ? 'lat'
              then ST_SetSRID(ST_MakePoint((e ->> 'lon')::float8, (e ->> 'lat')::float8), 4326) end,
         (e ->> 'rayon_m')::int,
         (e ->> 'pop_en_zone')::numeric, (e ->> 'pop_totale')::numeric, (e ->> 'part')::numeric,
         coalesce((e ->> 'retenu')::boolean, false)
    from jsonb_array_elements(v_unites) with ordinality t(e, n);
  get diagnostics v_n_unites = row_count;

  return jsonb_build_object(
    'ok', true, 'deja_extraite', false,
    'id', v_id, 'version', v_version,
    'origine', coalesce(nullif(p_origine, ''), 'initiale'),
    'lignes_ecrites', v_n_cp, 'unites_ecrites', v_n_unites,
    'n_cp', coalesce((p_resume ->> 'n_cp')::int, jsonb_array_length(v_cp)),
    'n_retenus', coalesce((p_resume ->> 'n_retenus')::int, 0),
    'taux_utile', (p_resume ->> 'taux_utile')::numeric,
    'part_plan_en_zone', (p_resume ->> 'part_plan_en_zone')::numeric,
    'plateformes', v_plateformes,
    'duree_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000));
end $$;

comment on function public.creer_extraction_jeu_zone is
  'Fige l''extraction d''un jeu de zone (sql/277) : CP dans zone_set_extraction_cp, autres unités dans '
  'zone_set_extraction_unites, forme de la zone copiée, choix par plateforme lus en base. Idempotente à contenu '
  'identique (empreinte indépendante de l''ordre des unités). Même verrou que creer_zone_set_extraction.';

revoke all on function public.creer_extraction_jeu_zone(uuid, jsonb, jsonb, jsonb, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.creer_extraction_jeu_zone(uuid, jsonb, jsonb, jsonb, text, text, uuid)
  to service_role;
