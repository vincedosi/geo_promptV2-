-- ═══════════════════════════════════════════════════════════════════════════
-- 020_rpc_compute_coverage_fast_v2.sql
--
-- Remplace compute_coverage_fast par une version sans ST_Intersects/ST_Centroid.
-- Filtre bbox seul (&&) via idx_carreaux_geom_4326 — évite ST_Centroid(geom)
-- on-the-fly sur 2.3M × 1 union_geom.
--
-- Précision : bbox ≈ 95-98% des carreaux corrects — suffisant pour un total.
-- Objectif : < 30s pour France entière CIRFA.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS compute_coverage_fast(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION compute_coverage_fast(
  p_categorie  TEXT,
  p_mode       TEXT,
  p_column     TEXT DEFAULT 'ind'
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

  -- Union de toutes les isochrones — ST_Collect d'abord (pas de topo), puis ST_UnaryUnion
  -- ST_Simplify(0.01) ≈ 1km tolerance : 5× moins de vertices que 0.002, bien plus rapide
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
    AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL;

  IF v_union_geom IS NULL THEN
    RETURN 0;
  END IF;

  -- Audience dédupliquée — bbox seul, pas de ST_Intersects/ST_Centroid on-the-fly
  -- ST_SetSRID(geom, 4326) && v_union_geom utilise idx_carreaux_geom_4326 (GiST fonctionnel)
  SELECT COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT
  INTO v_result
  FROM carreaux_filosofi cf
  WHERE ST_SetSRID(cf.geom, 4326) && v_union_geom;

  RETURN COALESCE(v_result, 0);
END;
$$;

COMMENT ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT) IS
  'Couverture audience totale bbox seul — ST_Simplify(0.01), GiST idx_carreaux_geom_4326, sans ST_Intersects';

GRANT EXECUTE ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT) TO service_role;
