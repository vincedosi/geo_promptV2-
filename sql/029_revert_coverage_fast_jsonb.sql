-- ═══════════════════════════════════════════════════════════════════════════
-- 029_revert_coverage_fast_jsonb.sql
--
-- Revient à la version JSONB de compute_coverage_fast (migration 023).
-- Raison : migration 027 utilisait les colonnes directes (ind, ind_18_24…)
-- mais celles-ci sont encore NULL tant que populateCarreauxColumns n'est pas
-- terminé — le SUM retournait donc 0.
--
-- À réappliquer APRÈS 027, pour écraser la version "colonnes directes".
-- Une fois les colonnes remplies, appliquer 030 pour basculer définitivement.
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

  -- JSONB parsing — fonctionne même si les colonnes directes sont encore NULL
  SELECT COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT
  INTO v_result
  FROM carreaux_filosofi cf
  WHERE ST_SetSRID(cf.geom, 4326) && v_union_geom;

  RETURN COALESCE(v_result, 0);
END;
$$;

COMMENT ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT, INT) IS
  'Couverture audience — JSONB parsing (fallback pendant populate colonnes directes)';

GRANT EXECUTE ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT, INT) TO service_role;
