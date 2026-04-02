ALTER TABLE radios ADD COLUMN IF NOT EXISTS parent_radio_id UUID REFERENCES radios(id);
CREATE INDEX IF NOT EXISTS idx_radios_parent ON radios(parent_radio_id);
