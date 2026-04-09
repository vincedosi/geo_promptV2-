-- Lightweight impression stats with percentiles for dynamic palette calibration
CREATE OR REPLACE FUNCTION get_dsp_impression_stats(
  p_campaign_id UUID
)
RETURNS JSON AS $$
SELECT json_build_object(
  'min', ROUND(MIN(impressions)::numeric),
  'max', ROUND(MAX(impressions)::numeric),
  'median', ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY impressions))::numeric),
  'p75', ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY impressions))::numeric),
  'p90', ROUND((PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY impressions))::numeric),
  'p95', ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY impressions))::numeric),
  'total_impressions', ROUND(SUM(impressions)::numeric),
  'zones_count', COUNT(*)
)
FROM v_dsp_iris_equity
WHERE campaign_id = p_campaign_id;
$$ LANGUAGE sql;
