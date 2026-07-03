-- ============================================================
-- 089 — get_zone_items_export : matière première des exports DSP pondérés
-- ============================================================
-- Appliquée le 2026-07-03 via MCP Supabase (migration `zone_items_export`).
--
-- Pour chaque item d'une zone battle (source_metadata
-- contributing_layers[*].metadata.battle_features, repli pois[*].geometry) :
--   - cps       : codes postaux de la zone affectés à l'item (centroïde
--                 ref_codes_postaux contenu dans l'item, sinon le plus proche
--                 — aucun CP orphelin)
--   - lat/lng/radius_km : cercle circonscrit (ciblage rayon TikTok, même
--                 conversion que get_zone_radius_targets, clamp 1-50 km)
-- Renvoie NULL si la zone n'est pas décomposable.
-- Vérifié sur CIRFA BRETAGNE : 18+52+32+30 = 132 CP (total exact de la zone).
-- Consommée par /api/custom-geo/[id]/export (formats bidding_script et
-- tiktok_geo avec ?weights=), via le plan média (ZoneMediaPlanPanel).

CREATE OR REPLACE FUNCTION public.get_zone_items_export(
  p_zone_id uuid,
  p_caller_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_meta jsonb;
  v_org_id uuid;
  v_caller uuid;
  v_result jsonb;
BEGIN
  SELECT source_metadata, org_id INTO v_meta, v_org_id
  FROM public.custom_geo_zones
  WHERE id = p_zone_id;

  IF v_meta IS NULL THEN
    RAISE EXCEPTION 'Zone % not found', p_zone_id;
  END IF;

  v_caller := COALESCE(p_caller_user_id, auth.uid());
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = v_caller AND organization_id = v_org_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_caller AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Access denied to zone %', p_zone_id;
  END IF;

  WITH raw_items AS (
    SELECT
      f->'geometry' AS gj,
      COALESCE(f->'properties'->>'id', f->'properties'->>'poi_id') AS poi_id,
      COALESCE(f->'properties'->>'nom', f->'properties'->>'poi_name', 'Item') AS poi_name
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(v_meta->'contributing_layers') = 'array'
                THEN v_meta->'contributing_layers' ELSE '[]'::jsonb END) AS l,
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(l->'metadata'->'battle_features') = 'array'
                THEN l->'metadata'->'battle_features' ELSE '[]'::jsonb END) AS f
    WHERE f ? 'geometry'
    UNION ALL
    SELECT p->'geometry', p->>'poi_id', COALESCE(p->>'poi_name', 'Item')
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(v_meta->'pois') = 'array'
                THEN v_meta->'pois' ELSE '[]'::jsonb END) AS p
    WHERE p ? 'geometry'
  ),
  items AS (
    SELECT poi_id, poi_name,
           ST_SimplifyPreserveTopology(
             ST_SetSRID(ST_GeomFromGeoJSON(gj), 4326), 0.0005
           ) AS geom
    FROM raw_items
  ),
  zone_cps AS (
    SELECT zc.code, r.centroid
    FROM public.custom_geo_zone_codes zc
    JOIN public.ref_codes_postaux r ON r.code_postal = zc.code
    WHERE zc.zone_id = p_zone_id AND zc.code_type = 'cp' AND r.centroid IS NOT NULL
  ),
  assigned AS (
    SELECT DISTINCT ON (c.code) c.code, i.poi_id
    FROM zone_cps c
    CROSS JOIN items i
    ORDER BY c.code,
             ST_Contains(i.geom, c.centroid) DESC,
             ST_Distance(i.geom, c.centroid)
  ),
  per_item AS (
    SELECT
      i.poi_id, i.poi_name,
      ST_Y(ST_Centroid(i.geom)) AS lat,
      ST_X(ST_Centroid(i.geom)) AS lng,
      GREATEST(1.0, LEAST(50.0, ceil(
        (SELECT max(ST_Distance(ST_Centroid(i.geom)::geography, dp.geom::geography))
         FROM ST_DumpPoints(i.geom) dp) / 1000.0
      ))) AS radius_km,
      COALESCE((SELECT jsonb_agg(a.code ORDER BY a.code) FROM assigned a WHERE a.poi_id = i.poi_id), '[]'::jsonb) AS cps
    FROM items i
  )
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
    'items', jsonb_agg(jsonb_build_object(
      'poi_id', p.poi_id,
      'poi_name', p.poi_name,
      'lat', round(p.lat::numeric, 5),
      'lng', round(p.lng::numeric, 5),
      'radius_km', p.radius_km,
      'cps', p.cps
    ) ORDER BY p.poi_name)
  ) END INTO v_result
  FROM per_item p;

  RETURN v_result;
END $function$;
