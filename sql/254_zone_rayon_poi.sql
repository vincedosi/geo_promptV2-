-- 254 — Zone : rayon autour de tous les POI d'un type, dans le périmètre (2026-10-14)
--
-- Spec : carte-en-parcours § 16.3 ; arbitrages A-4 (plafond 5 000 POI, national refusé) et L3-1 (zone découpée par le
-- périmètre : le périmètre BORNE, une zone qui le déborderait ne serait plus bornée au recalcul).
-- zone_rayon (sql/155) ne fait qu'UN point ; ceci fait tous les POI d'une catégorie.
--
-- Visibilité : la règle de source_visible (sql/234) — un POI sans source est commun, sinon sa source doit être dans
-- p_sources (getOrgSourceIds en vue espace, côté route).
-- Plafond : on lit p_max_poi + 1 points ; au-delà, refus (jamais une zone partielle).
-- Buffer en geography (rayon en MÈTRES sur la sphère), comme zone_rayon.
-- Mesuré le 2026-10-14 (EXPLAIN ANALYZE local) : lycées × 5 km × région 84 → 0,8 s, 834 buffers ;
-- sites ICPE × 2 km × région 84 plafonnés à 5 000 → 2,0 s, 31 900 buffers.
-- Rend jsonb (une géométrie, pas des lignes : rien à tronquer). Droits : service_role. Rejouable.

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
  if p_max_poi is null or p_max_poi < 1 or p_max_poi > 5000 then
    raise exception 'plafond de POI hors bornes (1 a 5 000) : %', p_max_poi using errcode = '22023';
  end if;

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
           limit p_max_poi + 1) s;
  v_n := coalesce(cardinality(v_pts), 0);

  if v_n > p_max_poi then
    return jsonb_build_object('refus', 'trop_de_poi', 'plafond', p_max_poi);
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
