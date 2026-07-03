-- ============================================================
-- 088 — Audience par item d'une zone custom (plan média)
-- ============================================================
-- Appliquée le 2026-07-03 via MCP Supabase (migrations zone_items_audience → _v4).
--
-- Les zones battle stockent leurs composants dans
-- source_metadata.contributing_layers[*].metadata.battle_features
-- (Feature GeoJSON, properties {id, nom} — un territoire sans chevauchement
-- par POI). Cette RPC agrège la population par tranche d'âge POUR CHAQUE
-- item, résultat caché dans custom_geo_zones.items_audience_stats.
--
-- Performance (leçons des v1→v4) :
--   - geom_centroid est VIDE pour la résolution 200m → croisement sur c.geom ;
--   - isochrones bruts trop détaillés → ST_SimplifyPreserveTopology 0.0005 (~50 m) ;
--   - ST_Subdivide(…, 128) pour que le GIST élague ; affectation par
--     ST_Contains(part, ST_Centroid(c.geom)) = 1 carreau max par item.
-- Vérifié sur CIRFA BRETAGNE (4 items, ~46k carreaux) : < 10 s, totaux à
-- 1,3 % de l'audience globale (méthode centroïde vs ST_Intersects).
-- Garde-fous : max 20 items, somme des aires <= 5000 km² (cap I/O Nano).

ALTER TABLE public.custom_geo_zones
  ADD COLUMN IF NOT EXISTS items_audience_stats jsonb,
  ADD COLUMN IF NOT EXISTS items_audience_computed_at timestamptz;

CREATE OR REPLACE FUNCTION public.compute_zone_items_audience(
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
  v_items jsonb;
  v_total_area numeric;
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

  SELECT jsonb_agg(jsonb_build_object('poi_id', x.poi_id, 'poi_name', x.poi_name, 'geometry', x.gj))
  INTO v_items
  FROM (
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
  ) x;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RETURN NULL;
  END IF;
  IF jsonb_array_length(v_items) > 20 THEN
    RAISE EXCEPTION 'Too many items (max 20)';
  END IF;

  SELECT COALESCE(SUM(ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(it->'geometry'), 4326)::geography) / 1e6), 0)
  INTO v_total_area
  FROM jsonb_array_elements(v_items) AS it;
  IF v_total_area > 5000 THEN
    v_result := jsonb_build_object('computed_at', now(), 'skipped', true, 'reason', 'items_too_large_max_5000_km2');
    UPDATE public.custom_geo_zones
    SET items_audience_stats = v_result, items_audience_computed_at = now()
    WHERE id = p_zone_id;
    RETURN v_result;
  END IF;

  WITH items AS (
    SELECT
      it->>'poi_id'   AS poi_id,
      it->>'poi_name' AS poi_name,
      ST_SimplifyPreserveTopology(
        ST_SetSRID(ST_GeomFromGeoJSON(it->'geometry'), 4326), 0.0005
      ) AS geom
    FROM jsonb_array_elements(v_items) AS it
  ),
  parts AS (
    SELECT poi_id, poi_name, geom, ST_Subdivide(geom, 128) AS gpart
    FROM items
  ),
  hits AS (
    SELECT p.poi_id, p.poi_name, p.geom, c.metadata
    FROM parts p
    JOIN public.carreaux_filosofi c
      ON c.geom && p.gpart
     AND c.resolution = '200m'
     AND ST_Contains(p.gpart, ST_Centroid(c.geom))
  ),
  agg AS (
    SELECT
      h.poi_id, h.poi_name,
      ST_Area(h.geom::geography) / 1e6 AS area_km2,
      COUNT(*) AS carreaux_count,
      COALESCE(SUM((h.metadata->>'ind')::float), 0) AS pop_total,
      COALESCE(SUM((h.metadata->>'ind_0_3')::float
                 + (h.metadata->>'ind_4_5')::float
                 + (h.metadata->>'ind_6_10')::float
                 + (h.metadata->>'ind_11_17')::float), 0) AS pop_0_17,
      COALESCE(SUM((h.metadata->>'ind_18_24')::float), 0) AS pop_18_24,
      COALESCE(SUM((h.metadata->>'ind_25_39')::float), 0) AS pop_25_39,
      COALESCE(SUM((h.metadata->>'ind_40_54')::float), 0) AS pop_40_54,
      COALESCE(SUM((h.metadata->>'ind_55_64')::float), 0) AS pop_55_64,
      COALESCE(SUM((h.metadata->>'ind_65_79')::float), 0) AS pop_65_79,
      COALESCE(SUM((h.metadata->>'ind_80p')::float),   0) AS pop_80p
    FROM hits h
    GROUP BY h.poi_id, h.poi_name, h.geom
  ),
  agg_all AS (
    SELECT i.poi_id, i.poi_name,
           ST_Area(i.geom::geography) / 1e6 AS area_km2,
           COALESCE(a.carreaux_count, 0) AS carreaux_count,
           COALESCE(a.pop_total, 0) AS pop_total,
           COALESCE(a.pop_0_17, 0) AS pop_0_17,
           COALESCE(a.pop_18_24, 0) AS pop_18_24,
           COALESCE(a.pop_25_39, 0) AS pop_25_39,
           COALESCE(a.pop_40_54, 0) AS pop_40_54,
           COALESCE(a.pop_55_64, 0) AS pop_55_64,
           COALESCE(a.pop_65_79, 0) AS pop_65_79,
           COALESCE(a.pop_80p, 0)   AS pop_80p
    FROM items i
    LEFT JOIN agg a ON a.poi_id = i.poi_id
  )
  SELECT jsonb_build_object(
    'computed_at', now(),
    'method', 'subdivide_centroid_200m',
    'items', jsonb_agg(jsonb_build_object(
      'poi_id', a.poi_id,
      'poi_name', a.poi_name,
      'area_km2', round(a.area_km2::numeric, 2),
      'carreaux_count', a.carreaux_count,
      'population', jsonb_build_object(
        'total', round(a.pop_total::numeric),
        'by_age', jsonb_build_object(
          '0_17',    round(a.pop_0_17::numeric),
          '18_24',   round(a.pop_18_24::numeric),
          '25_39',   round(a.pop_25_39::numeric),
          '40_54',   round(a.pop_40_54::numeric),
          '55_64',   round(a.pop_55_64::numeric),
          '65_79',   round(a.pop_65_79::numeric),
          '80_plus', round(a.pop_80p::numeric)
        )
      )
    ) ORDER BY a.poi_name)
  ) INTO v_result
  FROM agg_all a;

  UPDATE public.custom_geo_zones
  SET items_audience_stats = v_result, items_audience_computed_at = now()
  WHERE id = p_zone_id;

  RETURN v_result;
END $function$;
