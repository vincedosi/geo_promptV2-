-- ============================================================
-- Migration 047 — RPCs IRIS dynamiques (zéro hardcode whitelist)
-- Source de vérité : information_schema.columns
-- Labels/icons : lib/iris-crawler/db-columns.ts (côté TypeScript)
-- ============================================================

-- 1. correlation_poi_iris — validation via information_schema
--    Supprime la whitelist statique IF NOT IN (...)
--    Supprime les paramètres p_dep (compat. ascendante) → p_deps uniquement
CREATE OR REPLACE FUNCTION correlation_poi_iris(
  p_poi_category TEXT,
  p_iris_metric  TEXT    DEFAULT 'population',
  p_deps         TEXT[]  DEFAULT NULL,
  p_limit        INT     DEFAULT 2000
)
RETURNS TABLE(
  code_iris    TEXT,
  nom_iris     TEXT,
  metric_value NUMERIC,
  poi_count    BIGINT,
  centroid_lat DOUBLE PRECISION,
  centroid_lng DOUBLE PRECISION
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- Validation dynamique : la colonne doit exister et être numérique
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'iris'
      AND column_name  = p_iris_metric
      AND data_type IN ('integer','numeric','double precision','real','bigint','smallint')
  ) THEN
    RAISE EXCEPTION 'Métrique inexistante ou non numérique: %', p_iris_metric;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT
       i.code_iris,
       i.nom_iris,
       i.%I::numeric         AS metric_value,
       COUNT(p.id)           AS poi_count,
       i.centroid_lat,
       i.centroid_lng
     FROM iris i
     LEFT JOIN poi_france p
       ON ST_Contains(i.geom, p.geom)
       AND p.categorie = $1
     WHERE ($2 IS NULL OR i.code_dept = ANY($2))
       AND i.%I IS NOT NULL
       AND i.%I > 0
     GROUP BY i.code_iris, i.nom_iris, i.%I, i.centroid_lat, i.centroid_lng
     ORDER BY i.code_iris
     LIMIT $3',
    p_iris_metric, p_iris_metric, p_iris_metric, p_iris_metric
  ) USING p_poi_category, p_deps, p_limit;
END;
$$;

-- 2. get_iris_metric_columns — retourne uniquement les noms de colonnes
--    AUCUN label. AUCUN icon. AUCUN CASE WHEN.
--    L'enrichissement (labels, icons) se fait côté TypeScript via IRIS_DB_COLUMNS.
DROP FUNCTION IF EXISTS get_iris_metric_columns();

CREATE FUNCTION get_iris_metric_columns()
RETURNS TABLE(key TEXT)
LANGUAGE sql STABLE AS $$
  SELECT column_name AS key
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'iris'
    AND data_type IN ('integer','numeric','double precision','real','bigint','smallint')
    AND column_name NOT IN (
      'id', 'gid',
      'centroid_lat', 'centroid_lng',
      'year', 'surface', 'area'
    )
    AND column_name NOT LIKE '%_id'
  ORDER BY column_name;
$$;

-- 3. get_iris_fill_status — outil admin : nombre de valeurs non-NULL par colonne
CREATE OR REPLACE FUNCTION get_iris_fill_status()
RETURNS TABLE(col TEXT, n BIGINT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_col TEXT;
  v_n   BIGINT;
BEGIN
  FOR v_col IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'iris'
      AND data_type IN ('integer','numeric','double precision','real','bigint','smallint')
      AND column_name NOT IN (
        'id', 'gid',
        'centroid_lat', 'centroid_lng',
        'year', 'surface', 'area'
      )
      AND column_name NOT LIKE '%_id'
    ORDER BY column_name
  LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM iris WHERE %I IS NOT NULL AND %I > 0',
      v_col, v_col
    ) INTO v_n;
    col := v_col;
    n   := v_n;
    RETURN NEXT;
  END LOOP;
END;
$$;
