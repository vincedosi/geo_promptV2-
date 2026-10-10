-- 246 — Voronoï par catégorie : les 4 653 cellules des lycées, plus 1 000 (2026-10-10)
--
-- ── Le défaut ────────────────────────────────────────────────────────────────
--
-- `get_voronoi_by_category` (sql/164) est `RETURNS SETOF json` : PostgREST la
-- coupe sans erreur à `db-max-rows`, qui vaut 1 000 sur le seul environnement
-- qui existe (supabase/config.toml, `PGRST_DB_MAX_ROWS=1000`). Le 5 000 qu'on
-- lui prêtait était le réglage du projet hébergé, supprimé le 2026-09-21.
--
-- Mesuré le 2026-10-10, catégorie `lycee`, France métropolitaine :
--   psql        select count(*) from get_voronoi_by_category('lycee', true)  -> 4 653
--   PostgREST   POST /rest/v1/rpc/get_voronoi_by_category                    -> 1 000
-- L'outil copilote `voronoi_analysis` (lib/chat/tools/voronoi.ts) dessinait
-- donc 1 000 zones de chalandise sur 4 653, et annonçait « 1 000 polygones »
-- comme si c'était le compte.
--
-- ── Le correctif : patron jumelle + enveloppe (sql/154, 168-170, 243) ───────
--
-- `get_voronoi_by_category_jsonb` porte le corps de sql/164 AU CARACTÈRE PRÈS
-- (valeurs canoniques résolues une fois, `geom <->`, CTE MATERIALIZED), et rend
-- `{ features, tronque }` — un scalaire jsonb, que PostgREST ne coupe pas.
--
-- Borne : `p_limite` (défaut 5 000, le `LIMIT 5000` de sql/164). On lit
-- `p_limite + 1` cellules et `tronque` le DIT, au lieu d'une borne muette.
--
-- `get_voronoi_by_category(…)` devient une ENVELOPPE MINCE de la jumelle :
-- un seul corps, deux formes de retour, dérive impossible. Plus aucun code de
-- l'application ne l'appelle. Jamais de DROP.
--
-- Droits : la jumelle est réservée à service_role (l'outil passe par
-- `createAdminClient`). L'enveloppe (SECURITY INVOKER) est alignée sur elle :
-- la laisser ouverte à anon/authenticated rendrait « permission denied » sur
-- la jumelle (relecture T-serveur 2, point mineur 4).
--
-- Rejouable. Verrouillé par tests/integration/voronoi-jsonb.test.ts.

begin;

create or replace function public.get_voronoi_by_category_jsonb(
  cat_name            text,
  metropolitaine      boolean default true,
  filtre_ville        text default null::text,
  filtre_region       text default null::text,
  filtre_departement  text default null::text,
  p_limite            integer default 5000
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_catalog'
as $function$
declare
  pts_geom    geometry;
  n_points    integer;
  clip_geom   geometry;
  has_filtre  boolean;
  cats        text[];
  resultat    jsonb;
begin
  has_filtre := (filtre_ville is not null or filtre_region is not null or filtre_departement is not null);

  -- 0. Résoudre UNE fois les valeurs canoniques de catégorie (sql/164).
  select array_agg(distinct categorie) into cats
  from poi_france
  where categorie ilike cat_name;

  if cats is null or array_length(cats, 1) is null then
    raise notice '[voronoi] % : aucune categorie correspondante', cat_name;
    return jsonb_build_object('features', '[]'::jsonb, 'tronque', false);
  end if;

  -- 1. Collecter les points avec ST_SnapToGrid (stabilité zones denses)
  select
    st_collect(
      st_snaptogrid(st_setsrid(st_makepoint(lng::float8, lat::float8), 4326), 0.0001)
    ),
    count(*)
  into pts_geom, n_points
  from poi_france
  where categorie = any(cats)
    and lat between -90  and 90
    and lng between -180 and 180
    and (filtre_ville        is null or ville        ilike '%' || filtre_ville       || '%')
    and (filtre_region       is null or region       ilike '%' || filtre_region      || '%')
    and (filtre_departement  is null or departement  ilike '%' || filtre_departement || '%'
                                     or code_departement = filtre_departement)
    and (has_filtre or not metropolitaine
         or (lat between 41.0 and 52.0 and lng between -6.0 and 10.0));

  if pts_geom is null or n_points < 2 then
    raise notice '[voronoi] % : % point(s)', cat_name, coalesce(n_points, 0);
    return jsonb_build_object('features', '[]'::jsonb, 'tronque', false);
  end if;

  -- 2. Polygone de clipping
  if metropolitaine then
    select st_union(geom) into clip_geom from france_borders where nom = 'france_metropolitaine';
    if clip_geom is null then
      clip_geom := st_makeenvelope(-6.0, 41.0, 10.0, 52.0, 4326);
      raise notice '[voronoi] WARN: france_borders vide, fallback bbox';
    end if;
  else
    clip_geom := st_expand(st_envelope(pts_geom), 0.5);
  end if;

  -- 3. Voronoï -> ST_Dump -> ST_Intersection(clip) -> plus proche POI par cellule
  with
  voronoi_raw as (
    select (st_dump(
      st_voronoipolygons(pts_geom, 0.0, clip_geom)
    )).geom as raw_poly
  ),
  -- MATERIALIZED n'est pas décoratif (sql/164) : sans lui, `ST_Intersection`
  -- est recalculée à chaque référence à `vc.poly`.
  voronoi_clipped as materialized (
    select st_intersection(raw_poly, clip_geom) as poly
    from voronoi_raw
    where
      st_isvalid(raw_poly)
      and raw_poly && clip_geom
  ),
  -- Lue deux fois (les cellules, puis leur compte) : MATERIALIZED pour ne la
  -- calculer qu'une. `p_limite + 1` : la ligne de trop est ce qui dit `tronque`.
  cellules as materialized (
    select jsonb_build_object(
      'type',     'Feature',
      'geometry', st_asgeojson(vc.poly)::jsonb,
      'properties', jsonb_build_object(
        'id',        p.poi_id,
        'nom',       p.nom,
        'categorie', p.cat,
        'adresse',   p.adresse,
        'ville',     p.poi_ville,
        'lat',       p.poi_lat,
        'lng',       p.poi_lng
      )
    ) as f
    from voronoi_clipped vc
    cross join lateral (
      select
        id::text        as poi_id,
        nom,
        categorie       as cat,
        adresse,
        ville           as poi_ville,
        lat::float8     as poi_lat,
        lng::float8     as poi_lng
      from poi_france
      where categorie = any(cats)
        and lat between -90  and 90
        and lng between -180 and 180
        and (filtre_ville       is null or ville       ilike '%' || filtre_ville      || '%')
        and (filtre_region      is null or region      ilike '%' || filtre_region     || '%')
        and (filtre_departement is null or departement ilike '%' || filtre_departement || '%'
                                        or code_departement = filtre_departement)
        and (has_filtre or not metropolitaine
             or (lat between 41.0 and 52.0 and lng between -6.0 and 10.0))
      order by geom <-> st_centroid(vc.poly)
      limit 1
    ) p
    where not st_isempty(vc.poly)
    limit p_limite + 1
  )
  select jsonb_build_object(
    'features', coalesce(
      (select jsonb_agg(c.f) from (select f from cellules limit p_limite) c),
      '[]'::jsonb),
    'tronque', (select count(*) from cellules) > p_limite
  )
  into resultat;

  raise notice '[voronoi] % -> % cellules', cat_name, n_points;
  return resultat;
end;
$function$;

comment on function public.get_voronoi_by_category_jsonb(text, boolean, text, text, text, integer) is
  'Voronoi par categorie de POI — jumelle jsonb de get_voronoi_by_category (sql/164), qui porte desormais le corps. RETURNS jsonb { features, tronque } : PostgREST coupe a db-max-rows (1 000 en local) toute RPC SETOF ; mesure 2026-10-10 lycee : 4 653 cellules en base, 1 000 via PostgREST. Borne p_limite (defaut 5 000), tronque la dit. sql/246.';

revoke all on function public.get_voronoi_by_category_jsonb(text, boolean, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.get_voronoi_by_category_jsonb(text, boolean, text, text, text, integer) to service_role;

-- Enveloppe mince : même signature, même forme de retour qu'en sql/164, et la
-- même borne (5 000 cellules).
create or replace function public.get_voronoi_by_category(
  cat_name            text,
  metropolitaine      boolean default true,
  filtre_ville        text default null::text,
  filtre_region       text default null::text,
  filtre_departement  text default null::text
)
returns setof json
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select f::json
  from jsonb_array_elements(
         public.get_voronoi_by_category_jsonb(
           cat_name, metropolitaine, filtre_ville, filtre_region, filtre_departement, 5000
         ) -> 'features') f;
$function$;

comment on function public.get_voronoi_by_category(text, boolean, text, text, text) is
  'Enveloppe MINCE de get_voronoi_by_category_jsonb depuis sql/246 : un seul corps, deux formes de retour. RETURNS SETOF json, donc coupee a db-max-rows (1 000 en local) par PostgREST : passer par la jumelle _jsonb. Plus appelee par l application.';

revoke all on function public.get_voronoi_by_category(text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.get_voronoi_by_category(text, boolean, text, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
