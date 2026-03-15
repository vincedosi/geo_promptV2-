-- ═══════════════════════════════════════════════════════════════════════════
-- 025_rpc_compute_coverage_per_poi_batch_v2.sql
--
-- Remplace la LATERAL JOIN par une boucle PL/pgSQL explicite.
-- Pour chaque cache_key, une requête séparée → PostgreSQL utilise toujours
-- idx_carreaux_geom_4326 (GiST fonctionnel) via un index scan.
-- La LATERAL sur N isochrones confondait le planner (hash/merge join).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION compute_coverage_per_poi_batch(
  p_cache_keys  TEXT[],
  p_column      TEXT DEFAULT 'ind'
)
RETURNS TABLE(cache_key TEXT, audience BIGINT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key      TEXT;
  v_geom     geometry;
  v_audience BIGINT;
BEGIN
  SET LOCAL statement_timeout = '90s';

  FOREACH v_key IN ARRAY p_cache_keys LOOP
    -- Geometry : Simplify(0.01) puis MakeValid — forcer l'ordre correct
    SELECT ST_MakeValid(
      ST_Simplify(
        ST_SetSRID(
          ST_GeomFromGeoJSON((ic.geojson -> 'features' -> 0 -> 'geometry')::text),
          4326
        ),
        0.01
      )
    )
    INTO v_geom
    FROM isochrones_cache ic
    WHERE ic.cache_key = v_key
      AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL
    LIMIT 1;

    IF v_geom IS NOT NULL THEN
      -- Chaque requête séparée → GiST index scan garanti sur idx_carreaux_geom_4326
      SELECT COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT
      INTO v_audience
      FROM carreaux_filosofi cf
      WHERE ST_SetSRID(cf.geom, 4326) && v_geom;

      cache_key := v_key;
      audience  := v_audience;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION compute_coverage_per_poi_batch(TEXT[], TEXT) IS
  'Audience par batch de POIs — boucle PL/pgSQL, index GiST garanti par requête, 90s timeout';

GRANT EXECUTE ON FUNCTION compute_coverage_per_poi_batch(TEXT[], TEXT) TO service_role;
