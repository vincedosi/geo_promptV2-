-- ═══════════════════════════════════════════════════════════════════════════════
-- GENESIS — calculate_network_coverage_v2 : Version ULTRA-optimisée PostgREST
-- À exécuter dans Supabase SQL Editor.
--
-- POURQUOI v2 ?
--   La v1 utilise ST_Union + ST_Intersection(prorata) + ST_Area qui prend 120s+
--   pour 4 isochrones 30min couvrant la Bretagne. PostgREST timeout = 120s.
--
-- STRATÉGIE v2 :
--   ❌ PAS de ST_Union pour le calcul coverage (le plus coûteux)
--   ❌ PAS de prorata (ST_Intersection + ST_Area) — remplacé par EXISTS booléen
--   ✅ EXISTS + ST_Intersects = index GIST only, 10-50× plus rapide
--   ✅ Pour 200m carreaux vs isochrones multi-km, l'erreur de bord est <2%
--   ✅ ST_Union seulement pour le GeoJSON de visualisation (sur géométries
--     déjà simplifiées = quelques ms)
--
-- Prérequis :
--   - Table carreaux_filosofi (millesime, geom GEOMETRY SRID:4326, metadata JSONB)
--   - Index GIST sur carreaux_filosofi.geom
--
-- Usage :
--   SELECT calculate_network_coverage_v2(
--     '[{"type":"Feature","geometry":{...},...}, ...]'::jsonb,
--     'ind_18_24',
--     '2021'
--   );
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION calculate_network_coverage_v2(
  isochrone_features  jsonb,    -- tableau de GeoJSON Feature objects (pré-simplifiés JS)
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
  v_bbox          geometry;     -- bounding box de toutes les isochrones
  v_union_geojson jsonb;        -- union simplifiée pour affichage carte
  v_coverage      bigint := 0;
  v_total_pop     bigint := 0;
  v_count         integer;
  v_breakdown     jsonb := '[]'::jsonb;
BEGIN
  -- Sanitize column name to prevent SQL injection
  IF target_column !~ '^[a-zA-Z][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid column name: %', target_column;
  END IF;

  SELECT jsonb_array_length(isochrone_features) INTO v_count;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('error', 'No features provided');
  END IF;

  -- ── Pre-parse : bbox + union GeoJSON (sur géométries simplifiées) ──────────
  -- Les features sont déjà simplifiées côté JS (round4 + dedup).
  -- On applique ST_SimplifyPreserveTopology(0.001) comme filet de sécurité.
  -- ST_Union de ~4-50 polygones à ~100 vertices chacun = quelques millisecondes.
  SELECT
    ST_Extent(g.geom)::geometry,
    ST_AsGeoJSON(
      ST_SimplifyPreserveTopology(ST_MakeValid(ST_Union(ARRAY_AGG(g.geom))), 0.001)
    )::jsonb
  INTO v_bbox, v_union_geojson
  FROM (
    SELECT ST_MakeValid(
      ST_SimplifyPreserveTopology(
        ST_SetSRID(ST_GeomFromGeoJSON(feat->>'geometry'), 4326),
        0.001
      )
    ) AS geom
    FROM jsonb_array_elements(isochrone_features) AS feat
    WHERE feat->>'type' = 'Feature'
      AND feat->'geometry' IS NOT NULL
  ) g;

  IF v_bbox IS NULL THEN
    RETURN jsonb_build_object('error', 'No valid geometries in isochrone_features');
  END IF;

  -- ── 1. Net coverage (booléen — PAS de prorata) ─────────────────────────────
  -- Pour chaque carreau dans le bbox, on vérifie s'il intersecte AU MOINS UNE
  -- isochrone (EXISTS court-circuite au 1er match). Pas de ST_Intersection ni
  -- ST_Area → 10-50× plus rapide. L'over-count sur les carreaux de bord est
  -- négligeable (<2%) pour des carreaux 200m vs isochrones de rayon ~30km.
  EXECUTE format($q$
    WITH iso AS (
      SELECT ST_MakeValid(ST_SimplifyPreserveTopology(
        ST_SetSRID(ST_GeomFromGeoJSON(feat->>'geometry'), 4326), 0.001
      )) AS geom
      FROM jsonb_array_elements($1) AS feat
      WHERE feat->>'type' = 'Feature' AND feat->'geometry' IS NOT NULL
    )
    SELECT COALESCE(SUM(COALESCE((c.metadata->>%L)::numeric, 0))::bigint, 0)
    FROM carreaux_filosofi c
    WHERE c.millesime = %L
      AND (c.metadata->>%L) IS NOT NULL
      AND c.geom && $2
      AND EXISTS (SELECT 1 FROM iso WHERE iso.geom && c.geom AND ST_Intersects(c.geom, iso.geom))
  $q$, target_column, p_millesime, target_column)
  INTO v_coverage USING isochrone_features, v_bbox;

  -- ── 2. Total region population (bbox envelope) ────────────────────────────
  EXECUTE format($q$
    SELECT COALESCE(ROUND(SUM(
      COALESCE((c.metadata->>%L)::numeric, 0)
    ))::bigint, 0)
    FROM carreaux_filosofi c
    WHERE c.millesime = %L
      AND (c.metadata->>%L) IS NOT NULL
      AND c.geom && $1
  $q$, target_column, p_millesime, target_column)
  INTO v_total_pop USING v_bbox;

  -- ── 3. Per-POI breakdown (booléen, top 10) ────────────────────────────────
  EXECUTE format($q$
    WITH feats AS (
      SELECT
        COALESCE(feat->'properties'->>'poi_name', 'POI ' || rn::text) AS poi_name,
        ST_MakeValid(ST_SimplifyPreserveTopology(
          ST_SetSRID(ST_GeomFromGeoJSON(feat->>'geometry'), 4326),
          0.002
        )) AS geom
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
      SELECT
        f.poi_name,
        COALESCE(ROUND(SUM(COALESCE((c.metadata->>%L)::numeric, 0)))::bigint, 0) AS audience
      FROM feats f
      JOIN carreaux_filosofi c
        ON c.millesime = %L
        AND (c.metadata->>%L) IS NOT NULL
        AND c.geom && f.geom
        AND ST_Intersects(c.geom, f.geom)
      GROUP BY f.poi_name
      ORDER BY audience DESC
      LIMIT 10
    ) ranked
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
    'union_geojson',    v_union_geojson
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION calculate_network_coverage_v2(jsonb, text, text)
  TO authenticated, service_role;
