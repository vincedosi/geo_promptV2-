-- ============================================================
-- 049_pipeline_new_trigger.sql
-- Phase 4 : Orchestration isochrone -> clustering auto
--
-- 1. Colonne needs_clustering sur poi
-- 2. Marquer les POI déjà clusterisés comme traités
-- 3. Trigger BEFORE INSERT : flag automatique pour nouveaux POI
-- ============================================================

-- 1. Colonne needs_clustering
ALTER TABLE poi ADD COLUMN IF NOT EXISTS needs_clustering BOOLEAN DEFAULT TRUE;

-- 2. POI déjà dans poi_clusters -> needs_clustering = FALSE
UPDATE poi
SET needs_clustering = FALSE
WHERE id::text IN (
  SELECT poi_id FROM poi_clusters
);

-- 3. Trigger flag automatique
CREATE OR REPLACE FUNCTION flag_new_poi_for_clustering()
RETURNS TRIGGER AS $$
BEGIN
  NEW.needs_clustering := TRUE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_new_poi_clustering ON poi;
CREATE TRIGGER trg_new_poi_clustering
  BEFORE INSERT ON poi
  FOR EACH ROW
  EXECUTE FUNCTION flag_new_poi_for_clustering();

COMMENT ON COLUMN poi.needs_clustering IS
  'TRUE = POI sans cluster ou modifié, à traiter par pipeline-new. '
  'Remis à FALSE par scripts/clustering_poi_filosofi.py --mode pipeline-new.';
