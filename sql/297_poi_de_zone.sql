-- sql/297 — Les POI d'une catégorie situés dans une zone enregistrée : la bataille V2 sur la zone analysée (④ finitions,
-- T3 ; plan 2026-10-30, arbitrage A-6, écart E4 ; spec § 16.1 : « isochrones comparées » parmi les analyses sur les
-- zones).
--
-- `poi_de_zone(p_zone, p_org, p_categorie, p_sources, p_limite)` → `{ pois: [...], tronque }` | `{ refus }`.
--   • La zone est DE L'ESPACE (`org_id = p_org`, l'espace de la session) : sinon `zone_introuvable` (absente ou
--     ailleurs : même réponse). Une zone PAYS (recette `pays`, sql/296) : refus `zone_pays` — la bataille nationale se
--     lance depuis ① (France métropolitaine), avec sa borne de lecture.
--   • CATÉGORIE D'ABORD (CTE `MATERIALIZED`, index `idx_poi_france_categorie`), PUIS `&&` + `ST_Intersects` avec la
--     forme : le patron de sql/285. Par la géométrie d'abord, l'index GiST balaie tous les POI de la zone, toutes
--     catégories (arrêts de transport, sites ICPE) — mesuré ci-dessous : 1,86 s et 147 000 accès sur la zone composite.
--   • Visibilité : la règle de la route V2 (`filtrerParSourcesVisibles` sans référentiels) — `data_source_id = any
--     (p_sources)`, les sources que l'espace voit ; un POI sans source n'y est pas (au 30/10, aucun CIRFA ni lycée n'en
--     est dépourvu). La bataille sur ① et sur une zone lisent donc le même univers de POI.
--   • La catégorie est comparée en minuscules : la route lisait `ilike(categorie, category)` (sans joker), et toutes les
--     catégories de `poi_categories` sont en minuscules (9 sur 9 le 30/10).
--   • `p_limite` (1 à 5 000) : la RPC lit `p_limite + 1` lignes et rend `tronque` — la route passe
--     `PLAFOND_LECTURE_POI` (500) et refuse une lecture tronquée au lieu de batailler sur un début. `RETURNS jsonb` :
--     PostgREST ne coupe rien (db-max-rows = 1 000).
--
-- Mesuré le 30/10 (EXPLAIN (ANALYZE, BUFFERS) de l'appel, base locale, 2e passe ; « accès » = hit + read ; le plan
-- intérieur relevé par auto_explain) :
--   zone composite 13 001 km², `cirfa`               4,5 ms · 137 accès
--   zone composite, `lycee` (5 584 lus, 500 + 1 gardés, `tronque`)
--                                                    68-90 ms · 438-1 408 accès (dont la forme de 23 000 sommets) ;
--                                                    intérieur : Bitmap Heap Scan catégorie ∧ source, 57 ms, 336 accès
--   département 13, `lycee`                          5,1 ms · 340 accès
--   (cibles du plan : < 100 ms, < 2 000 accès.) Sans MATERIALIZED, `lycee` sur la composite : 1 864 ms · 111 050 hit +
--   36 082 lus — le piège GiST des retours du 26/10, évité.
--
-- Droits : service_role. Rejouable (`create or replace`, aucun `drop`).

create or replace function public.poi_de_zone(
  p_zone uuid, p_org uuid, p_categorie text, p_sources uuid[], p_limite integer default 500
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_geom    geometry;
  v_recette jsonb;
  v_pois    jsonb;
  v_n       integer;
begin
  if p_limite is null or p_limite < 1 or p_limite > 5000 then
    raise exception 'limite de POI hors bornes (1 a 5 000) : %', p_limite using errcode = '22023';
  end if;

  -- Absente OU d'un autre espace : la même réponse, on ne révèle pas qu'elle existe ailleurs.
  select g.geometry, g.recette into v_geom, v_recette
    from public.custom_geo_zones g where g.id = p_zone and g.org_id = p_org;
  if v_geom is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;
  if v_recette->>'type' = 'pays' then
    return jsonb_build_object('refus', 'zone_pays');
  end if;

  with cat as materialized (
    select p.id, p.nom, p.lat, p.lng, p.categorie, p.adresse, p.ville, p.geom
      from public.poi_france p
     where p.categorie = lower(p_categorie)
       and p.data_source_id = any (coalesce(p_sources, '{}'::uuid[]))
  ), dedans as (
    select c.id, c.nom, c.lat, c.lng, c.categorie, c.adresse, c.ville
      from cat c
     where c.geom && v_geom and ST_Intersects(c.geom, v_geom)
     order by c.id
     limit p_limite + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'nom', d.nom, 'lat', d.lat, 'lng', d.lng, 'categorie', d.categorie,
           'adresse', d.adresse, 'ville', d.ville) order by d.id), '[]'::jsonb),
         count(*)
    into v_pois, v_n
    from dedans d;

  if v_n > p_limite then
    return jsonb_build_object('pois', (select jsonb_agg(e) from (
                                        select e from jsonb_array_elements(v_pois) with ordinality t(e, n)
                                         where n <= p_limite order by n) s),
                              'tronque', true);
  end if;
  return jsonb_build_object('pois', v_pois, 'tronque', false);
end
$fn$;

comment on function public.poi_de_zone(uuid, uuid, text, uuid[], integer) is
  'POI d''une categorie visibles de l''espace (data_source_id = any(p_sources)) situes dans une zone de l''espace, '
  'categorie d''abord (CTE MATERIALIZED). { pois, tronque } (lit p_limite + 1) | { refus: zone_introuvable, '
  'zone_pays }. Bataille V2 sur une zone. sql/297 (finitions de l''analyse, T3).';

revoke all on function public.poi_de_zone(uuid, uuid, text, uuid[], integer) from public, anon, authenticated;
grant execute on function public.poi_de_zone(uuid, uuid, text, uuid[], integer) to service_role;

notify pgrst, 'reload schema';
