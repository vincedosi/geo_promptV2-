-- 285 — zone_rayon_poi : « Autour des POI » sur toute la France métropolitaine (retours du 26/10, T2)
--
-- CREATE OR REPLACE du corps de sql/254, même signature, mêmes droits. Une seule branche neuve, AVANT
-- `resoudre_perimetre` (qui refuse tout périmètre `france`) : `('france', 'METRO')`. `('france', 'FR')` reste refusé
-- (`perimetre_national_refuse`), comme tout périmètre local garde son comportement d'avant, à l'octet.
--
-- ── LA BRANCHE MÉTROPOLE ───────────────────────────────────────────────────────────────────────────────────────────
--
--   • Les POI sont lus par CATÉGORIE D'ABORD (CTE MATERIALIZED, index `idx_poi_france_categorie`), puis bornés par
--     BBOX_METRO sur lat/lng (`lib/carte/filtre.ts`) — la même règle que la portée `metro` de /api/map/pois (T1) :
--     95 CIRFA comptés = 95 CIRFA affichés. Mesures du pré-vol (CIRFA, 20 km) : par la géométrie d'abord
--     (`geom && per`), l'index GiST balayait tous les POI de la métropole, 306 000 à 357 000 buffers et 1 à 11,8 s ;
--     par la catégorie d'abord, 53 ms et ≈ 160 buffers. Les points ne sont PAS filtrés par `ST_Intersects` avec le
--     contour des régions : il est simplifié, et le CIRFA de Nice tombe à 68 m de son trait de côte — il aurait été
--     perdu, sans cercle.
--   • Le périmètre qui DÉCOUPE les cercles est l'union des `ref_regions` qui croisent BBOX_METRO (les 13 régions de
--     métropole, ≈ 548 000 km²) : un cercle ne déborde ni en mer ni à l'étranger.
--   • Plafond : capacité SYNCHRONE mesurée, pas une borne produit (réponses de Vincent du 26/10, Q-1 : « on limite
--     pas »). `CAPACITE_SYNCHRONE_POI_RAYON` = 10 000 (`lib/zones/recette.ts`), refaite ici en dur : `least(p_max_poi,
--     10000)`, et un `p_max_poi` au-delà de 10 000 lève 22023 — l'appelant ne peut pas la contourner. Mesures du
--     26/10 (base locale, cache chaud, union + découpe + GeoJSON) : lycées 5 299 POI → 0,4 s à 20 km, 2,2 s et
--     3,7 Mo à 100 m ; 10 000 sites ICPE → 1,2 s à 50 km, 9,8 s et 7,7 Mo à 100 m ; 97 133 sites ICPE → 47 s et
--     70 Mo à 100 m (au-delà de ce qu'on sert en direct sous les 60 s de Kong). Au-delà : refus
--     `trop_de_poi_metropole`, que l'écran dit « tâche de fond, lot « calculs longs » ».
--   • Les périmètres locaux gardent leur plafond de 5 000 POI (sql/254).
--
-- Rend jsonb (une géométrie, rien à tronquer). Droits : service_role. Rejouable. Aucun DROP.

begin;

create or replace function public.zone_rayon_poi(
  p_categorie text, p_rayon_m integer, p_perimetre_type text, p_perimetre_code text,
  p_org_id uuid, p_sources uuid[], p_max_poi integer default 5000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_metro boolean := p_perimetre_type = 'france' and p_perimetre_code = 'METRO';
  v_max integer;
  v_per geometry;
  v_refus text;
  v_pts geometry[];
  v_n integer;
  v_brut geometry;
  v_g geometry;
begin
  if p_rayon_m is null or p_rayon_m < 100 or p_rayon_m > 50000 then
    raise exception 'rayon hors bornes (100 m a 50 km) : %', p_rayon_m using errcode = '22023';
  end if;
  if p_max_poi is null or p_max_poi < 1 or p_max_poi > (case when v_metro then 10000 else 5000 end) then
    raise exception 'plafond de POI hors bornes (1 a %) : %', case when v_metro then '10 000' else '5 000' end, p_max_poi
      using errcode = '22023';
  end if;

  if v_metro then
    v_max := least(p_max_poi, 10000);
    select ST_Multi(ST_Union(coalesce(r.geom_perimetre, r.geom))) into v_per
      from public.ref_regions r
     where coalesce(r.geom_perimetre, r.geom) && ST_MakeEnvelope(-5.5, 41.2, 9.8, 51.2, 4326);
    if v_per is null or ST_IsEmpty(v_per) then
      return jsonb_build_object('refus', 'perimetre_inconnu');
    end if;

    with cat as materialized (
      select p.geom, p.lat, p.lng
        from public.poi_france p
       where p.categorie = p_categorie
         and (p.data_source_id is null or p.data_source_id = any (coalesce(p_sources, '{}'::uuid[])))
    )
    select array_agg(s.geom) into v_pts
      from (select c.geom from cat c
             where c.lat between 41.2 and 51.2 and c.lng between -5.5 and 9.8
             limit v_max + 1) s;
    v_n := coalesce(cardinality(v_pts), 0);

    if v_n > v_max then
      return jsonb_build_object('refus', 'trop_de_poi_metropole', 'plafond', v_max);
    end if;
  else
    v_max := p_max_poi;
    select r.g, r.refus into v_per, v_refus
      from public.resoudre_perimetre(p_perimetre_type, p_perimetre_code, p_org_id, 100000,
                                     array['region', 'departement', 'commune', 'cp', 'zone']) r;
    if v_refus is not null then
      return jsonb_build_object('refus', v_refus);
    end if;

    select array_agg(s.geom) into v_pts
      from (select p.geom
              from public.poi_france p
             where p.categorie = p_categorie
               and (p.data_source_id is null or p.data_source_id = any (coalesce(p_sources, '{}'::uuid[])))
               and p.geom && v_per
               and ST_Intersects(p.geom, v_per)
             limit v_max + 1) s;
    v_n := coalesce(cardinality(v_pts), 0);

    if v_n > v_max then
      return jsonb_build_object('refus', 'trop_de_poi', 'plafond', v_max);
    end if;
  end if;

  if v_n = 0 then
    return jsonb_build_object('vide', true, 'compte', 0, 'geometry', null, 'surface_km2', 0, 'part_retenue', 0);
  end if;

  select ST_Union(ST_Buffer(g::geography, p_rayon_m)::geometry) into v_brut from unnest(v_pts) as g;
  v_g := ST_Multi(ST_CollectionExtract(ST_Intersection(v_brut, v_per), 3));

  return jsonb_build_object(
    'vide', v_g is null or ST_IsEmpty(v_g),
    'compte', v_n,
    'geometry', case when v_g is null or ST_IsEmpty(v_g) then null else ST_AsGeoJSON(v_g)::jsonb end,
    'surface_km2', case when v_g is null or ST_IsEmpty(v_g) then 0
                        else round((ST_Area(v_g::geography) / 1e6)::numeric, 2) end,
    'part_retenue', case when v_g is null or ST_IsEmpty(v_g) then 0
                         else round((ST_Area(v_g::geography) / nullif(ST_Area(v_brut::geography), 0))::numeric, 3) end
  );
end
$fn$;

revoke all on function public.zone_rayon_poi(text, integer, text, text, uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.zone_rayon_poi(text, integer, text, text, uuid, uuid[], integer) to service_role;

commit;
