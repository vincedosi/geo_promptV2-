-- ═══════════════════════════════════════════════════════════════════════════
-- 024_rpc_compute_coverage_per_poi_batch.sql
--
-- Nouvelle fonction : compute_coverage_per_poi_batch(TEXT[], TEXT)
-- Prend un tableau de cache_keys (10 max) au lieu de tous les POIs d'un coup.
-- Évite le timeout HTTP Supabase PostgREST (2min) en découpant le travail.
-- Appelée en boucle depuis Inngest via des step.run() dynamiques.
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
BEGIN
  SET LOCAL statement_timeout = '90s';

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
  WHERE ic.cache_key = ANY(p_cache_keys)
    AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL
  GROUP BY ic.cache_key
  ORDER BY audience DESC;
END;
$$;

COMMENT ON FUNCTION compute_coverage_per_poi_batch(TEXT[], TEXT) IS
  'Audience par batch de POIs (array de cache_keys) — ST_Simplify(0.01)+MakeValid, bbox seul, 90s timeout';

GRANT EXECUTE ON FUNCTION compute_coverage_per_poi_batch(TEXT[], TEXT) TO service_role;
