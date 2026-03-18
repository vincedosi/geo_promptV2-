-- =============================================================================
-- ULTRA SIMPLE - MVT rapide
-- =============================================================================

DROP FUNCTION IF EXISTS get_tile_mvt(INTEGER, INTEGER, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS get_tile_mvt(INTEGER, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS get_tile_mvt(INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_tile_mvt_with_properties(INTEGER, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS get_tile_mvt_with_properties(INTEGER, INTEGER, INTEGER);

-- Version ultra-simple: pas de tri, pas de sous-requête
CREATE OR REPLACE FUNCTION get_tile_mvt(p_zoom INTEGER, p_x INTEGER, p_y INTEGER)
RETURNS TABLE(mvt BYTEA)
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
  v_bounds BOX2D;
  v_mvt BYTEA;
BEGIN
  v_bounds := ST_TileEnvelope(p_zoom, p_x, p_y);
  
  SELECT INTO v_mvt ST_AsMVT(
    ST_AsMVTGeom(geom, v_bounds, 4096, 0, true),
    'carreaux', 4096, 'geom'
  )
  FROM carreaux_filosofi
  WHERE geom && v_bounds
    AND resolution = '200m'
  LIMIT 1000;
  
  RETURN QUERY SELECT v_mvt;
END;
$$;

CREATE OR REPLACE FUNCTION get_tile_mvt_with_properties(p_zoom INTEGER, p_x INTEGER, p_y INTEGER, p_indicator TEXT DEFAULT 'ind')
RETURNS TABLE(mvt BYTEA)
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
  v_bounds BOX2D;
  v_mvt BYTEA;
BEGIN
  v_bounds := ST_TileEnvelope(p_zoom, p_x, p_y);
  
  SELECT INTO v_mvt ST_AsMVT(
    ST_AsMVTGeom(geom, v_bounds, 4096, 0, true),
    'carreaux', 4096, 'geom'
  )
  FROM carreaux_filosofi
  WHERE geom && v_bounds
    AND resolution = '200m'
  LIMIT 1000;
  
  RETURN QUERY SELECT v_mvt;
END;
$$;

GRANT EXECUTE ON FUNCTION get_tile_mvt TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_tile_mvt_with_properties TO authenticated, service_role;
