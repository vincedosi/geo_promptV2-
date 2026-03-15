-- ═══════════════════════════════════════════════════════════════════════════
-- 023_rpc_coverage_buffer_fix.sql
--
-- Corrige TopologyException GEOS : ST_Simplify(0.01) créait des auto-intersections.
-- Fix : inverser l'ordre → ST_MakeValid(ST_Simplify(geom, 0.01))
--   Simplify d'abord (peut créer des invalides), MakeValid ensuite (répare).
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS compute_coverage_fast(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS compute_coverage_fast(TEXT, TEXT, TEXT, INT);

CREATE OR REPLACE FUNCTION compute_coverage_fast(
  p_categorie  TEXT,
  p_mode       TEXT,
  p_column     TEXT DEFAULT 'ind',
  p_level      INT  DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_union_geom  geometry;
  v_result      BIGINT;
BEGIN
  SET LOCAL statement_timeout = '4min';

  -- Ordre correct : Simplify PUIS MakeValid
  -- ST_Simplify(0.01) peut créer des auto-intersections → ST_MakeValid les corrige
  SELECT ST_UnaryUnion(ST_Collect(
    ST_MakeValid(
      ST_Simplify(
        ST_SetSRID(
          ST_GeomFromGeoJSON(
            (ic.geojson -> 'features' -> 0 -> 'geometry')::text
          ),
          4326
        ),
        0.01
      )
    )
  ))
  INTO v_union_geom
  FROM isochrones_cache ic
  WHERE ic.categorie = p_categorie
    AND ic.mode      = p_mode
    AND ic.ville     = '_battle_'
    AND (p_level IS NULL OR ic.minutes = p_level)
    AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL;

  IF v_union_geom IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT
  INTO v_result
  FROM carreaux_filosofi cf
  WHERE ST_SetSRID(cf.geom, 4326) && v_union_geom;

  RETURN COALESCE(v_result, 0);
END;
$$;

COMMENT ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT, INT) IS
  'Couverture audience — ST_Simplify(0.01) puis ST_MakeValid, bbox seul';

GRANT EXECUTE ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT, INT) TO service_role;


-- ── compute_coverage_per_poi ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS compute_coverage_per_poi(TEXT, TEXT, INT, TEXT);

CREATE OR REPLACE FUNCTION compute_coverage_per_poi(
  p_categorie  TEXT,
  p_mode       TEXT,
  p_level      INT,
  p_column     TEXT DEFAULT 'ind'
)
RETURNS TABLE(cache_key TEXT, audience BIGINT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SET LOCAL statement_timeout = '5min';

  RETURN QUERY
  SELECT
    ic.cache_key,
    COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT AS audience
  FROM isochrones_cache ic
  CROSS JOIN LATERAL (
    SELECT ST_MakeValid(
      ST_Simplify(
        ST_SetSRID(
          ST_GeomFromGeoJSON((ic.geojson -> 'features' -> 0 -> 'geometry')::text),
          4326
        ),
        0.01
      )
    ) AS iso_geom
  ) iso
  JOIN carreaux_filosofi cf
    ON ST_SetSRID(cf.geom, 4326) && iso.iso_geom
  WHERE ic.categorie = p_categorie
    AND ic.mode      = p_mode
    AND ic.ville     = '_battle_'
    AND ic.minutes   = p_level
    AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL
  GROUP BY ic.cache_key
  ORDER BY audience DESC;
END;
$$;

COMMENT ON FUNCTION compute_coverage_per_poi(TEXT, TEXT, INT, TEXT) IS
  'Audience par POI — ST_Simplify(0.01) puis ST_MakeValid, bbox seul';

GRANT EXECUTE ON FUNCTION compute_coverage_per_poi(TEXT, TEXT, INT, TEXT) TO service_role;
