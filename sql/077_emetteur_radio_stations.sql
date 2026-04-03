-- 077 — Junction table for many-to-many emetteur <-> radio
-- An emitter broadcasts ALL radios in its department (deterministic)

CREATE TABLE IF NOT EXISTS emetteur_radio_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emetteur_id UUID NOT NULL REFERENCES emetteurs_radio(id) ON DELETE CASCADE,
  radio_id UUID NOT NULL REFERENCES radios(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('freq-radio', 'arcom', 'fallback-national', 'manual')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(emetteur_id, radio_id)
);

CREATE INDEX idx_ers_emetteur ON emetteur_radio_stations(emetteur_id);
CREATE INDEX idx_ers_radio ON emetteur_radio_stations(radio_id);
CREATE INDEX idx_ers_source ON emetteur_radio_stations(source);

ALTER TABLE emetteur_radio_stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ers_read" ON emetteur_radio_stations FOR SELECT TO authenticated USING (true);
CREATE POLICY "ers_admin_write" ON emetteur_radio_stations FOR ALL TO service_role USING (true);
