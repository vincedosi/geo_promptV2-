-- ═══════════════════════════════════════════════════════════════════════════════
-- GENESIS — calculate_network_coverage : Empreinte démographique d'un réseau
-- À exécuter dans Supabase SQL Editor.
--
-- Prérequis :
--   - Table carreaux_filosofi (millesime, geom GEOMETRY SRID:4326, metadata JSONB)
--   - Index GIST sur carreaux_filosofi.geom
--
-- Usage :
--   SELECT calculate_network_coverage(
--     '[{"type":"Feature","geometry":{...},...}, ...]'::jsonb,
--     'ind_18_24',
--     '2021'
--   );
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION calculate_network_coverage(
  isochrone_features  jsonb,    -- tableau de GeoJSON Feature objects
  target_column       text,     -- clé JSONB dans metadata (ex: 'ind_18_24', 'Ind_25_39')
  p_millesime         text DEFAULT '2021'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sql        text;
  v_union_geom geometry;
  v_coverage   numeric := 0;
  v_count      integer;
BEGIN
  -- Sanitize column name to prevent SQL injection
  IF target_column !~ '^[a-zA-Z][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid column name: %', target_column;
  END IF;

  -- Build union geometry from all isochrone features
  SELECT ST_Union(ARRAY(
    SELECT ST_SetSRID(
      ST_GeomFromGeoJSON((feat->>'geometry')),
      4326
    )
    FROM jsonb_array_elements(isochrone_features) AS feat
    WHERE feat->>'type' = 'Feature'
      AND feat->'geometry' IS NOT NULL
  )) INTO v_union_geom;

  IF v_union_geom IS NULL THEN
    RETURN jsonb_build_object('error', 'No valid geometries in isochrone_features');
  END IF;

  -- Get feature count for metadata
  SELECT jsonb_array_length(isochrone_features) INTO v_count;

  -- Compute prorata demographic coverage against carreaux_filosofi
  v_sql := format($q$
    SELECT COALESCE(
      ROUND(SUM(
        COALESCE((c.metadata->>%L)::numeric, 0)
        * ST_Area(ST_Intersection(c.geom, $1))
        / NULLIF(ST_Area(c.geom), 0)
      ))::bigint,
      0
    )
    FROM carreaux_filosofi c
    WHERE c.millesime = %L
      AND (c.metadata->>%L) IS NOT NULL
      AND ST_Intersects(c.geom, $1)
  $q$, target_column, p_millesime, target_column);

  EXECUTE v_sql INTO v_coverage USING v_union_geom;

  RETURN jsonb_build_object(
    'coverage',      COALESCE(v_coverage, 0),
    'nb_isochrones', v_count,
    'millesime',     p_millesime,
    'union_geojson', ST_AsGeoJSON(v_union_geom)::jsonb
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION calculate_network_coverage(jsonb, text, text)
  TO authenticated, service_role;

-- Test rapide (remplacer par de vrais features GeoJSON)
-- SELECT calculate_network_coverage('[]'::jsonb, 'ind_18_24', '2021');
