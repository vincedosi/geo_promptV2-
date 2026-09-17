-- sql/177 — Perimetres PPRT : table, import par partition, consolidation geo
--
-- Chantier B volet 2 : les perimetres REGLEMENTAIRES de risque technologique,
-- en complement du rayon calcule de sql/175. Le rayon est generalisable aux
-- 99 152 installations classees mais arbitraire ; le PPRT est la verite
-- officielle, la ou elle existe.
--
-- ── LA SOURCE : PM3 DE LA GEOPLATEFORME, PAS LE WFS GEORISQUES ────────────
--
-- WFS `wfs_sup:assiette_sup_s` sur data.geopf.fr, filtre `suptype='pm3'`. La
-- categorie PM3 des servitudes d'utilite publique EST le PPRT ; la couche est
-- alimentee par le Geoportail de l'Urbanisme.
--
-- Le WFS Georisques `ms:PPRT_PERIMETRE_RISQIND`, dont le nom promet exactement
-- cette donnee, a ete ecarte sur mesure du 2026-09-17 : ~147 000 lignes, TOUS
-- les PPR confondus (la ligne a STARTINDEX=100000 est un PPR mouvement de
-- terrain), `CQL_FILTER` ignore en silence, `numberMatched` toujours egal a
-- 500, et pas de sortie GeoJSON. Detail chiffre : ARCHITECTURE.md
-- § « Perimetres PPRT ».
--
-- ── UNE LIGNE = UNE ASSIETTE, ET CE N'EST PAS UN PPRT ────────────────────
--
-- TROIS nombres, aucun interchangeable : 664 assiettes (les polygones de cette
-- table), 609 GENERATEURS (`id_generateur`, l'etablissement a l'origine du
-- risque), 415 PROCEDURES PPRT (`gaspar/pprt`). Plusieurs generateurs relevent
-- d'une meme procedure, et ce flux ne porte AUCUNE cle de jointure vers
-- GASPAR. Ne jamais afficher 664 ni 609 comme un « nombre de PPRT ».
--
-- ── POURQUOI `code_departement` EST CALCULE ET NON LU ────────────────────
--
-- Le nom de partition porte un code (`..._SUP_62_PM3`), mais 5 depots sur 69
-- sont REGIONAUX (`_SUP_R76_`, Occitanie) et portent 77 des 664 zones. Lire ce
-- code comme un departement ferait passer 33 zones d'Occitanie pour de la
-- Seine-Maritime — les deux nomenclatures INSEE se recouvrent, `76` designe
-- les deux. Le departement vient donc de la GEOMETRIE, par recouvrement
-- maximal avec `ref_departements` : une zone a cheval sur deux departements
-- est attribuee a celui qu'elle mord le plus, et non au premier trouve.
--
-- ── DEUX PIEGES POSTGIS TRAITES ICI ──────────────────────────────────────
--
--   1. `ST_MakeValid` avant tout : un trace depose par une DDT peut se croiser,
--      et toute operation PostGIS ulterieure LEVE dessus (meme raison que
--      `zone_dessin`, sql/156). Il peut rendre une GeometryCollection, d'ou le
--      `ST_CollectionExtract(..., 3)` qui n'en garde que les polygones, puis le
--      `ST_Multi` qui garantit le type declare de la colonne.
--   2. `superficie_km2` est mesuree sur `geography` — des metres vrais. La
--      calculer en 4326 rendrait des degres carres, et en 3857 une surface
--      surestimee de 80 % a la latitude de Lille.
--
-- `geom_3857` est pre-calculee parce que c'est la projection ou vit l'index
-- GIST de `carreaux_1km` : c'est elle que le chantier C (population exposee)
-- intersectera. Pas de ST_Transform a la volee sur 664 polygones de 306
-- sommets moyens.

-- ── 1. La table ───────────────────────────────────────────────────────────

create table if not exists public.pprt_perimetres (
  id                uuid primary key,
  nom               text not null,
  type_zone         text not null
                      check (type_zone in ('enveloppe', 'perimetre_reglemente', 'indetermine')),
  -- Valeur brute de `typeass`, gardee telle quelle : la source en sert SIX
  -- orthographes pour deux familles, dont une en mojibake et une egale a '24'.
  -- Normaliser sans conserver l'original rendrait l'ecart invisible.
  type_zone_source  text,
  id_generateur     text,
  -- `idass` de la source. NON unique : `2147483647` (INT32_MAX) est porte par
  -- quatre PPRT sans rapport. Conserve pour la tracabilite, jamais comme cle.
  id_assiette       text,
  nom_technique     text,
  depot_niveau      text check (depot_niveau in ('departement', 'region')),
  depot_code        text,
  code_departement  text,
  nom_departement   text,
  code_region       text,
  partition         text not null,
  document_source   text,
  fichier_acte      text,
  mode_geometrie    text,
  date_source       timestamptz,
  source            text not null default 'geoplateforme_pm3',
  geom              geometry(MultiPolygon, 4326) not null,
  geom_3857         geometry(MultiPolygon, 3857) not null,
  superficie_km2    double precision,
  importe_le        timestamptz not null default now()
);

create index if not exists idx_pprt_geom       on public.pprt_perimetres using gist (geom);
create index if not exists idx_pprt_geom_3857  on public.pprt_perimetres using gist (geom_3857);
create index if not exists idx_pprt_partition  on public.pprt_perimetres (partition);
create index if not exists idx_pprt_dept       on public.pprt_perimetres (code_departement);
create index if not exists idx_pprt_generateur on public.pprt_perimetres (id_generateur);

alter table public.pprt_perimetres enable row level security;

comment on table public.pprt_perimetres is
  'Perimetres PPRT (servitudes PM3) de la Geoplateforme IGN. UNE LIGNE = UNE ASSIETTE : 664 assiettes, 609 generateurs (id_generateur = l etablissement, PAS la procedure : GASPAR en recense 415, sans cle de jointure). code_departement est CALCULE par recouvrement geometrique et non lu dans partition, dont 5 depots sur 69 sont regionaux (sql/177, 2026-09-17).';

-- ── 2. Import d'une partition : DELETE cible + INSERT, en une transaction ──
--
-- La partition (le document depose au GPU) est l'unite de remplacement : quand
-- une DDT redepose son document, ses zones sont remplacees en bloc. Le DELETE
-- et l'INSERT vivent dans la MEME fonction, donc la meme transaction : il n'y a
-- jamais d'instant ou la partition est vide en base, contrairement a un DELETE
-- puis un INSERT emis separement par le client.
--
-- Set-based : un seul INSERT ... SELECT pour toute la partition (200 lignes au
-- maximum mesure, 0,66 Mo de charge utile). La regle « lots de 50 » du projet
-- vise les allers-retours reseau, pas le nombre de lignes d'une instruction.

create or replace function public.pprt_importer_partition(
  p_partition text,
  p_lignes    jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_supprimees int;
  v_inserees   int;
  v_recues     int := coalesce(jsonb_array_length(p_lignes), 0);
begin
  if p_partition is null or p_partition = '' then
    return jsonb_build_object('erreur', 'partition_absente');
  end if;

  delete from public.pprt_perimetres where partition = p_partition;
  get diagnostics v_supprimees = row_count;

  with brut as (
    select
      (e ->> 'id')::uuid                                       as id,
      e ->> 'nom'                                              as nom,
      e ->> 'type_zone'                                        as type_zone,
      e ->> 'type_zone_source'                                 as type_zone_source,
      e ->> 'id_generateur'                                    as id_generateur,
      e ->> 'id_assiette'                                      as id_assiette,
      e ->> 'nom_technique'                                    as nom_technique,
      e ->> 'depot_niveau'                                     as depot_niveau,
      e ->> 'depot_code'                                       as depot_code,
      e ->> 'partition'                                        as partition,
      e ->> 'document_source'                                  as document_source,
      e ->> 'fichier_acte'                                     as fichier_acte,
      e ->> 'mode_geometrie'                                   as mode_geometrie,
      (e ->> 'date_source')::timestamptz                       as date_source,
      coalesce(e ->> 'source', 'geoplateforme_pm3')            as source,
      -- MakeValid avant tout, puis on ne garde que les polygones (type 3) : un
      -- trace auto-intersecte devient une GeometryCollection, que la colonne
      -- MultiPolygon refuserait.
      ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(
            ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(e -> 'geojson'), 4326))
          ),
          3
        )
      )                                                        as geom
    from jsonb_array_elements(p_lignes) as e
  ),
  -- Une geometrie vidée par la reparation ne doit pas entrer : elle
  -- s'afficherait comme une zone sans surface.
  valides as (
    select * from brut where geom is not null and not ST_IsEmpty(geom)
  ),
  -- Departement de RECOUVREMENT MAXIMAL, pas le premier intersecte : une zone
  -- a cheval doit tomber du cote ou elle mord le plus.
  situees as (
    select
      v.*,
      d.code_dept,
      d.nom_dept,
      d.code_region
    from valides v
    left join lateral (
      select r.code_dept, r.nom_dept, r.code_region
        from public.ref_departements r
       where r.geom && v.geom
         and ST_Intersects(r.geom, v.geom)
       order by ST_Area(ST_Intersection(r.geom, v.geom)) desc
       limit 1
    ) d on true
  )
  insert into public.pprt_perimetres (
    id, nom, type_zone, type_zone_source, id_generateur, id_assiette,
    nom_technique, depot_niveau, depot_code, code_departement, nom_departement,
    code_region, partition, document_source, fichier_acte, mode_geometrie,
    date_source, source, geom, geom_3857, superficie_km2
  )
  select
    id, nom, type_zone, type_zone_source, id_generateur, id_assiette,
    nom_technique, depot_niveau, depot_code, code_dept, nom_dept,
    code_region, partition, document_source, fichier_acte, mode_geometrie,
    date_source, source,
    geom,
    ST_Transform(geom, 3857),
    -- Metres vrais : ST_Area sur geography. En 3857 la surface serait
    -- surestimee de ~80 % a la latitude de Lille.
    ST_Area(geom::geography) / 1000000.0
  from situees
  -- L'id est deterministe (UUIDv5 du contenu) : deux lignes de la MEME
  -- partition au trace identique existent dans la source et ne doivent pas
  -- faire echouer l'import entier.
  on conflict (id) do nothing;

  get diagnostics v_inserees = row_count;

  return jsonb_build_object(
    'partition',  p_partition,
    'recues',     v_recues,
    'supprimees', v_supprimees,
    'inserees',   v_inserees,
    -- Ecart explicite : geometrie vidée par la reparation, ou doublon exact.
    'ecartees',   v_recues - v_inserees
  );
end;
$function$;

comment on function public.pprt_importer_partition(text, jsonb) is
  'Remplace en UNE transaction toutes les zones PPRT d une partition (DELETE cible + INSERT set-based). ST_MakeValid puis CollectionExtract(3) avant insertion ; departement par recouvrement maximal sur ref_departements ; superficie sur geography. Rend recues/supprimees/inserees/ecartees (sql/177).';

-- ── 3. Consolidation du departement, rejouable ────────────────────────────
--
-- Meme role que `consolider_geo_icpe` (sql/174) : une colonne ajoutee apres un
-- import, ou un referentiel departemental corrige, se rattrape sans reimporter
-- les 5,6 Mo du WFS.

create or replace function public.pprt_consolider_departement()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_reparees int;
  v_restantes int;
begin
  with situees as (
    select
      p.id,
      d.code_dept,
      d.nom_dept,
      d.code_region
    from public.pprt_perimetres p
    left join lateral (
      select r.code_dept, r.nom_dept, r.code_region
        from public.ref_departements r
       where r.geom && p.geom
         and ST_Intersects(r.geom, p.geom)
       order by ST_Area(ST_Intersection(r.geom, p.geom)) desc
       limit 1
    ) d on true
    where p.code_departement is null
  )
  update public.pprt_perimetres p
     set code_departement = s.code_dept,
         nom_departement  = s.nom_dept,
         code_region      = s.code_region
    from situees s
   where p.id = s.id
     and s.code_dept is not null;

  get diagnostics v_reparees = row_count;

  select count(*) into v_restantes
    from public.pprt_perimetres
   where code_departement is null;

  return jsonb_build_object('reparees', v_reparees, 'sans_departement', v_restantes);
end;
$function$;

comment on function public.pprt_consolider_departement() is
  'Recalcule code_departement/nom_departement/code_region des zones PPRT qui en manquent, par recouvrement maximal sur ref_departements. Rejouable, ne touche jamais une ligne deja renseignee (sql/177).';
