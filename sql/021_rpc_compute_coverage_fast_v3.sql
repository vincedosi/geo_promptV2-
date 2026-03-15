-- ═══════════════════════════════════════════════════════════════════════════
-- 021_rpc_compute_coverage_fast_v3.sql
--
-- Ajoute p_level INT DEFAULT NULL à compute_coverage_fast.
-- Filtre sur ic.minutes = p_level quand fourni → réduit de ~500 à ~100 isochrones.
-- Sans filtre level, union de tous les paliers (comportement précédent).
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS compute_coverage_fast(TEXT, TEXT, TEXT);

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

  SELECT ST_UnaryUnion(ST_Collect(
    ST_Simplify(
      ST_SetSRID(
        ST_GeomFromGeoJSON(
          (ic.geojson -> 'features' -> 0 -> 'geometry')::text
        ),
        4326
      ),
      0.01
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
  'Couverture audience dédupliquée — bbox seul, ST_Simplify(0.01), filtre sur p_level si fourni';

GRANT EXECUTE ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT, INT) TO service_role;
