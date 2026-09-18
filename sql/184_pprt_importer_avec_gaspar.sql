-- sql/184 — `pprt_importer_partition` écrit désormais `id_gaspar`
--
-- Suite de sql/183, qui a ajouté la colonne. La RPC d'import ne l'écrivait pas :
-- elle serait restée NULL sur les 664 lignes après un réimport, et une colonne
-- vide se lit comme une donnée que la source ne fournit pas — alors qu'ici elle
-- la fournit.
--
-- ── CE FICHIER EST UNE COPIE DE sql/177, PAS UNE RÉÉCRITURE ──────────────
--
-- La première version de cette migration avait été RETAPÉE de mémoire, en
-- annonçant dans son en-tête que « le reste du corps est repris à l'identique ».
-- C'était faux, deux fois :
--
--   `ref_departements` porte `code_dept` / `nom_dept`, pas `code_insee` / `nom`
--   → les 69 partitions ont échoué d'un bloc. Sans dommage : le DELETE et
--   l'INSERT sont dans la même transaction.
--
--   La géométrie se lit dans `e -> 'geojson'` (opérateur `->`, champ
--   `geojson`), pas `e ->> 'geometrie'` → `geom` valait NULL, la CTE `valides`
--   ne retenait rien, et l'INSERT n'écrivait rien **sans lever**. Le DELETE,
--   lui, a été validé : la table locale est tombée à zéro. Récupérée en
--   rejouant l'import (11 s) ; la production n'a jamais reçu cette version.
--
-- La leçon tient en une ligne : **une RPC qui commence par un DELETE ne se
-- recopie pas à la main.** Ce fichier est donc produit en COPIANT le corps de
-- sql/177 et en n'y substituant que trois ancrages, chacun vérifié présent —
-- si sql/177 change, la génération échoue au lieu de produire une variante
-- silencieusement différente.

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
      -- La PROCEDURE PPRT, via generateur_sup_s.id_gaspar (sql/183).
      e ->> 'id_gaspar'                                        as id_gaspar,
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
    id, nom, type_zone, type_zone_source, id_generateur, id_gaspar, id_assiette,
    nom_technique, depot_niveau, depot_code, code_departement, nom_departement,
    code_region, partition, document_source, fichier_acte, mode_geometrie,
    date_source, source, geom, geom_3857, superficie_km2
  )
  select
    id, nom, type_zone, type_zone_source, id_generateur, id_gaspar, id_assiette,
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

revoke all on function public.pprt_importer_partition(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.pprt_importer_partition(text, jsonb)
  to service_role;

comment on table public.pprt_perimetres is
  'Perimetres PPRT (servitudes PM3) de la Geoplateforme IGN. UNE LIGNE = UNE ASSIETTE : 664 assiettes, 609 generateurs (id_generateur = l etablissement), 415 procedures (pprt_documents). code_departement est CALCULE par recouvrement geometrique et non lu dans partition, dont 5 depots sur 69 sont regionaux (sql/177). id_gaspar relie l assiette a sa PROCEDURE via generateur_sup_s — ce commentaire affirmait qu une telle cle n existait pas, c etait faux (sql/183-184, 2026-09-18).';
