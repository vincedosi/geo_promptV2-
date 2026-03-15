-- ═══════════════════════════════════════════════════════════════════════════
-- 018_calculation_jobs_breakdown.sql
--
-- Ajoute la colonne breakdown JSONB à calculation_jobs.
-- Stocke le classement détaillé par POI après compute_coverage_per_poi.
-- Format : [{ "id": "uuid", "nom": "CIRFA Paris", "audience": 1234567 }, ...]
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE calculation_jobs
  ADD COLUMN IF NOT EXISTS breakdown JSONB;

COMMENT ON COLUMN calculation_jobs.breakdown IS
  'Classement détaillé par POI : [{id, nom, audience}] trié par audience DESC';
