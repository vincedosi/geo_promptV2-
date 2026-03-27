-- ============================================================
-- Migration 072 — get_iris_residual_inputs
-- Retourne tous les IRIS en un seul scalaire JSON (RETURNS JSON),
-- ce qui contourne la limite max-rows PostgREST (1 seule ligne vue).
-- Utilisé par /api/correlation/compute?no_limit=true.
-- ============================================================

CREATE OR REPLACE FUNCTION get_iris_residual_inputs(
  p_poi_category TEXT,
  p_iris_metric  TEXT   DEFAULT 'population',
  p_dep          TEXT   DEFAULT NULL,
  p_deps         TEXT[] DEFAULT NULL
)
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT *
    FROM correlation_poi_iris(
      p_poi_category,
      p_iris_metric,
      p_dep,
      p_deps,
      50000,   -- p_limit (ignoré car p_no_limit = TRUE)
      TRUE     -- p_no_limit
    )
  ) t
$$;

COMMENT ON FUNCTION get_iris_residual_inputs IS
  'Agrège tous les IRIS en un JSON scalaire pour contourner le max-rows PostgREST. ~800ms/49k IRIS.';
