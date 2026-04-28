-- get_battle_geometry lisait isochrones_cache.geom (toujours NULL).
-- Les rows battle_full__* stockent les polygones dans
-- geojson->'battleGeoJSON' (FeatureCollection de Polygon/MultiPolygon).
-- On extrait + union depuis ce JSONB ; fallback sur geom si peuplé un jour.
-- Bug : capture custom-geo échouait avec "Toutes les géométries ont échoué"
-- dès que la couche battle isochrone faisait partie des layers à capturer.
CREATE OR REPLACE FUNCTION public.get_battle_geometry(p_cache_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_geom geometry;
  v_count int;
  v_categories text[];
  v_minutes int[];
  v_modes text[];
BEGIN
  IF p_cache_keys IS NULL OR array_length(p_cache_keys, 1) = 0 THEN
    RETURN jsonb_build_object('geometry', NULL, 'metadata', '{}'::jsonb);
  END IF;

  WITH src AS (
    SELECT
      ic.cache_key,
      ic.categorie,
      ic.minutes,
      ic.mode,
      ic.geom AS direct_geom,
      ic.geojson->'battleGeoJSON'->'features' AS feats
    FROM isochrones_cache ic
    WHERE ic.cache_key = ANY(p_cache_keys)
  ),
  feat_geoms AS (
    SELECT
      ST_GeomFromGeoJSON((f->'geometry')::text) AS g
    FROM src,
         LATERAL jsonb_array_elements(coalesce(src.feats, '[]'::jsonb)) AS f
    WHERE f ? 'geometry'
  ),
  all_geoms AS (
    SELECT g FROM feat_geoms WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)
    UNION ALL
    SELECT direct_geom FROM src
    WHERE direct_geom IS NOT NULL AND NOT ST_IsEmpty(direct_geom)
  )
  SELECT ST_Union(g) INTO v_geom FROM all_geoms;

  SELECT COUNT(*),
         array_agg(DISTINCT categorie) FILTER (WHERE categorie IS NOT NULL),
         array_agg(DISTINCT minutes)   FILTER (WHERE minutes   IS NOT NULL),
         array_agg(DISTINCT mode)      FILTER (WHERE mode      IS NOT NULL)
  INTO v_count, v_categories, v_minutes, v_modes
  FROM isochrones_cache
  WHERE cache_key = ANY(p_cache_keys);

  IF v_geom IS NULL OR ST_IsEmpty(v_geom) THEN
    RETURN jsonb_build_object('geometry', NULL, 'metadata', '{}'::jsonb);
  END IF;

  IF GeometryType(v_geom) = 'POLYGON' THEN v_geom := ST_Multi(v_geom); END IF;

  RETURN jsonb_build_object(
    'geometry', ST_AsGeoJSON(v_geom)::jsonb,
    'metadata', jsonb_build_object(
      'cache_keys', p_cache_keys,
      'iso_count',  v_count,
      'categories', v_categories,
      'minutes',    v_minutes,
      'modes',      v_modes
    )
  );
END $function$;
