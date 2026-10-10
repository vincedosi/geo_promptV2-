-- 247 — Une zone custom ne garde que ses polygones après réparation (2026-10-11)
--
-- ── Le défaut ────────────────────────────────────────────────────────────────
--
-- Constaté au lot 4 Angular (T16) et reproduit en psql le 2026-10-11 : une zone
-- par codes postaux comme 13001 + 13002, 75001 + 75002, 69001 + 69002, et même
-- 13002 SEUL, ne s'enregistrait pas. `/api/custom-geo/save` répondait 400, React
-- comme Angular (même chaîne d'appels).
--
-- La cause n'est PAS l'union de polygones qui se touchent. Mesuré :
--   - les 6 187 géométries de `ref_codes_postaux` sont valides (0 invalide) ;
--   - `ST_Union` de 13001 + 13002 en base est valide (« Valid Geometry ») ;
--   - mais la géométrie source de 13002 porte deux TROUS dégénérés, dont un
--     anneau de 4 points dont deux ne diffèrent qu'à la 15e décimale
--     (5.371244886856021 / 5.371244886856023) — une écharde de 2,2e-18 deg².
--   - `get_admin_filter_geometry` sérialise par `ST_AsGeoJSON` (9 décimales par
--     défaut) : les deux points fusionnent, l'anneau tombe à 3 points distincts,
--     et la géométrie que le client renvoie à `/save` est INVALIDE
--     (« Too few points in geometry component »).
--   - `create_custom_geo_zone` la passe à `ST_MakeValid`, dont la méthode par
--     défaut (`linework`) conserve l'anneau effondré sous forme de LIGNE : le
--     résultat est une GEOMETRYCOLLECTION (MultiPolygon + MultiLineString), que
--     la colonne `geometry(MultiPolygon, 4326)` refuse :
--     « Geometry type (GeometryCollection) does not match column type ».
--
-- Mesure des résidus (2026-10-11) : ce ne sont QUE des lignes, jamais un point
-- ni une surface — 13001+13002 : 2 segments ; 75001+75002 : 2 ; 13002 : 1 ;
-- 13006+13007 : 1 ; 69001+69002 : 1. Surface de la partie polygonale contre
-- l'union exacte en base : écart < 2e-7 km² sur chacune (13001+13002 :
-- 5,206997 km² des deux côtés).
--
-- ── Le correctif ─────────────────────────────────────────────────────────────
--
-- Après `ST_MakeValid`, `ST_CollectionExtract(…, 3)` ne garde que les
-- polygones. Ce n'est pas une perte : les résidus jetés n'ont aucune aire, et
-- une zone custom est une SURFACE (la colonne n'accepte que des polygones). Une
-- réparation qui ne laisse aucune surface lève une erreur explicite au lieu de
-- l'erreur de type de colonne.
--
-- Rien ne change pour une géométrie déjà valide : elle ne passe ni par
-- `ST_MakeValid` ni par l'extraction (même branche `IF NOT ST_IsValid`
-- qu'avant). Vérifié : 13001 seul et 13004 + 13005 + 13012 rendent la même
-- surface et les mêmes comptes IRIS/CP avant et après.
--
-- `create_custom_geo_zone_with_subzones` portait le même défaut, deux fois (zone
-- parente ET chaque sous-zone) : corrigée dans le même fichier, même patron.
-- Sa branche sans sous-zones délègue déjà à `create_custom_geo_zone`.
--
-- Pas de correction à la source (`get_admin_filter_geometry` en 15 décimales,
-- ou `ref_codes_postaux` nettoyée) : la géométrie fait un aller-retour par le
-- client, et toute autre source (dessin, capture, opérations) peut arriver
-- invalide. C'est l'enregistrement qui doit tenir.
--
-- Signatures inchangées, `create or replace` : les droits existants sont
-- conservés. Rejouable. Verrouillé par
-- tests/integration/zone-cp-voisins.test.ts.

begin;

create or replace function public.create_custom_geo_zone(
  p_name text,
  p_description text,
  p_org_id uuid,
  p_source_type text,
  p_source_metadata jsonb,
  p_geometry_geojson text
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_geom geometry;
begin
  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geometry_geojson), 4326);

  if GeometryType(v_geom) not in ('POLYGON', 'MULTIPOLYGON') then
    raise exception 'Geometry must be Polygon or MultiPolygon, got %', GeometryType(v_geom);
  end if;

  if not ST_IsValid(v_geom) then
    -- ST_MakeValid peut rendre une GEOMETRYCOLLECTION (anneau effondré gardé
    -- en ligne) : on ne garde que les polygones (sql/247).
    v_geom := ST_CollectionExtract(ST_MakeValid(v_geom), 3);
    if v_geom is null or ST_IsEmpty(v_geom) then
      raise exception 'Géométrie sans surface après réparation';
    end if;
  end if;

  insert into public.custom_geo_zones (
    name, description, org_id, created_by, source_type, source_metadata, geometry
  ) values (
    p_name, p_description, p_org_id, auth.uid(), p_source_type, p_source_metadata, ST_Multi(v_geom)
  )
  returning id into v_id;

  return v_id;
end $function$;

create or replace function public.create_custom_geo_zone_with_subzones(
  p_name text,
  p_description text,
  p_org_id uuid,
  p_source_type text,
  p_source_metadata jsonb,
  p_geometry_geojson text,
  p_subzones jsonb default null::jsonb
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_zone_id uuid;
  v_geom geometry;
  v_subzone jsonb;
  v_subzone_geom geometry;
  v_idx integer := 0;
begin
  -- Si pas de sous-zones : comportement legacy
  if p_subzones is null or jsonb_array_length(p_subzones) = 0 then
    return public.create_custom_geo_zone(
      p_name, p_description, p_org_id, p_source_type, p_source_metadata, p_geometry_geojson
    );
  end if;

  -- Sinon : insertion zone parente + N sous-zones
  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geometry_geojson), 4326);
  if GeometryType(v_geom) not in ('POLYGON', 'MULTIPOLYGON') then
    raise exception 'Parent geometry must be Polygon or MultiPolygon, got %', GeometryType(v_geom);
  end if;
  if not ST_IsValid(v_geom) then
    v_geom := ST_CollectionExtract(ST_MakeValid(v_geom), 3);
    if v_geom is null or ST_IsEmpty(v_geom) then
      raise exception 'Géométrie sans surface après réparation';
    end if;
  end if;

  insert into public.custom_geo_zones (
    name, description, org_id, created_by, source_type, source_metadata, geometry
  ) values (
    p_name, p_description, p_org_id, auth.uid(), p_source_type, p_source_metadata, ST_Multi(v_geom)
  )
  returning id into v_zone_id;

  -- Insertion des sous-zones
  for v_subzone in select * from jsonb_array_elements(p_subzones)
  loop
    v_subzone_geom := ST_SetSRID(ST_GeomFromGeoJSON(v_subzone->>'geometry_geojson'), 4326);
    if GeometryType(v_subzone_geom) not in ('POLYGON', 'MULTIPOLYGON') then
      raise exception 'Subzone "%" geometry must be Polygon/MultiPolygon, got %',
        v_subzone->>'name', GeometryType(v_subzone_geom);
    end if;
    if not ST_IsValid(v_subzone_geom) then
      v_subzone_geom := ST_CollectionExtract(ST_MakeValid(v_subzone_geom), 3);
      if v_subzone_geom is null or ST_IsEmpty(v_subzone_geom) then
        raise exception 'Sous-zone « % » sans surface après réparation', v_subzone->>'name';
      end if;
    end if;

    insert into public.custom_geo_zone_subzones (
      zone_id, name, source_ref, geometry, ordering, default_multiplier
    ) values (
      v_zone_id,
      v_subzone->>'name',
      v_subzone->>'source_ref',
      ST_Multi(v_subzone_geom),
      v_idx,
      coalesce((v_subzone->>'default_multiplier')::numeric, 1.0)
    );
    v_idx := v_idx + 1;
  end loop;

  return v_zone_id;
end $function$;

notify pgrst, 'reload schema';

commit;
