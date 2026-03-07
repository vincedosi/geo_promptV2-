-- ═══════════════════════════════════════════════════════════════════════════════
-- GENESIS — calculate_network_coverage_v3 : Version single-scan + SRID fixé
-- À exécuter dans Supabase SQL Editor ou via MCP apply_migration.
--
-- POURQUOI v3 ?
--   v2 avait deux bugs critiques :
--   1. CTE `iso` dans EXISTS non-matérialisé (PG12+) → ST_GeomFromGeoJSON
--      s'exécutait 207k fois au lieu d'une → timeout systématique à 120s.
--   2. SRID perdu après ST_SimplifyPreserveTopology dans cette version PostGIS →
--      ST_Intersects échouait avec "mixed SRID geometries".
--
-- STRATÉGIE v3 :
--   ✅ v_union_geom pré-calculée UNE FOIS avec ST_SetSRID(..., 4326) explicite
--   ✅ UN SEUL SCAN pour coverage + total_pop (FILTER WHERE ST_Intersects)
--   ✅ Breakdown LATERAL avec CTE MATERIALIZED : un GIST scan par POI garanti
--   ✅ Aucun CTE dans EXISTS → zéro risque de ré-évaluation par ligne
--
-- Prérequis :
--   - Table carreaux_filosofi (millesime, geom GEOMETRY SRID:4326, metadata JSONB)
--   - Index GIST sur carreaux_filosofi.geom (idx_carreaux_geom)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION calculate_network_coverage_v3(
  isochrone_features  jsonb,
  target_column       text,
  p_millesime         text DEFAULT '2021'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout TO 0
AS $$
DECLARE
  v_bbox          geometry;
  v_union_geom    geometry;   -- union des isochrones SRID 4326, passée en $1 aux EXECUTE
  v_union_geojson jsonb;
  v_coverage      bigint := 0;
  v_total_pop     bigint := 0;
  v_count         integer;
  v_breakdown     jsonb := '[]'::jsonb;
BEGIN
  IF target_column !~ '^[a-zA-Z][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid column name: %', target_column;
  END IF;

  SELECT jsonb_array_length(isochrone_features) INTO v_count;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('error', 'No features provided');
  END IF;

  -- ── Étape 1 : pré-calcul bbox + union_geom + union_geojson ─────────────────
  -- ST_SetSRID(..., 4326) appliqué après ST_Union car ST_SimplifyPreserveTopology
  -- perd le SRID dans cette version de PostGIS.
  SELECT
    ST_SetSRID(ST_Extent(g.geom)::geometry, 4326),
    ST_SetSRID(ST_MakeValid(ST_Union(ARRAY_AGG(g.geom))), 4326),
    ST_AsGeoJSON(
      ST_SimplifyPreserveTopology(
        ST_SetSRID(ST_MakeValid(ST_Union(ARRAY_AGG(g.geom))), 4326),
        0.001
      )
    )::jsonb
  INTO v_bbox, v_union_geom, v_union_geojson
  FROM (
    SELECT ST_MakeValid(ST_SimplifyPreserveTopology(
      ST_SetSRID(ST_GeomFromGeoJSON(feat->>'geometry'), 4326), 0.001
    )) AS geom
    FROM jsonb_array_elements(isochrone_features) AS feat
    WHERE feat->>'type' = 'Feature'
      AND feat->'geometry' IS NOT NULL
  ) g;

  IF v_bbox IS NULL OR v_union_geom IS NULL THEN
    RETURN jsonb_build_object('error', 'No valid geometries in isochrone_features');
  END IF;

  -- ── Étape 2 : coverage + total_pop en UN SEUL SCAN ─────────────────────────
  -- $1 = v_union_geom (SRID 4326, géométrie scalaire pré-calculée)
  -- $2 = v_bbox (SRID 4326, pré-filtre GIST)
  -- FILTER(WHERE ST_Intersects) : coverage sans second scan de la table.
  EXECUTE format($q$
    SELECT
      COALESCE(
        (SUM(COALESCE((c.metadata->>%L)::numeric, 0))
          FILTER (WHERE ST_Intersects(c.geom, $1)))::bigint,
        0
      ),
      COALESCE(SUM(COALESCE((c.metadata->>%L)::numeric, 0))::bigint, 0)
    FROM carreaux_filosofi c
    WHERE c.millesime = %L
      AND (c.metadata->>%L) IS NOT NULL
      AND c.geom && $2
  $q$, target_column, target_column, p_millesime, target_column)
  INTO v_coverage, v_total_pop USING v_union_geom, v_bbox;

  -- ── Étape 3 : breakdown par POI (LATERAL → 1 GIST scan par POI) ────────────
  -- CTE MATERIALIZED : les features ne sont parsées qu'une seule fois.
  EXECUTE format($q$
    WITH feats AS MATERIALIZED (
      SELECT
        COALESCE(feat->'properties'->>'poi_name', 'POI ' || rn::text) AS poi_name,
        ST_SetSRID(ST_MakeValid(ST_SimplifyPreserveTopology(
          ST_SetSRID(ST_GeomFromGeoJSON(feat->>'geometry'), 4326), 0.002
        )), 4326) AS geom
      FROM (
        SELECT feat, row_number() OVER () AS rn
        FROM jsonb_array_elements($1) AS feat
        WHERE feat->>'type' = 'Feature'
          AND feat->'geometry' IS NOT NULL
        LIMIT 10
      ) sub
    )
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('name', poi_name, 'audience', audience)),
      '[]'::jsonb
    )
    FROM (
      SELECT f.poi_name, COALESCE(SUM(lat.pop)::bigint, 0) AS audience
      FROM feats f,
      LATERAL (
        SELECT COALESCE((c.metadata->>%L)::numeric, 0) AS pop
        FROM carreaux_filosofi c
        WHERE c.millesime = %L
          AND (c.metadata->>%L) IS NOT NULL
          AND c.geom && f.geom
          AND ST_Intersects(c.geom, f.geom)
      ) lat
      GROUP BY f.poi_name
      ORDER BY audience DESC
      LIMIT 10
    ) ranked
  $q$, target_column, p_millesime, target_column)
  INTO v_breakdown USING isochrone_features;

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
    'union_geojson',    v_union_geojson
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('error', SQLERRM, 'detail', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_network_coverage_v3(jsonb, text, text)
  TO authenticated, service_role;
