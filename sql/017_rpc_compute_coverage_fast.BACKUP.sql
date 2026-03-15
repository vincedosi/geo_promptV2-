-- ═══════════════════════════════════════════════════════════════════════════
-- 017_rpc_compute_coverage_fast.BACKUP.sql
--
-- SAUVEGARDE — version stable du 2026-03-15
-- compute_coverage_fast   → 57 270 042 ind. France CIRFA ✓
-- compute_coverage_by_level → par palier ✓
--
-- Pour restaurer : copier ce contenu dans le SQL Editor Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS compute_coverage_fast(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS compute_coverage_by_level(TEXT, TEXT, TEXT);


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
  SET LOCAL statement_timeout = '2min';

  SELECT ST_UnaryUnion(ST_Collect(
    ST_Simplify(
      ST_SetSRID(
        ST_GeomFromGeoJSON(
          (ic.geojson -> 'features' -> 0 -> 'geometry')::text
        ),
        4326
      ),
      0.002
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

GRANT EXECUTE ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT) TO service_role;


CREATE OR REPLACE FUNCTION compute_coverage_by_level(
  p_categorie  TEXT,
  p_mode       TEXT,
  p_column     TEXT DEFAULT 'ind'
)
RETURNS TABLE(level INT, audience BIGINT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level       INT;
  v_union_geom  geometry;
  v_audience    BIGINT;
BEGIN
  SET LOCAL statement_timeout = '3min';

  FOR v_level, v_union_geom IN
    SELECT
      ic.minutes,
      ST_UnaryUnion(ST_Collect(
        ST_Simplify(
          ST_SetSRID(
            ST_GeomFromGeoJSON(
              (ic.geojson -> 'features' -> 0 -> 'geometry')::text
            ),
            4326
          ),
          0.002
        )
      ))
    FROM isochrones_cache ic
    WHERE ic.categorie = p_categorie
      AND ic.mode      = p_mode
      AND ic.ville     = '_battle_'
      AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL
    GROUP BY ic.minutes
    ORDER BY ic.minutes
  LOOP
    SELECT COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT
    INTO v_audience
    FROM carreaux_filosofi cf
    WHERE ST_SetSRID(cf.geom, 4326) && v_union_geom
      AND ST_Intersects(
        COALESCE(cf.geom_centroid, ST_SetSRID(ST_Centroid(cf.geom), 4326)),
        v_union_geom
      );

    level    := v_level;
    audience := COALESCE(v_audience, 0);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION compute_coverage_by_level(TEXT, TEXT, TEXT) TO service_role;
