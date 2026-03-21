-- ============================================================
-- 058 — Smart Prompt : data_registry + RPCs PostGIS
-- ============================================================
-- Routeur multi-agents GEO.Prompt v7.4.0
-- Exécuter dans Supabase Dashboard > SQL Editor

-- ------------------------------------------------------------
-- Table : registre des données disponibles pour le routeur IA
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_registry (
  id          serial       PRIMARY KEY,
  slug        text         UNIQUE NOT NULL,
  label       text         NOT NULL,
  category    text         NOT NULL, -- 'poi' | 'demographie' | 'ooh' | 'clustering'
  description text,
  metadata    jsonb        NOT NULL DEFAULT '{}',
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

-- RLS désactivé : accès service_role uniquement via API
ALTER TABLE data_registry DISABLE ROW LEVEL SECURITY;
GRANT SELECT ON data_registry TO service_role;

-- ------------------------------------------------------------
-- RPC : retourne le registre actif (routeur IA)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_active_data_registry()
RETURNS TABLE(slug text, label text, category text, description text, metadata jsonb)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT slug, label, category, description, metadata
  FROM data_registry
  WHERE is_active = true
  ORDER BY category, label;
$$;

GRANT EXECUTE ON FUNCTION get_active_data_registry() TO service_role;

-- ------------------------------------------------------------
-- RPC : statistiques démographiques Filosofi autour d'un point
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION smart_demographie_stats(
  p_lat        float8,
  p_lng        float8,
  p_indicateur text    DEFAULT 'ind_snv',
  p_rayon_km   float8  DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_center  geometry;
  v_result  jsonb;
  v_col_val text;
BEGIN
  v_center := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  SELECT jsonb_build_object(
    'indicateur',  p_indicateur,
    'rayon_km',    p_rayon_km,
    'nb_carreaux', COUNT(*),
    'total',       ROUND(COALESCE(SUM((metadata->>p_indicateur)::float), 0)::numeric, 1),
    'moyenne',     ROUND(COALESCE(AVG((metadata->>p_indicateur)::float), 0)::numeric, 1),
    'mediane',     ROUND(COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (
                     ORDER BY (metadata->>p_indicateur)::float
                   ), 0)::numeric, 1),
    'max',         ROUND(COALESCE(MAX((metadata->>p_indicateur)::float), 0)::numeric, 1),
    'min',         ROUND(COALESCE(MIN((metadata->>p_indicateur)::float), 0)::numeric, 1)
  )
  INTO v_result
  FROM carreaux_filosofi
  WHERE ST_DWithin(
    geom::geography,
    v_center::geography,
    p_rayon_km * 1000
  )
  AND metadata->>p_indicateur IS NOT NULL
  AND (metadata->>p_indicateur)::float > 0;

  IF v_result IS NULL OR (v_result->>'nb_carreaux')::int = 0 THEN
    RETURN jsonb_build_object('error', 'Aucun carreau Filosofi trouvé dans ce rayon');
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION smart_demographie_stats(float8, float8, text, float8) TO service_role;

-- ------------------------------------------------------------
-- RPC : classement démographique multi-indicateurs autour d'un point
-- Retourne les N carreaux les plus élevés pour un indicateur
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION smart_demographie_ranking(
  p_lat        float8,
  p_lng        float8,
  p_indicateur text    DEFAULT 'ind_snv',
  p_rayon_km   float8  DEFAULT 10,
  p_limit      int     DEFAULT 10
)
RETURNS TABLE(
  carreau_id  text,
  valeur      float8,
  lat_centre  float8,
  lng_centre  float8
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_center geometry;
BEGIN
  v_center := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  RETURN QUERY
  SELECT
    id::text,
    (metadata->>p_indicateur)::float AS valeur,
    ST_Y(ST_Centroid(geom))::float8  AS lat_centre,
    ST_X(ST_Centroid(geom))::float8  AS lng_centre
  FROM carreaux_filosofi
  WHERE ST_DWithin(
    geom::geography,
    v_center::geography,
    p_rayon_km * 1000
  )
  AND metadata->>p_indicateur IS NOT NULL
  AND (metadata->>p_indicateur)::float > 0
  ORDER BY valeur DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION smart_demographie_ranking(float8, float8, text, float8, int) TO service_role;

-- ------------------------------------------------------------
-- RPC : statistiques POI par catégorie (+ ville optionnelle)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION smart_poi_stats(
  p_categorie text,
  p_ville     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'categorie',     p_categorie,
    'ville',         p_ville,
    'total',         COUNT(*),
    'nb_villes',     COUNT(DISTINCT ville),
    'nb_regions',    COUNT(DISTINCT region),
    'top_villes',    (
      SELECT jsonb_agg(v) FROM (
        SELECT jsonb_build_object('ville', ville, 'count', COUNT(*))  AS v
        FROM poi_france p2
        WHERE lower(p2.categorie) = lower(p_categorie)
          AND (p_ville IS NULL OR lower(p2.ville) = lower(p_ville))
          AND p2.ville IS NOT NULL
        GROUP BY ville
        ORDER BY COUNT(*) DESC
        LIMIT 5
      ) t
    )
  )
  INTO v_result
  FROM poi_france
  WHERE lower(categorie) = lower(p_categorie)
    AND (p_ville IS NULL OR lower(ville) = lower(p_ville));

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION smart_poi_stats(text, text) TO service_role;

-- ------------------------------------------------------------
-- RPC : POI proches d'un point géographique
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION smart_poi_nearby(
  p_lat       float8,
  p_lng       float8,
  p_rayon_m   float8  DEFAULT 1000,
  p_categorie text    DEFAULT NULL
)
RETURNS TABLE(
  id          text,
  nom         text,
  lat         float8,
  lng         float8,
  categorie   text,
  ville       text,
  distance_m  float8
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_center geometry;
BEGIN
  v_center := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  RETURN QUERY
  SELECT
    p.id::text,
    p.nom,
    p.lat,
    p.lng,
    p.categorie,
    p.ville,
    ST_Distance(
      ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
      v_center::geography
    ) AS distance_m
  FROM poi_france p
  WHERE ST_DWithin(
    ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
    v_center::geography,
    p_rayon_m
  )
  AND (p_categorie IS NULL OR lower(p.categorie) = lower(p_categorie))
  ORDER BY distance_m
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION smart_poi_nearby(float8, float8, float8, text) TO service_role;

-- ------------------------------------------------------------
-- Seed : données initiales du registre
-- ------------------------------------------------------------
INSERT INTO data_registry (slug, label, category, description, metadata) VALUES
  ('demographie_revenu',     'Revenu médian (Filosofi)',     'demographie', 'Revenu médian par carreau INSEE 200m — source Filosofi 2019',           '{"indicateur": "ind_snv", "unite": "€/an"}'),
  ('demographie_population', 'Population totale (Filosofi)', 'demographie', 'Population totale estimée par carreau INSEE 200m',                      '{"indicateur": "ind",     "unite": "personnes"}'),
  ('demographie_seniors',    'Seniors 65+ (Filosofi)',       'demographie', 'Population âgée de 65 ans et plus par carreau',                         '{"indicateur": "ind_65_79", "unite": "personnes"}'),
  ('demographie_jeunes',     'Jeunes 18-24 ans (Filosofi)', 'demographie', 'Population jeune adulte 18-24 ans par carreau',                         '{"indicateur": "ind_18_24", "unite": "personnes"}'),
  ('demographie_actifs',     'Actifs 25-54 ans (Filosofi)', 'demographie', 'Population active 25-54 ans (ind_25_39 + ind_40_54) par carreau',       '{"indicateur": "ind_25_39", "unite": "personnes"}'),
  ('demographie_pauvrete',   'Ménages pauvres (Filosofi)',   'demographie', 'Ménages en situation de pauvreté par carreau',                          '{"indicateur": "men_pauv", "unite": "ménages"}'),
  ('demographie_familles',   'Familles monoparentales',      'demographie', 'Ménages familles monoparentales par carreau',                           '{"indicateur": "men_fmp",  "unite": "ménages"}'),
  ('poi_tous',               'Tous les POI (base nationale)','poi',         'Points d''intérêt de la base nationale — toutes catégories confondues', '{"table": "poi_france"}'),
  ('ooh_panneaux',           'Panneaux OOH/DOOH',            'ooh',         'Base nationale panneaux affichage (JCDecaux, Clear Channel, Exterion)', '{"table": "global_ooh", "filtre": "statut=actif"}'),
  ('clustering_modeles',     'Modèles clustering POI×Filosofi','clustering','Segmentation K-Means POI × données Filosofi avec analyse Gemini IA',    '{"table": "clustering_models"}')
ON CONFLICT (slug) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      metadata    = EXCLUDED.metadata,
      is_active   = true;
