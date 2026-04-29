-- A4.4 — RPC pour la page Custom Bidding (comparaison réel vs simulé).
-- Modèle de simulation linéaire : x_sim = x_real * bid_multiplier (cf doc benchmark A4.2).
-- Appliquée en base via MCP Supabase (apply_migration name='a4_4_get_strategy_comparison_data').

CREATE OR REPLACE FUNCTION public.get_strategy_comparison_data(
  p_strategy_id UUID,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  postal_code TEXT,
  country_code TEXT,
  date DATE,
  impressions_real BIGINT,
  clicks_real BIGINT,
  spend_real NUMERIC,
  leads_real INT,
  bid_multiplier NUMERIC,
  impressions_sim BIGINT,
  clicks_sim BIGINT,
  spend_sim NUMERIC,
  leads_sim INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_campaign_id UUID;
BEGIN
  SELECT campaign_id INTO v_campaign_id
  FROM bidding_strategies WHERE id = p_strategy_id;

  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Strategy % not found', p_strategy_id;
  END IF;

  RETURN QUERY
  WITH multipliers AS (
    SELECT bzc.postal_code, bzc.country_code, bzc.bid_multiplier
    FROM bidding_zone_configs bzc
    WHERE bzc.strategy_id = p_strategy_id AND bzc.is_active = true
  )
  SELECT
    dcd.postal_code,
    COALESCE(dcd.country, 'FR')::TEXT AS country_code,
    dcd.date,
    dcd.impressions::BIGINT,
    dcd.clicks::BIGINT,
    dcd.spend::NUMERIC,
    COALESCE((dcd.metrics->>'leads')::INT, 0) AS leads_real,
    COALESCE(m.bid_multiplier, 1.0)::NUMERIC AS bid_multiplier,
    (dcd.impressions * COALESCE(m.bid_multiplier, 1.0))::BIGINT AS impressions_sim,
    (dcd.clicks * COALESCE(m.bid_multiplier, 1.0))::BIGINT AS clicks_sim,
    (dcd.spend * COALESCE(m.bid_multiplier, 1.0))::NUMERIC AS spend_sim,
    (COALESCE((dcd.metrics->>'leads')::INT, 0) * COALESCE(m.bid_multiplier, 1.0))::INT AS leads_sim
  FROM dsp_campaign_data dcd
  LEFT JOIN multipliers m
    ON m.postal_code = dcd.postal_code
   AND m.country_code = COALESCE(dcd.country, 'FR')
  WHERE dcd.campaign_id = v_campaign_id
    AND (p_date_from IS NULL OR dcd.date >= p_date_from)
    AND (p_date_to IS NULL OR dcd.date <= p_date_to)
  ORDER BY dcd.date, dcd.postal_code;
END;
$$;

COMMENT ON FUNCTION public.get_strategy_comparison_data IS
  'Retourne les données réelles (sans algo) ET simulées (avec multipliers) pour une stratégie.
   Modèle de simulation linéaire (x_sim = x_real * multiplier). Cf docs benchmark A4.2.';

GRANT EXECUTE ON FUNCTION public.get_strategy_comparison_data(UUID, DATE, DATE) TO authenticated, service_role;
