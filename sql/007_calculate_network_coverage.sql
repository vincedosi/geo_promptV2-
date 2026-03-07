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
SET statement_timeout TO 0
AS $$
DECLARE
  v_union_geom    geometry;
  v_coverage      bigint := 0;
  v_total_pop     bigint := 0;
  v_count         integer;
  v_breakdown     jsonb := '[]'::jsonb;
BEGIN
  -- Sanitize column name to prevent SQL injection
  IF target_column !~ '^[a-zA-Z][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid column name: %', target_column;
  END IF;

  -- Build union geometry: simplify each isochrone first to reduce complexity,
  -- then MakeValid to handle topology issues. ST_SetSRID applied twice because
  -- ST_MakeValid/ST_SimplifyPreserveTopology can strip SRID on some PostGIS versions.
  SELECT ST_Union(ARRAY(
    SELECT ST_SetSRID(ST_MakeValid(
      ST_SimplifyPreserveTopology(
        ST_SetSRID(ST_GeomFromGeoJSON((feat->>'geometry')), 4326),
        0.0001
      )
    ), 4326)
    FROM jsonb_array_elements(isochrone_features) AS feat
    WHERE feat->>'type' = 'Feature'
      AND feat->'geometry' IS NOT NULL
  )) INTO v_union_geom;

  IF v_union_geom IS NULL THEN
    RETURN jsonb_build_object('error', 'No valid geometries in isochrone_features');
  END IF;

  SELECT jsonb_array_length(isochrone_features) INTO v_count;

  -- ── 1. Net coverage (union → prorata carreaux) ─────────────────────────────
  EXECUTE format($q$
    SELECT COALESCE(ROUND(SUM(
      COALESCE((c.metadata->>%L)::numeric, 0)
      * ST_Area(ST_Intersection(c.geom, $1))
      / NULLIF(ST_Area(c.geom), 0)
    ))::bigint, 0)
    FROM carreaux_filosofi c
    WHERE c.millesime = %L
      AND (c.metadata->>%L) IS NOT NULL
      AND c.geom && $1
      AND ST_Intersects(c.geom, $1)
  $q$, target_column, p_millesime, target_column)
  INTO v_coverage USING v_union_geom;

  -- ── 2. Total region population (bbox envelope of union) ────────────────────
  EXECUTE format($q$
    SELECT COALESCE(ROUND(SUM(
      COALESCE((c.metadata->>%L)::numeric, 0)
    ))::bigint, 0)
    FROM carreaux_filosofi c
    WHERE c.millesime = %L
      AND (c.metadata->>%L) IS NOT NULL
      AND c.geom && ST_Envelope($1)
  $q$, target_column, p_millesime, target_column)
  INTO v_total_pop USING v_union_geom;

  -- ── 3. Per-POI breakdown: simple SUM (no prorata) for ranking speed ──────────
  -- Uses only ST_Intersects (GIST index), no ST_Intersection/ST_Area computation.
  -- Slight over-count on edge carreaux but ranking order is correct.
  EXECUTE format($q$
    WITH top_feats AS (
      SELECT
        COALESCE(feat->'properties'->>'poi_name', 'POI ' || rn::text) AS poi_name,
        ST_SetSRID(ST_MakeValid(ST_SimplifyPreserveTopology(
          ST_SetSRID(ST_GeomFromGeoJSON(feat->>'geometry'), 4326),
          0.0001
        )), 4326) AS feat_geom
      FROM (
        SELECT feat, row_number() OVER () AS rn
        FROM jsonb_array_elements($1) AS feat
        WHERE feat->>'type' = 'Feature'
          AND feat->'geometry' IS NOT NULL
        LIMIT 20
      ) sub
    ),
    poi_cov AS (
      SELECT
        tf.poi_name,
        COALESCE(ROUND(SUM(
          COALESCE((c.metadata->>%L)::numeric, 0)
        ))::bigint, 0) AS audience
      FROM top_feats tf
      JOIN carreaux_filosofi c ON
        c.millesime = %L
        AND (c.metadata->>%L) IS NOT NULL
        AND c.geom && tf.feat_geom
        AND ST_Intersects(c.geom, tf.feat_geom)
      GROUP BY tf.poi_name
      ORDER BY audience DESC
      LIMIT 10
    )
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('name', poi_name, 'audience', audience)),
      '[]'::jsonb
    )
    FROM poi_cov
  $q$, target_column, p_millesime, target_column)
  INTO v_breakdown USING isochrone_features;

  -- ── Return ─────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'coverage',         COALESCE(v_coverage, 0),
    'nb_isochrones',    v_count,
    'millesime',        p_millesime,
    'total_pop',        COALESCE(v_total_pop, 0),
    'penetration_rate', CASE
      WHEN v_total_pop > 0
      THEN ROUND((v_coverage::numeric / v_total_pop * 100)::numeric, 1)
      ELSE 0
    END,
    'breakdown_by_poi', COALESCE(v_breakdown, '[]'::jsonb),
    'union_geojson',    ST_AsGeoJSON(ST_SimplifyPreserveTopology(v_union_geom, 0.0001))::jsonb
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION calculate_network_coverage(jsonb, text, text)
  TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEX OBLIGATOIRES — sans ces index les requêtes font un full table scan
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_carreaux_geom
  ON carreaux_filosofi USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_carreaux_millesime
  ON carreaux_filosofi (millesime);

-- Test rapide (remplacer par de vrais features GeoJSON)
-- SELECT calculate_network_coverage('[]'::jsonb, 'ind_18_24', '2021');
