-- ============================================================
-- 083 — Choroplèthe météo : polygones simplifiés des zones admin
-- Date : 2026-07-02
-- Appliquée via MCP Supabase (migration : meteo_zone_polygons)
--
-- Remplace les bulles météo aux centroïdes (meteo-circles) par une vraie
-- choroplèthe : /api/meteo-geo/zones sert ces polygones, la carte les joint
-- aux valeurs Open-Meteo par code INSEE et les colore (meteo-fill/outline).
-- Granularité au choix de l'utilisateur (MeteoGeoPanel, du plus fin au plus large) :
--   cp 0.002° (~200 m, ~6 200 zones, ~3.8 MB, ~795 ms) ·
--   département 0.005° (~500 m, ~492 KB) · région 0.01° (~1 km, ~284 KB)
-- Cache navigateur 1 j + CDN 1 semaine.
-- (migrations MCP : meteo_zone_polygons + meteo_zone_polygons_cp)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_zone_polygons(p_scale text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF p_scale = 'region' THEN
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'properties', jsonb_build_object('code', code_region::text, 'nom', nom_region::text),
        'geometry', ST_AsGeoJSON(ST_Simplify(geom, 0.01), 4)::jsonb
      )), '[]'::jsonb)
    ) INTO result
    FROM ref_regions
    WHERE geom IS NOT NULL AND NOT ST_IsEmpty(ST_Simplify(geom, 0.01));
  ELSIF p_scale = 'departement' THEN
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'properties', jsonb_build_object('code', code_dept::text, 'nom', nom_dept::text),
        'geometry', ST_AsGeoJSON(ST_Simplify(geom, 0.005), 4)::jsonb
      )), '[]'::jsonb)
    ) INTO result
    FROM ref_departements
    WHERE geom IS NOT NULL AND NOT ST_IsEmpty(ST_Simplify(geom, 0.005));
  ELSIF p_scale = 'cp' THEN
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'properties', jsonb_build_object('code', code_postal::text, 'nom', nom_principal::text),
        'geometry', ST_AsGeoJSON(ST_Simplify(geom, 0.002), 4)::jsonb
      )), '[]'::jsonb)
    ) INTO result
    FROM ref_codes_postaux
    WHERE geom IS NOT NULL AND NOT ST_IsEmpty(ST_Simplify(geom, 0.002));
  ELSE
    RAISE EXCEPTION 'Invalid scale: %. Expected region, departement or cp.', p_scale;
  END IF;
  RETURN result;
END;
$function$;
