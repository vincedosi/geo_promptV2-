-- ═══════════════════════════════════════════════════════════════════════════
-- 034_calculate_coverage_per_group.sql
--
-- Couverture audience dédupliquée par POI (groupe de géométries GeoJSON).
-- Utilisé par /api/coverage-breakdown pour le classement CIRFA par CIRFA.
--
-- Entrée : p_groups JSONB — tableau d'objets { id, geometries: string[] }
--   - id          : identifiant du groupe (cirfa_id)
--   - geometries  : tableau de GeoJSON geometry strings (un par palier)
--
-- Pour chaque groupe :
--   1. ST_UnaryUnion de ses géométries (dédupliquer les chevauchements entre paliers)
--   2. Croisement avec carreaux_filosofi → SUM(p_column)
--
-- Retourne : TABLE(group_id TEXT, coverage BIGINT) — triée par coverage DESC
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS calculate_coverage_per_group(JSONB, TEXT);

CREATE OR REPLACE FUNCTION calculate_coverage_per_group(
  p_groups JSONB,
  p_column TEXT DEFAULT 'ind'
)
RETURNS TABLE(group_id TEXT, coverage BIGINT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group     JSONB;
  v_id        TEXT;
  v_geom      geometry;
  v_audience  BIGINT;
  v_geoms     geometry[];
  v_g         TEXT;
  i           INT;
BEGIN
  SET LOCAL statement_timeout = '5min';

  FOR v_group IN SELECT jsonb_array_elements(p_groups)
  LOOP
    v_id := v_group->>'id';
    IF v_id IS NULL THEN CONTINUE; END IF;

    -- Collecter toutes les géométries du groupe
    v_geoms := ARRAY[]::geometry[];
    FOR v_g IN SELECT jsonb_array_elements_text(v_group->'geometries')
    LOOP
      BEGIN
        v_geoms := array_append(
          v_geoms,
          ST_MakeValid(
            ST_Simplify(
              ST_SetSRID(ST_GeomFromGeoJSON(v_g), 4326),
              0.01
            )
          )
        );
      EXCEPTION WHEN OTHERS THEN
        -- Géométrie invalide → ignorer
      END;
    END LOOP;

    IF array_length(v_geoms, 1) IS NULL THEN CONTINUE; END IF;

    -- Union des paliers du groupe (évite double-compte si paliers imbriqués)
    SELECT ST_UnaryUnion(ST_Collect(g))
    INTO v_geom
    FROM unnest(v_geoms) g;

    IF v_geom IS NULL THEN CONTINUE; END IF;

    -- Croisement avec carreaux_filosofi (bbox puis centroïde)
    SELECT COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT
    INTO v_audience
    FROM carreaux_filosofi cf
    WHERE ST_SetSRID(cf.geom, 4326) && v_geom
      AND ST_Intersects(
        COALESCE(cf.geom_centroid, ST_SetSRID(ST_Centroid(cf.geom), 4326)),
        v_geom
      );

    group_id := v_id;
    coverage := COALESCE(v_audience, 0);
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) IS
  'Couverture audience par groupe de géométries GeoJSON — union intra-groupe, croisement carreaux_filosofi';

GRANT EXECUTE ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) TO service_role;
