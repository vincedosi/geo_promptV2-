-- =============================================
-- RPC: Aggregated stats for all DSP campaigns
-- Avoids N+1 COUNT queries on dsp_campaign_data (280k+ rows)
-- =============================================

CREATE OR REPLACE FUNCTION get_dsp_campaign_stats()
RETURNS TABLE (
  campaign_id UUID,
  total_rows BIGINT,
  france_rows BIGINT,
  matched_iris BIGINT
) AS $$
  SELECT
    d.campaign_id,
    COUNT(*)::BIGINT AS total_rows,
    COUNT(*) FILTER (WHERE d.country = 'France')::BIGINT AS france_rows,
    COUNT(*) FILTER (WHERE d.code_iris IS NOT NULL)::BIGINT AS matched_iris
  FROM dsp_campaign_data d
  GROUP BY d.campaign_id;
$$ LANGUAGE sql STABLE;
