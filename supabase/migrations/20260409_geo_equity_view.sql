-- Geo-Equity: disaggregate DSP impressions from CP to IRIS level
-- proportionally by population, then compute equity_index

-- View: v_dsp_iris_equity
DROP VIEW IF EXISTS v_dsp_iris_equity;

CREATE OR REPLACE VIEW v_dsp_iris_equity AS
WITH cp_population AS (
  SELECT
    pc.code_postal,
    SUM(i.population) as pop_total_cp
  FROM postal_code_commune pc
  JOIN iris i ON i.code_commune = pc.code_commune
  GROUP BY pc.code_postal
),
impressions_par_iris AS (
  SELECT
    d.campaign_id,
    i.code_iris,
    i.code_commune,
    i.nom_commune,
    i.code_dept,
    i.code_region,
    SUM(
      d.tracked_ads * (i.population::float / NULLIF(cp.pop_total_cp, 0))
    ) as impressions,
    MAX(i.population) as population,
    MAX(i.pop_15_29) as pop_15_29,
    MAX(i.pop_30_44) as pop_30_44,
    MAX(i.nb_csp_cadre) as nb_csp_cadre,
    MAX(i.nb_diplome_sup) as nb_diplome_sup,
    MAX(i.rev_median) as rev_median,
    MAX(i.taux_proprio) as taux_proprio,
    MAX(i.nb_menages) as nb_menages,
    (array_agg(i.geom))[1] as geom
  FROM dsp_campaign_data d
  JOIN postal_code_commune pc ON pc.code_postal = d.postal_code
  JOIN iris i ON i.code_commune = pc.code_commune
  JOIN cp_population cp ON cp.code_postal = d.postal_code
  WHERE d.country = 'France'
    AND i.population > 0
  GROUP BY d.campaign_id, i.code_iris, i.code_commune, i.nom_commune, i.code_dept, i.code_region
)
SELECT
  *,
  CASE
    WHEN population > 0
    THEN ROUND((impressions / population * 1000)::numeric, 2)
    ELSE NULL
  END as equity_index
FROM impressions_par_iris;


-- RPC: get_equity_analysis
-- Returns GeoJSON-ready rows for a campaign, bbox-filtered, with dynamic population field
CREATE OR REPLACE FUNCTION get_equity_analysis(
  p_campaign_id UUID,
  p_population_field TEXT DEFAULT 'population',
  p_bbox float8[] DEFAULT NULL
)
RETURNS TABLE (
  code_iris TEXT,
  nom_commune TEXT,
  code_dept TEXT,
  impressions FLOAT,
  population_cible FLOAT,
  equity_index FLOAT,
  geom GEOMETRY
) AS $$
DECLARE
  allowed_fields TEXT[] := ARRAY['population','pop_15_29','pop_30_44','nb_csp_cadre','nb_diplome_sup','rev_median','taux_proprio','nb_menages'];
  safe_field TEXT;
BEGIN
  IF p_population_field = ANY(allowed_fields) THEN
    safe_field := p_population_field;
  ELSE
    safe_field := 'population';
  END IF;

  RETURN QUERY
  EXECUTE format('
    SELECT
      v.code_iris,
      v.nom_commune,
      v.code_dept,
      v.impressions,
      v.%I::float as population_cible,
      CASE
        WHEN v.%I > 0
        THEN ROUND((v.impressions / v.%I * 1000)::numeric, 2)::float
        ELSE NULL
      END as equity_index,
      v.geom
    FROM v_dsp_iris_equity v
    WHERE v.campaign_id = $1
      AND ($2 IS NULL OR v.geom && ST_MakeEnvelope($2[1], $2[2], $2[3], $2[4], 4326))
  ', safe_field, safe_field, safe_field)
  USING p_campaign_id, p_bbox;
END;
$$ LANGUAGE plpgsql;


-- RPC: get_equity_stats
-- Returns aggregate stats for a campaign + population field
CREATE OR REPLACE FUNCTION get_equity_stats(
  p_campaign_id UUID,
  p_population_field TEXT DEFAULT 'population'
)
RETURNS JSON AS $$
DECLARE
  allowed_fields TEXT[] := ARRAY['population','pop_15_29','pop_30_44','nb_csp_cadre','nb_diplome_sup','rev_median','taux_proprio','nb_menages'];
  safe_field TEXT;
  result JSON;
BEGIN
  IF p_population_field = ANY(allowed_fields) THEN
    safe_field := p_population_field;
  ELSE
    safe_field := 'population';
  END IF;

  EXECUTE format('
    SELECT json_build_object(
      ''total_impressions'', ROUND(COALESCE(SUM(v.impressions), 0)::numeric, 0),
      ''total_population'', COALESCE(SUM(v.%I), 0),
      ''avg_equity'', ROUND(COALESCE(AVG(CASE WHEN v.%I > 0 THEN v.impressions / v.%I * 1000 END), 0)::numeric, 2),
      ''zones_sous_servies'', COUNT(*) FILTER (WHERE CASE WHEN v.%I > 0 THEN v.impressions / v.%I * 1000 END < 0.5),
      ''zones_sur_servies'', COUNT(*) FILTER (WHERE CASE WHEN v.%I > 0 THEN v.impressions / v.%I * 1000 END > 2.0),
      ''zones_equilibrees'', COUNT(*) FILTER (WHERE CASE WHEN v.%I > 0 THEN v.impressions / v.%I * 1000 END BETWEEN 0.5 AND 2.0),
      ''total_zones'', COUNT(*)
    )
    FROM v_dsp_iris_equity v
    WHERE v.campaign_id = $1
  ', safe_field, safe_field, safe_field, safe_field, safe_field, safe_field, safe_field, safe_field, safe_field)
  INTO result
  USING p_campaign_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql;
