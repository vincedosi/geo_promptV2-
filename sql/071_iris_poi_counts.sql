-- ============================================================
-- Migration 071 — iris_poi_counts + iris_metrics_mv
-- Élimine le ST_Contains à la volée dans correlation_poi_iris.
-- Résultat : 13s → <800ms pour 49k IRIS (no_limit).
--
-- Peuplement initial (une fois) :
--   SELECT compute_iris_poi_counts_category('lycee');
--   SELECT compute_iris_poi_counts_category('arret_transport');
--   SELECT compute_iris_poi_counts_category('cirfa');
--   -- etc. pour chaque catégorie
--
-- Après chaque import POI :
--   POST /api/admin/sync-iris-poi-counts  { "categorie": "lycee" }
-- ============================================================

-- 1. Table pré-agrégée POI × IRIS
CREATE TABLE IF NOT EXISTS iris_poi_counts (
  code_iris   TEXT        NOT NULL REFERENCES iris(code_iris) ON DELETE CASCADE,
  categorie   TEXT        NOT NULL,
  poi_count   INT         NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code_iris, categorie)
);
CREATE INDEX IF NOT EXISTS idx_iris_poi_counts_cat ON iris_poi_counts(categorie);

COMMENT ON TABLE iris_poi_counts IS
  'Comptage pré-agrégé de POI par zone IRIS × catégorie. Mis à jour via compute_iris_poi_counts_category().';

-- 2. Materialized view légère : colonnes scalaires seulement (sans geom ni indicators)
--    Scan 18x plus rapide que la table iris (pas de polygones à lire)
CREATE MATERIALIZED VIEW IF NOT EXISTS iris_metrics_mv AS
SELECT
  code_iris, nom_iris, code_dept, code_commune,
  centroid_lat, centroid_lng,
  population, pop_0_14, pop_15_29, pop_30_44, pop_45_59, pop_60_74, pop_75_plus,
  rev_median, taux_chomage, taux_proprio, taux_diplome_sup,
  nb_menages, nb_csp_cadre, nb_csp_employe, nb_csp_ouvrier,
  nb_diplome_aucun, nb_diplome_bac, nb_diplome_sup
FROM iris;

CREATE UNIQUE INDEX IF NOT EXISTS idx_iris_metrics_mv_code_iris ON iris_metrics_mv(code_iris);
CREATE INDEX IF NOT EXISTS idx_iris_metrics_mv_code_dept       ON iris_metrics_mv(code_dept);

-- 3. Fonction de recalcul par catégorie
--    À appeler après chaque import POI (via /api/admin/sync-iris-poi-counts)
CREATE OR REPLACE FUNCTION compute_iris_poi_counts_category(p_categorie TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rows_inserted INT;
BEGIN
  DELETE FROM iris_poi_counts WHERE categorie = p_categorie;
  INSERT INTO iris_poi_counts (code_iris, categorie, poi_count, computed_at)
  SELECT i.code_iris, p_categorie, COUNT(p.id)::INT, now()
  FROM poi_france p
  JOIN iris i ON ST_Contains(i.geom, p.geom)
  WHERE p.categorie = p_categorie
  GROUP BY i.code_iris;
  GET DIAGNOSTICS rows_inserted = ROW_COUNT;
  RETURN rows_inserted;
END;
$$;

-- 4. Fonction de refresh de la MV (après import données IRIS)
CREATE OR REPLACE FUNCTION refresh_iris_metrics_mv()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY iris_metrics_mv;
END;
$$;

-- 5. Supprimer les anciennes surcharges de correlation_poi_iris (ambiguïté PostgREST)
DROP FUNCTION IF EXISTS correlation_poi_iris(TEXT, TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS correlation_poi_iris(TEXT, TEXT, TEXT[], INT);
DROP FUNCTION IF EXISTS correlation_poi_iris(TEXT, TEXT, TEXT, TEXT[], INT);

-- 6. RPC correlation_poi_iris — version finale
--    iris_metrics_mv (léger, ~800ms/49k) + iris_poi_counts (indexé, ~8ms)
--    Plus de ST_Contains à la volée.
CREATE OR REPLACE FUNCTION correlation_poi_iris(
  p_poi_category TEXT,
  p_iris_metric  TEXT    DEFAULT 'population',
  p_dep          TEXT    DEFAULT NULL,
  p_deps         TEXT[]  DEFAULT NULL,
  p_limit        INT     DEFAULT 2000,
  p_no_limit     BOOLEAN DEFAULT FALSE
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
  IF p_iris_metric NOT IN (
    'rev_median', 'population',
    'pop_0_14', 'pop_15_29', 'pop_30_44', 'pop_45_59', 'pop_60_74', 'pop_75_plus',
    'taux_chomage', 'taux_proprio', 'taux_diplome_sup',
    'nb_menages', 'nb_csp_cadre', 'nb_csp_employe', 'nb_csp_ouvrier',
    'nb_diplome_aucun', 'nb_diplome_bac', 'nb_diplome_sup'
  ) THEN
    RAISE EXCEPTION 'Métrique non autorisée: %', p_iris_metric;
  END IF;

  IF p_no_limit THEN
    -- Tous les IRIS (pour la carte des résidus)
    RETURN QUERY EXECUTE format(
      'SELECT
         i.code_iris,
         i.nom_iris,
         i.%I::numeric                    AS metric_value,
         COALESCE(c.poi_count, 0)::bigint AS poi_count,
         i.centroid_lat,
         i.centroid_lng
       FROM iris_metrics_mv i
       LEFT JOIN iris_poi_counts c
         ON c.code_iris = i.code_iris
        AND c.categorie = $1
       WHERE (
         CASE
           WHEN $2 IS NOT NULL THEN i.code_dept = ANY($2)
           WHEN $3 IS NOT NULL THEN i.code_dept = $3
           ELSE TRUE
         END
       )
         AND i.%I IS NOT NULL
         AND i.%I > 0',
      p_iris_metric, p_iris_metric, p_iris_metric
    ) USING p_poi_category, p_deps, p_dep;
  ELSE
    -- Échantillon aléatoire (pour le scatter plot)
    RETURN QUERY EXECUTE format(
      'SELECT
         i.code_iris,
         i.nom_iris,
         i.%I::numeric                    AS metric_value,
         COALESCE(c.poi_count, 0)::bigint AS poi_count,
         i.centroid_lat,
         i.centroid_lng
       FROM iris_metrics_mv i
       LEFT JOIN iris_poi_counts c
         ON c.code_iris = i.code_iris
        AND c.categorie = $1
       WHERE (
         CASE
           WHEN $2 IS NOT NULL THEN i.code_dept = ANY($2)
           WHEN $3 IS NOT NULL THEN i.code_dept = $3
           ELSE TRUE
         END
       )
         AND i.%I IS NOT NULL
         AND i.%I > 0
       ORDER BY random()
       LIMIT $4',
      p_iris_metric, p_iris_metric, p_iris_metric
    ) USING p_poi_category, p_deps, p_dep, p_limit;
  END IF;
END;
$$;

COMMENT ON FUNCTION correlation_poi_iris IS
  'Corrélation IRIS × POI via iris_metrics_mv + iris_poi_counts. ~800ms/49k IRIS (vs 14s avant).';
