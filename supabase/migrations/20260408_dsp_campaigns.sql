-- =============================================
-- DSP Campaign Import — Tables, indexes, RPC
-- =============================================

-- ── Campaigns ────────────────────────────────
CREATE TABLE IF NOT EXISTS dsp_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  dsp_source TEXT NOT NULL DEFAULT 'adform',
  advertiser TEXT,
  date_start DATE,
  date_end DATE,
  total_tracked_ads INTEGER DEFAULT 0,
  countries TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- ── Campaign Data (impressions) ──────────────
CREATE TABLE IF NOT EXISTS dsp_campaign_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES dsp_campaigns(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  city TEXT,
  country TEXT NOT NULL,
  postal_code TEXT,
  region TEXT,
  dma_region TEXT,
  tracked_ads INTEGER NOT NULL DEFAULT 0,
  code_iris TEXT,
  code_commune TEXT,
  matched_at TIMESTAMPTZ,
  UNIQUE(campaign_id, date, postal_code, city)
);

CREATE INDEX idx_dsp_data_campaign ON dsp_campaign_data(campaign_id);
CREATE INDEX idx_dsp_data_country ON dsp_campaign_data(country);
CREATE INDEX idx_dsp_data_postal ON dsp_campaign_data(postal_code);
CREATE INDEX idx_dsp_data_iris ON dsp_campaign_data(code_iris) WHERE code_iris IS NOT NULL;

-- ── Postal Code → Commune reference ──────────
CREATE TABLE IF NOT EXISTS postal_code_commune (
  code_postal TEXT NOT NULL,
  code_commune TEXT NOT NULL,
  nom_commune TEXT,
  PRIMARY KEY (code_postal, code_commune)
);

CREATE INDEX idx_postal_code ON postal_code_commune(code_postal);

-- ── IRIS Matching RPC ────────────────────────
CREATE OR REPLACE FUNCTION match_campaign_postal_to_iris(p_campaign_id UUID)
RETURNS INTEGER AS $$
DECLARE
  matched_count INTEGER;
BEGIN
  UPDATE dsp_campaign_data d
  SET code_commune = sub.code_commune,
      code_iris = sub.code_iris,
      matched_at = NOW()
  FROM (
    SELECT DISTINCT ON (d2.id) d2.id, i.code_commune, i.code_iris
    FROM dsp_campaign_data d2
    JOIN postal_code_commune pc ON pc.code_postal = d2.postal_code
    JOIN iris i ON i.code_commune = pc.code_commune
    WHERE d2.campaign_id = p_campaign_id
      AND d2.country = 'France'
      AND d2.code_iris IS NULL
    ORDER BY d2.id, i.population DESC NULLS LAST
  ) sub
  WHERE d.id = sub.id;

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  RETURN matched_count;
END;
$$ LANGUAGE plpgsql;
