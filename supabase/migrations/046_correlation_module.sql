-- ============================================
-- Module Corrélation IRIS × POI  (migration 046)
-- Table source : iris (code_dept, geom, colonnes démographiques)
-- Table POI    : poi_france (id uuid, geom, categorie)
-- Colonnes peuplées : population, pop_0_14..pop_75_plus, nb_csp_*
-- ============================================

-- 1. Catégories POI dynamiques avec comptage
CREATE OR REPLACE FUNCTION get_poi_categories()
RETURNS TABLE(key TEXT, label TEXT, count BIGINT, icon TEXT)
LANGUAGE sql STABLE AS $$
  SELECT
    categorie AS key,
    INITCAP(REPLACE(categorie, '_', ' ')) AS label,
    COUNT(*) AS count,
    CASE categorie
      WHEN 'lycee'           THEN '🏫'
      WHEN 'arret_transport' THEN '🚏'
      WHEN 'medecin'         THEN '🩺'
      WHEN 'pharmacie'       THEN '💊'
      WHEN 'restaurant'      THEN '🍽️'
      WHEN 'banque'          THEN '🏦'
      WHEN 'supermarche'     THEN '🛒'
      WHEN 'cirfa'           THEN '🎖️'
      ELSE '📍'
    END AS icon
  FROM poi_france
  WHERE categorie IS NOT NULL
  GROUP BY categorie
  ORDER BY count DESC;
$$;

-- 2. Jointure spatiale POI × IRIS avec métrique dynamique
-- p_deps  : array de codes département (ex: ARRAY['29','35']) — prioritaire sur p_dep
-- p_dep   : code département unique (compat ascendante)
-- ORDER BY random() → échantillonnage aléatoire, couverture nationale (pas séquentiel par dept !)
CREATE OR REPLACE FUNCTION correlation_poi_iris(
  p_poi_category TEXT,
  p_iris_metric  TEXT    DEFAULT 'population',
  p_dep          TEXT    DEFAULT NULL,
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
  IF p_iris_metric NOT IN (
    'rev_median', 'population',
    'pop_0_14', 'pop_15_29', 'pop_30_44', 'pop_45_59', 'pop_60_74', 'pop_75_plus',
    'taux_chomage', 'taux_proprio', 'taux_diplome_sup',
    'nb_menages', 'nb_csp_cadre', 'nb_csp_employe', 'nb_csp_ouvrier'
  ) THEN
    RAISE EXCEPTION 'Métrique non autorisée: %', p_iris_metric;
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
     WHERE (
       CASE
         WHEN $2 IS NOT NULL THEN i.code_dept = ANY($2)
         WHEN $3 IS NOT NULL THEN i.code_dept = $3
         ELSE TRUE
       END
     )
       AND i.%I IS NOT NULL
       AND i.%I > 0
     GROUP BY i.code_iris, i.nom_iris, i.%I, i.centroid_lat, i.centroid_lng
     ORDER BY random()
     LIMIT $4',
    p_iris_metric, p_iris_metric, p_iris_metric, p_iris_metric
  ) USING p_poi_category, p_deps, p_dep, p_limit;
END;
$$;

-- 3. Métriques IRIS disponibles (colonnes réellement peuplées)
CREATE OR REPLACE FUNCTION get_iris_metric_columns()
RETURNS TABLE(key TEXT, label TEXT, source TEXT, icon TEXT)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (VALUES
    ('population',     'Population totale',      'iris', '👥'),
    ('pop_0_14',       'Population 0-14 ans',    'iris', '👶'),
    ('pop_15_29',      'Population 15-29 ans',   'iris', '🎓'),
    ('pop_30_44',      'Population 30-44 ans',   'iris', '💼'),
    ('pop_45_59',      'Population 45-59 ans',   'iris', '👔'),
    ('pop_60_74',      'Population 60-74 ans',   'iris', '🏡'),
    ('pop_75_plus',    'Population 75 ans et +', 'iris', '🏡'),
    ('nb_csp_cadre',   'Cadres (effectif)',       'iris', '💼'),
    ('nb_csp_employe', 'Employés (effectif)',     'iris', '👷'),
    ('nb_csp_ouvrier', 'Ouvriers (effectif)',     'iris', '🔧')
  ) AS t(key, label, source, icon);
$$;

-- 4. Index pour performance jointure spatiale
CREATE INDEX IF NOT EXISTS idx_poi_france_categorie ON poi_france(categorie);
CREATE INDEX IF NOT EXISTS idx_poi_france_geom_cat  ON poi_france USING gist(geom) WHERE categorie IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iris_code_dept        ON iris(code_dept);
