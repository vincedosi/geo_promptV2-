-- ═══════════════════════════════════════════════════════════════════════════
-- 035_fix_compute_coverage_fast_intersects.sql
--
-- Correction du bug de surestimation dans compute_coverage_fast.
-- La version 029 n'utilisait que && (bbox) → comptait tous les carreaux
-- dans la bounding box de l'union, soit toute la région (~4M au lieu de ~330K).
--
-- Fix : ajouter ST_Intersects(centroïde, union_geom) exactement comme
-- calculate_coverage_per_group (migration 034) qui retourne les bons chiffres.
-- ═══════════════════════════════════════════════════════════════════════════

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
  SET LOCAL statement_timeout = '5min';

  -- Union de tous les isochrones de la catégorie (dédupliqués)
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

  -- Croisement avec carreaux_filosofi :
  --   1. bbox (index spatial rapide)
  --   2. ST_Intersects sur le centroïde (filtre réel, évite la surestimation bbox)
  SELECT COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT
  INTO v_result
  FROM carreaux_filosofi cf
  WHERE ST_SetSRID(cf.geom, 4326) && v_union_geom
    AND ST_Intersects(
      COALESCE(cf.geom_centroid, ST_SetSRID(ST_Centroid(cf.geom), 4326)),
      v_union_geom
    );

  RETURN COALESCE(v_result, 0);
END;
$$;

COMMENT ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT, INT) IS
  'Couverture audience dédupliquée — bbox + ST_Intersects centroïde (fix surestimation 035)';

GRANT EXECUTE ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT, INT) TO service_role;
