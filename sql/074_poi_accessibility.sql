-- ============================================================
-- Migration 074 — Gaussian POI accessibility scoring
-- Remplace iris_poi_counts (ST_Contains count) par un score
-- d'accessibilité continu : Σ exp(-d²ᵢⱼ / (2σ²))
-- ============================================================

-- ── 1. Table de configuration sigma par catégorie ──────────

CREATE TABLE IF NOT EXISTS poi_accessibility_config (
  categorie   TEXT PRIMARY KEY,
  sigma_km    FLOAT NOT NULL DEFAULT 5.0,
  label       TEXT,
  description TEXT
);

INSERT INTO poi_accessibility_config (categorie, sigma_km, label, description) VALUES
  ('arret_transport', 0.5,  'Arrêts de transport',   'Accessibilité pied — zone de chalandise 500m'),
  ('pharmacie',       1.0,  'Pharmacies',            'Accessibilité de proximité — 1 km'),
  ('medecin',         1.5,  'Médecins',              'Accessibilité de soins primaires — 1.5 km'),
  ('supermarche',     3.0,  'Supermarchés',          'Accessibilité commerciale — 3 km'),
  ('lycee',           5.0,  'Lycées',                'Accessibilité éducation secondaire — 5 km'),
  ('cirfa',           15.0, 'CIRFA (Armée)',         'Accessibilité recrutement militaire — 15 km')
ON CONFLICT (categorie) DO UPDATE
  SET sigma_km    = EXCLUDED.sigma_km,
      label       = EXCLUDED.label,
      description = EXCLUDED.description;

COMMENT ON TABLE poi_accessibility_config IS
  'Paramètres σ (km) pour le score d''accessibilité Gaussien par catégorie POI.';

-- ── 2. Whitelist partagée des métriques IRIS ───────────────

-- (même liste que correlation_iris_iris)

-- ── 3. compute_poi_accessibility — version scatter (avec LIMIT) ────────────
-- Requiert un filtre département (p_dep ou p_deps) — France-wide non supporté.
-- Utilise iris.centroid (geography, GIST-indexé) + approximation Euclidienne
-- pour le score Gaussien (évite ST_Distance sur geography, 3× plus rapide).

CREATE OR REPLACE FUNCTION compute_poi_accessibility(
  p_poi_category TEXT,
  p_iris_metric  TEXT,
  p_sigma_km     FLOAT   DEFAULT 5.0,
  p_dep          TEXT    DEFAULT NULL,
  p_deps         TEXT[]  DEFAULT NULL,
  p_limit        INT     DEFAULT 2000,
  p_no_limit     BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  code_iris    TEXT,
  nom_iris     TEXT,
  metric_value NUMERIC,
  poi_count    NUMERIC,
  centroid_lat DOUBLE PRECISION,
  centroid_lng DOUBLE PRECISION
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  allowed  TEXT[] := ARRAY[
    'population','pop_0_14','pop_15_29','pop_30_44','pop_45_59','pop_60_74','pop_75_plus',
    'nb_csp_agri','nb_csp_artisan','nb_csp_cadre','nb_csp_intermediaire',
    'nb_csp_employe','nb_csp_ouvrier','nb_csp_retraite','nb_csp_sans',
    'rev_median','taux_pauvrete','taux_chomage','taux_proprio','taux_locataire',
    'taux_diplome_sup','taux_sans_diplome','menages','logements'
  ];
  sigma_m  FLOAT := p_sigma_km * 1000.0;
  cutoff_m FLOAT := p_sigma_km * 3.0 * 1000.0;
  q        TEXT;
BEGIN
  IF NOT (p_iris_metric = ANY(allowed)) THEN
    RAISE EXCEPTION 'Métrique non autorisée: %', p_iris_metric;
  END IF;

  IF p_dep IS NULL AND p_deps IS NULL AND NOT p_no_limit THEN
    RAISE EXCEPTION 'Un filtre département (p_dep ou p_deps) est requis.';
  END IF;

  -- Euclidean approx (lat/lng arithmetic) — évite ST_Distance geography par paire
  -- Précision <0.1% pour distances <50 km en France métropolitaine
  q := format(
    'SELECT
       m.code_iris,
       i.nom_iris,
       m.%I::numeric                     AS metric_value,
       COALESCE(acc.score, 0.0)::numeric  AS poi_count,
       m.centroid_lat,
       m.centroid_lng
     FROM iris_metrics_mv m
     JOIN iris i ON i.code_iris = m.code_iris
     LEFT JOIN LATERAL (
       SELECT SUM(exp(
         -(
           (111320.0 * (p.lat - i.centroid_lat))^2 +
           (111320.0 * cos(radians(i.centroid_lat)) * (p.lng - i.centroid_lng))^2
         ) / (2.0 * (%s::float8)^2)
       )) AS score
       FROM poi_france p
       WHERE p.categorie = %L
         AND p.lat IS NOT NULL
         AND ST_DWithin(p.geom::geography, i.centroid, %s::float8)
     ) acc ON true
     WHERE m.%I IS NOT NULL
       AND i.centroid IS NOT NULL',
    p_iris_metric,
    sigma_m,
    p_poi_category,
    cutoff_m,
    p_iris_metric
  );

  IF p_deps IS NOT NULL THEN
    q := q || ' AND m.code_dept = ANY($1) AND i.code_dept = ANY($1)';
  ELSIF p_dep IS NOT NULL THEN
    q := q || ' AND m.code_dept = $2 AND i.code_dept = $2';
  END IF;

  IF NOT p_no_limit THEN
    q := q || format(' LIMIT %s', p_limit);
  END IF;

  RETURN QUERY EXECUTE q USING p_deps, p_dep;
END;
$$;

COMMENT ON FUNCTION compute_poi_accessibility IS
  'Score d''accessibilité Gaussien IRIS × POI : Σ exp(-d²/(2σ²)) pour tous les POI dans 3σ km. Requiert filtre dept. poi_count = score (float).';

-- ── 4. get_accessibility_inputs — JSON scalaire (bypass PostgREST max-rows) ─

CREATE OR REPLACE FUNCTION get_accessibility_inputs(
  p_poi_category TEXT,
  p_iris_metric  TEXT,
  p_sigma_km     FLOAT   DEFAULT 5.0,
  p_dep          TEXT    DEFAULT NULL,
  p_deps         TEXT[]  DEFAULT NULL
)
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT *
    FROM compute_poi_accessibility(
      p_poi_category,
      p_iris_metric,
      p_sigma_km,
      p_dep,
      p_deps,
      50000,
      TRUE
    )
  ) t
$$;

COMMENT ON FUNCTION get_accessibility_inputs IS
  'Agrège tous les IRIS (score Gaussien, mode iris_poi) en JSON scalaire pour contourner le max-rows PostgREST.';
