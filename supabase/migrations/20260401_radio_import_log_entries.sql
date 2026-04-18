-- ============================================================
-- Migration — radio_import_log_entries
-- Logs détaillés par phase pour chaque import radio
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_import_log_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_log_id UUID NOT NULL REFERENCES radio_imports_log(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT now(),
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error', 'success')),
  phase TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_log_entries_import ON radio_import_log_entries(import_log_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_level ON radio_import_log_entries(level);

ALTER TABLE radio_import_log_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "log_entries_read" ON radio_import_log_entries FOR SELECT TO authenticated USING (true);
