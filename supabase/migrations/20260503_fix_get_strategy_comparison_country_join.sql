-- Fix: bidding_zone_configs.country_code stocke des codes ISO-2 ('FR', 'RE'...)
-- alors que dsp_campaign_data.country stocke des noms longs DSP ('France',
-- 'Reunion', 'Martinique'...). Le JOIN précédent (m.country_code = COALESCE(dcd.country, 'FR'))
-- ne matchait JAMAIS les rows 'France' → bid_multiplier toujours NULL → COALESCE(_, 1.0)
-- → impressions_sim = impressions_real → DualMap (carte before/after) affichait des
-- valeurs identiques pour toutes les régions.
--
-- Fix : normaliser dcd.country vers ISO-2 dans une CTE avant le JOIN.

CREATE OR REPLACE FUNCTION public.get_strategy_comparison_data(
  p_strategy_id uuid,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date
)
RETURNS TABLE(
  postal_code text, country_code text, date date,
  impressions_real bigint, clicks_real bigint, spend_real numeric, leads_real integer,
  bid_multiplier numeric,
  impressions_sim bigint, clicks_sim bigint, spend_sim numeric, leads_sim integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  ),
  -- Normalisation country : DSP (Adform/DV360/...) stocke des noms longs.
  -- bidding_zone_configs stocke des ISO-2. On normalise les pays France + DROM/COM.
  -- Sans cette CTE, AUCUN multiplicateur ne s'applique pour 'France' (bug DualMap).
  dcd_norm AS (
    SELECT
      dcd.postal_code,
      dcd.date,
      dcd.impressions,
      dcd.clicks,
      dcd.spend,
      dcd.metrics,
      CASE
        WHEN dcd.country IS NULL                       THEN 'FR'
        WHEN dcd.country = 'France'                    THEN 'FR'
        WHEN dcd.country = 'Reunion'                   THEN 'RE'
        WHEN dcd.country = 'Martinique'                THEN 'MQ'
        WHEN dcd.country = 'Guadeloupe'                THEN 'GP'
        WHEN dcd.country = 'French Guiana'             THEN 'GF'
        WHEN dcd.country = 'Mayotte'                   THEN 'YT'
        WHEN dcd.country = 'New Caledonia'             THEN 'NC'
        WHEN dcd.country = 'French Polynesia'          THEN 'PF'
        WHEN dcd.country = 'Saint Martin'              THEN 'MF'
        WHEN dcd.country = 'Saint Barthelemy'          THEN 'BL'
        WHEN dcd.country = 'Wallis And Futuna Islands' THEN 'WF'
        WHEN dcd.country = 'St. Pierre And Miquelon'   THEN 'PM'
        WHEN length(dcd.country) = 2                   THEN dcd.country
        ELSE dcd.country
      END AS country_code
    FROM dsp_campaign_data dcd
    WHERE dcd.campaign_id = v_campaign_id
      AND (p_date_from IS NULL OR dcd.date >= p_date_from)
      AND (p_date_to   IS NULL OR dcd.date <= p_date_to)
  )
  SELECT
    dcd.postal_code,
    dcd.country_code,
    dcd.date,
    dcd.impressions::BIGINT,
    dcd.clicks::BIGINT,
    dcd.spend::NUMERIC,
    COALESCE((dcd.metrics->>'leads')::INT, 0) AS leads_real,
    COALESCE(m.bid_multiplier, 1.0)::NUMERIC AS bid_multiplier,
    (dcd.impressions * COALESCE(m.bid_multiplier, 1.0))::BIGINT AS impressions_sim,
    (dcd.clicks      * COALESCE(m.bid_multiplier, 1.0))::BIGINT AS clicks_sim,
    (dcd.spend       * COALESCE(m.bid_multiplier, 1.0))::NUMERIC AS spend_sim,
    (COALESCE((dcd.metrics->>'leads')::INT, 0) * COALESCE(m.bid_multiplier, 1.0))::INT AS leads_sim
  FROM dcd_norm dcd
  LEFT JOIN multipliers m
    ON m.postal_code  = dcd.postal_code
   AND m.country_code = dcd.country_code
  ORDER BY dcd.date, dcd.postal_code;
END;
$function$;
