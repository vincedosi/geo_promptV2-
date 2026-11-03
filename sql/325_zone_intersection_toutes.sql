-- ============================================================================
-- sql/325_zone_intersection_toutes.sql — C20 : l'intersection d'une recette `combinaison` sur 2 à 20 zones (plan de
-- corrections du découpage des zones, lot 3, 2026-11-03).
--
-- LE CONSTAT. `lib/zones/recette-schema.ts` et l'exécuteur bornaient l'intersection à DEUX zones, l'union et la
-- différence allant de 2 à 20. La raison était dans le SQL : `zone_intersection` (sql/151) ACCEPTE N opérandes, mais
-- calcule « première ∩ union(autres) », A ∩ (B ∪ C), ce qui n'est l'intersection que pour deux zones. Ce sens est
-- VOULU par la route React `/api/custom-geo/source/intersection` (« ma zone de base, restreinte à ce que couvrent ces
-- zones-là ») : la fonction est GARDÉE telle quelle.
--
-- LE CORRECTIF. Une fonction NEUVE, `zone_intersection_toutes(p_zone_ids uuid[])`, la vraie intersection de TOUTES
-- les zones (A ∩ B ∩ C …), même forme de retour que `zone_intersection` (`{ vide, geometry, surface_km2 }`), lue par
-- l'exécuteur de recette (lib/zones/executer-recette.ts). Deux zones : même résultat que `zone_intersection`.
--   - opérandes du plus petit au plus grand (aire de la boîte englobante) : le résultat partiel ne fait que rétrécir,
--     la plus petite d'abord borne le coût des ST_Intersection suivantes ; boîtes disjointes ⇒ vide sans calcul ;
--   - ST_MakeValid sur chaque opérande, comme sql/151 ;
--   - 2 à 20 identifiants DISTINCTS, tous trouvés, sinon 22023 / P0002 (l'exécuteur vérifie avant ; ici on lève
--     plutôt que de rendre l'intersection d'un sous-ensemble — une zone oubliée ÉLARGIRAIT le résultat).
--   - aucun filtre d'organisation (fonction de géométrie, comme sql/151) : le contrôle est la charge de l'appelant.
--
-- Mesuré le 03/11/2026, base locale (EXPLAIN (ANALYZE, BUFFERS), cache chaud) — voir le compte rendu C20.
--
-- Rejouable (`create or replace`), aucun DROP. Droits : service_role. Appliquer par `psql -1`.
-- ============================================================================

create or replace function public.zone_intersection_toutes(p_zone_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_n integer := coalesce(cardinality(p_zone_ids), 0);
  v_trouvees integer := 0;
  v_z geometry;
  v_g geometry;
  v_vide boolean := false;
begin
  if v_n < 2 or v_n > 20 then
    raise exception 'intersection : 2 a 20 zones (recu %)', v_n using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_zone_ids) x) <> v_n then
    raise exception 'intersection : une zone figure deux fois' using errcode = '22023';
  end if;

  for v_z in
    select ST_MakeValid(z.geometry) from public.custom_geo_zones z
     where z.id = any (p_zone_ids)
     order by ST_Area(Box2D(z.geometry)::geometry), z.id   -- z.id : ordre total, résultat stable (round 1)
  loop
    v_trouvees := v_trouvees + 1;
    if v_vide then
      continue;
    elsif v_g is null then
      v_g := v_z;
    elsif not (v_g && v_z) then
      v_vide := true;
    else
      v_g := ST_CollectionExtract(ST_Intersection(v_g, v_z), 3);
      v_vide := v_g is null or ST_IsEmpty(v_g);
    end if;
  end loop;

  if v_trouvees <> v_n then
    raise exception 'intersection : zone introuvable (% sur %)', v_trouvees, v_n using errcode = 'P0002';
  end if;

  v_g := case when v_vide or v_g is null or ST_IsEmpty(v_g) then null else ST_Multi(v_g) end;
  return jsonb_build_object(
    'vide', v_g is null,
    'geometry', case when v_g is null then null else ST_AsGeoJSON(v_g)::jsonb end,
    'surface_km2', case when v_g is null then 0 else round((ST_Area(v_g::geography) / 1e6)::numeric, 2) end
  );
end
$fn$;

comment on function public.zone_intersection_toutes(uuid[]) is
  'C20 (sql/325) : vraie intersection de 2 a 20 zones custom (A inter B inter C), operandes de la plus petite boite a la plus grande, ST_MakeValid, vide=true plutot que NULL. zone_intersection (sql/151, A inter union des autres) est gardee pour la route React. Aucun filtre d organisation : charge de l appelant.';

revoke all on function public.zone_intersection_toutes(uuid[]) from public, anon, authenticated;
grant execute on function public.zone_intersection_toutes(uuid[]) to service_role;
