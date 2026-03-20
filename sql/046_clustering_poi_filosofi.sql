-- ============================================================
-- 046_clustering_poi_filosofi.sql
-- Tables pour le clustering POI par profil sociodémographique
-- Filosofi. Ne PAS modifier les fonctions battle_*.
-- ============================================================

-- Table des modèles persistés (StandardScaler + PCA + KMeans)
CREATE TABLE IF NOT EXISTS clustering_models (
  id                  SERIAL PRIMARY KEY,
  version             INTEGER UNIQUE NOT NULL,
  k                   INTEGER NOT NULL,
  silhouette_score    NUMERIC,
  n_pca_components    INTEGER,
  variance_explained  NUMERIC,
  feature_names       JSONB NOT NULL,          -- ["pct_0_17", "pct_18_39", ...]
  scaler_mean         JSONB NOT NULL,          -- StandardScaler.mean_.tolist()
  scaler_scale        JSONB NOT NULL,          -- StandardScaler.scale_.tolist()
  pca_components      JSONB NOT NULL,          -- PCA.components_.tolist() (2D)
  pca_mean            JSONB NOT NULL,          -- PCA.mean_.tolist()
  centroids           JSONB NOT NULL,          -- KMeans.cluster_centers_.tolist() (2D)
  cluster_labels      JSONB NOT NULL,          -- {"0": "Jeune urbain / revenus modestes", ...}
  cluster_avg_profiles JSONB NOT NULL,         -- {"0": {"pct_0_17": 0.18, ...}, ...}
  n_poi_trained       INTEGER,
  duration_minutes    INTEGER NOT NULL DEFAULT 60,
  mode                TEXT    NOT NULL DEFAULT 'drive',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE clustering_models IS
  'Modèles KMeans persistés pour le clustering POI par profil Filosofi.
   Permet de reconstruire scaler.transform() + pca.transform() + predict()
   sans sklearn, juste avec numpy.';

-- Table des clusters par POI
CREATE TABLE IF NOT EXISTS poi_clusters (
  id                          SERIAL PRIMARY KEY,
  poi_id                      UUID NOT NULL REFERENCES poi_france(id) ON DELETE CASCADE,
  cluster_id                  INTEGER NOT NULL,
  cluster_label               TEXT,
  pca_components              JSONB,           -- [x, y, ...] coordonnées PCA pour visu
  profile_features            JSONB,           -- vecteur de profil complet (les ratios)
  cluster_avg_profile         JSONB,           -- profil moyen du cluster
  n_carreaux_intersected      INTEGER,
  population_totale_couverte  NUMERIC,
  model_version               INTEGER NOT NULL DEFAULT 1,
  duration_minutes            INTEGER NOT NULL DEFAULT 60,
  mode                        TEXT    NOT NULL DEFAULT 'drive',
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (poi_id, duration_minutes, mode)
);

COMMENT ON TABLE poi_clusters IS
  'Résultats du clustering POI Filosofi — un enregistrement par POI × durée × mode.
   Mis à jour incrémentalement par le script Python.';

CREATE INDEX IF NOT EXISTS idx_poi_clusters_poi_id       ON poi_clusters(poi_id);
CREATE INDEX IF NOT EXISTS idx_poi_clusters_cluster_id   ON poi_clusters(cluster_id);
CREATE INDEX IF NOT EXISTS idx_poi_clusters_model_version ON poi_clusters(model_version);
CREATE INDEX IF NOT EXISTS idx_poi_clusters_duration      ON poi_clusters(duration_minutes, mode);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION fn_poi_clusters_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_poi_clusters_updated_at ON poi_clusters;
CREATE TRIGGER trg_poi_clusters_updated_at
  BEFORE UPDATE ON poi_clusters
  FOR EACH ROW EXECUTE FUNCTION fn_poi_clusters_updated_at();

-- S'assurer que carreaux_filosofi a bien une colonne created_at
-- (déjà présente d'après la Phase 1, mais on le garantit)
ALTER TABLE carreaux_filosofi
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
