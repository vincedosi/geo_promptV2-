-- ============================================================
-- 050_cluster_history.sql
-- Phase 5 : Historisation des clusters POI
--
-- 1. Table poi_cluster_history
-- 2. Index
-- 3. Colonne cluster_mapping_from_previous sur clustering_models
-- ============================================================

-- 1. Table historique
CREATE TABLE IF NOT EXISTS poi_cluster_history (
  id                   SERIAL PRIMARY KEY,
  poi_id               UUID NOT NULL,
  cluster_id           INTEGER NOT NULL,
  cluster_label        TEXT,
  model_version        INTEGER NOT NULL,
  profile_features     JSONB,
  pca_components       JSONB,
  distance_to_centroid NUMERIC,
  action               TEXT NOT NULL,       -- 'full-retrain' | 'assign-new' | 'update-affected' | 'pipeline-new'
  previous_cluster_id  INTEGER,             -- NULL si première assignation (numbering ancien modèle)
  changed              BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Index
CREATE INDEX IF NOT EXISTS idx_cluster_history_poi
  ON poi_cluster_history(poi_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cluster_history_version
  ON poi_cluster_history(model_version);

-- 3. Colonne cluster_mapping_from_previous sur clustering_models
ALTER TABLE clustering_models
  ADD COLUMN IF NOT EXISTS cluster_mapping_from_previous JSONB DEFAULT NULL;

COMMENT ON TABLE poi_cluster_history IS
  'Historique de toutes les assignations de cluster pour chaque POI. '
  'Permet de tracker les changements entre versions de modèle.';

COMMENT ON COLUMN poi_cluster_history.previous_cluster_id IS
  'Cluster ID précédent dans le numbering de l''ANCIEN modèle. '
  'NULL si première assignation.';

COMMENT ON COLUMN poi_cluster_history.changed IS
  'TRUE si le cluster a changé sémantiquement par rapport à la ligne précédente '
  '(tient compte du mapping inter-versions après full-retrain).';

COMMENT ON COLUMN clustering_models.cluster_mapping_from_previous IS
  'Correspondance anciens clusters -> nouveaux clusters calculée par algorithme hongrois. '
  'Format : {"0": 2, "1": 0, "2": 3, ...} (old_cluster_id -> new_cluster_id). '
  'NULL si premier modèle ou si recalcul impossible.';
