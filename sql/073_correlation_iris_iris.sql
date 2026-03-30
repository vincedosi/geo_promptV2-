-- ============================================================
-- Migration 073 — correlation_iris_iris + get_iris_iris_residual_inputs
-- Corrélation entre deux métriques IRIS (mode IRIS × IRIS).
-- Même architecture que correlation_poi_iris / get_iris_residual_inputs.
-- ============================================================

-- Whitelist des métriques autorisées (même liste que correlation_poi_iris)
-- metric_x et metric_y doivent être des colonnes de iris_metrics_mv.

CREATE OR REPLACE FUNCTION correlation_iris_iris(
  p_metric_x  TEXT,
  p_metric_y  TEXT,
  p_dep       TEXT    DEFAULT NULL,
  p_deps      TEXT[]  DEFAULT NULL,
  p_limit     INT     DEFAULT 2000,
  p_no_limit  BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  code_iris    TEXT,
  nom_iris     TEXT,
  metric_x     NUMERIC,
  metric_y     NUMERIC,
  centroid_lat DOUBLE PRECISION,
  centroid_lng DOUBLE PRECISION
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  allowed TEXT[] := ARRAY[
    'population','pop_0_14','pop_15_29','pop_30_44','pop_45_59','pop_60_74','pop_75_plus',
    'nb_csp_agri','nb_csp_artisan','nb_csp_cadre','nb_csp_intermediaire',
    'nb_csp_employe','nb_csp_ouvrier','nb_csp_retraite','nb_csp_sans',
    'rev_median','taux_pauvrete','taux_chomage','taux_proprio','taux_locataire',
    'taux_diplome_sup','taux_sans_diplome','menages','logements'
  ];
  q TEXT;
BEGIN
  IF NOT (p_metric_x = ANY(allowed)) THEN
    RAISE EXCEPTION 'Métrique non autorisée: %', p_metric_x;
  END IF;
  IF NOT (p_metric_y = ANY(allowed)) THEN
    RAISE EXCEPTION 'Métrique non autorisée: %', p_metric_y;
  END IF;

  q := format(
    'SELECT
       i.code_iris,
       i.nom_iris,
       mx.%I::numeric                          AS metric_x,
       my.%I::numeric                          AS metric_y,
       ST_Y(ST_Centroid(i.geom))               AS centroid_lat,
       ST_X(ST_Centroid(i.geom))               AS centroid_lng
     FROM iris i
     JOIN iris_metrics_mv mx ON mx.code_iris = i.code_iris
     JOIN iris_metrics_mv my ON my.code_iris = i.code_iris
     WHERE mx.%I IS NOT NULL AND my.%I IS NOT NULL
       AND i.is_true_iris = true',
    p_metric_x, p_metric_y,
    p_metric_x, p_metric_y
  );

  IF p_deps IS NOT NULL THEN
    q := q || ' AND LEFT(i.code_iris, 2) = ANY($1)';
  ELSIF p_dep IS NOT NULL THEN
    q := q || ' AND LEFT(i.code_iris, 2) = $2';
  END IF;

  IF NOT p_no_limit THEN
    q := q || format(' LIMIT %s', p_limit);
  END IF;

  RETURN QUERY EXECUTE q USING p_deps, p_dep;
END;
$$;

COMMENT ON FUNCTION correlation_iris_iris IS
  'Corrélation IRIS × IRIS — croise deux métriques socio-démographiques. Whitelist de 30 colonnes.';

-- ── Variante scalaire JSON pour contourner max-rows PostgREST ────────────

CREATE OR REPLACE FUNCTION get_iris_iris_residual_inputs(
  p_metric_x TEXT,
  p_metric_y TEXT,
  p_dep      TEXT   DEFAULT NULL,
  p_deps     TEXT[] DEFAULT NULL
)
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT *
    FROM correlation_iris_iris(p_metric_x, p_metric_y, p_dep, p_deps, 50000, TRUE)
  ) t
$$;

COMMENT ON FUNCTION get_iris_iris_residual_inputs IS
  'Agrège tous les IRIS (mode iris_iris) en un JSON scalaire pour contourner le max-rows PostgREST.';
