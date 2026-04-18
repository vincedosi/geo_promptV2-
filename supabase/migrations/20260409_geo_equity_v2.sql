-- Geo-Equity v2: carreaux support + indicators RPC + lookup tables

-- 1. Lookup table for carreaux commune mapping (pre-computed from metadata)
CREATE TABLE IF NOT EXISTS carreaux_commune_lookup (
  carreau_id BIGINT PRIMARY KEY,
  code_commune TEXT NOT NULL,
  ind NUMERIC,
  ind_18_24 NUMERIC,
  ind_25_39 NUMERIC,
  ind_40_54 NUMERIC,
  ind_inc NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_ccl_commune ON carreaux_commune_lookup(code_commune);

-- 2. Pre-computed postal code → carreaux population totals
CREATE TABLE IF NOT EXISTS carreaux_cp_population (
  code_postal TEXT PRIMARY KEY,
  pop_total NUMERIC NOT NULL
);

-- 3. Carreaux equity view (uses lookup tables for performance)
CREATE OR REPLACE VIEW v_dsp_carreaux_equity AS
SELECT
  d.campaign_id,
  cc.carreau_id,
  cc.code_commune,
  SUM(d.tracked_ads * (cc.ind / NULLIF(cp.pop_total, 0))) as impressions,
  MAX(cc.ind) as ind,
  MAX(cc.ind_18_24) as ind_18_24,
  MAX(cc.ind_25_39) as ind_25_39,
  MAX(cc.ind_40_54) as ind_40_54,
  MAX(cc.ind_inc) as ind_inc,
  CASE
    WHEN MAX(cc.ind) > 0
    THEN ROUND((SUM(d.tracked_ads * (cc.ind / NULLIF(cp.pop_total, 0))) / MAX(cc.ind) * 1000)::numeric, 2)
    ELSE NULL
  END as equity_index
FROM dsp_campaign_data d
JOIN postal_code_commune pc ON pc.code_postal = d.postal_code
JOIN carreaux_commune_lookup cc ON cc.code_commune = pc.code_commune
JOIN carreaux_cp_population cp ON cp.code_postal = d.postal_code
WHERE d.country = 'France'
GROUP BY d.campaign_id, cc.carreau_id, cc.code_commune;

-- 4. Indicators RPC (returns available numeric columns per source)
CREATE OR REPLACE FUNCTION get_equity_indicators()
RETURNS JSON AS $$
SELECT json_build_object(
  'iris', (
    SELECT json_agg(json_build_object(
      'field', column_name,
      'label', column_name,
      'type', data_type
    ) ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_name = 'iris'
    AND table_schema = 'public'
    AND data_type IN ('integer', 'numeric', 'double precision', 'bigint')
    AND column_name NOT IN ('centroid_lat', 'centroid_lng')
  ),
  'carreaux', (
    SELECT json_agg(json_build_object(
      'field', column_name,
      'label', column_name,
      'type', data_type
    ) ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_name = 'carreaux_commune_lookup'
    AND table_schema = 'public'
    AND data_type IN ('integer', 'numeric', 'double precision', 'bigint')
    AND column_name NOT IN ('carreau_id')
  )
);
$$ LANGUAGE sql;

-- 5. Updated get_equity_analysis with source param
-- (carreaux branch uses direct query with bbox pushed down for performance)
DROP FUNCTION IF EXISTS get_equity_analysis(UUID, TEXT, TEXT, float8[]);

CREATE OR REPLACE FUNCTION get_equity_analysis(
  p_campaign_id UUID,
  p_source TEXT DEFAULT 'iris',
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
  iris_fields TEXT[] := ARRAY['population','pop_0_14','pop_15_29','pop_30_44','pop_45_59','pop_60_74','pop_75_plus','nb_menages','rev_median','taux_chomage','taux_proprio','nb_diplome_aucun','nb_diplome_bac','nb_diplome_sup','taux_diplome_sup','nb_csp_cadre','nb_csp_employe','nb_csp_ouvrier','rev_d1','rev_d9','taux_pauvrete','indice_gini','nb_emplois','taux_emploi','densite_pop','indice_jeunesse','part_pop_etrangere','part_residences_principales','part_appartements','part_logements_sociaux','part_menages_emmenages_2ans','part_familles_monoparentales','part_couples_avec_enfants','part_actifs_marche_velo','part_actifs_transport_commun','part_hommes_actifs','part_femmes_actives','part_pop_moins_18','part_pop_65_plus','part_sans_diplome','nb_emplois_commune'];
  carreaux_fields TEXT[] := ARRAY['ind','ind_18_24','ind_25_39','ind_40_54','ind_inc'];
  safe_field TEXT;
BEGIN
  IF p_source = 'carreaux' THEN
    IF p_population_field = ANY(carreaux_fields) THEN safe_field := p_population_field;
    ELSE safe_field := 'ind'; END IF;

    RETURN QUERY
    EXECUTE format('
      SELECT
        cc.carreau_id::text as code_iris,
        '''' as nom_commune,
        cc.code_commune as code_dept,
        SUM(d.tracked_ads * (cc.ind / NULLIF(cp.pop_total, 0)))::float as impressions,
        MAX(cc.%I)::float as population_cible,
        CASE
          WHEN MAX(cc.%I) > 0
          THEN ROUND((SUM(d.tracked_ads * (cc.ind / NULLIF(cp.pop_total, 0))) / MAX(cc.%I) * 1000)::numeric, 2)::float
          ELSE NULL
        END as equity_index,
        cf.geom
      FROM carreaux_filosofi cf
      JOIN carreaux_commune_lookup cc ON cc.carreau_id = cf.id
      JOIN postal_code_commune pc ON pc.code_commune = cc.code_commune
      JOIN dsp_campaign_data d ON d.postal_code = pc.code_postal AND d.country = ''France'' AND d.campaign_id = $1
      JOIN carreaux_cp_population cp ON cp.code_postal = d.postal_code
      WHERE cf.geom && ST_MakeEnvelope($2[1], $2[2], $2[3], $2[4], 4326)
      GROUP BY cc.carreau_id, cc.code_commune, cf.geom
    ', safe_field, safe_field, safe_field)
    USING p_campaign_id, p_bbox;
  ELSE
    IF p_population_field = ANY(iris_fields) THEN safe_field := p_population_field;
    ELSE safe_field := 'population'; END IF;

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
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. Updated get_equity_stats (IRIS only — carreaux stats computed from features in API)
DROP FUNCTION IF EXISTS get_equity_stats(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_equity_stats(
  p_campaign_id UUID,
  p_source TEXT DEFAULT 'iris',
  p_population_field TEXT DEFAULT 'population'
)
RETURNS JSON AS $$
DECLARE
  iris_fields TEXT[] := ARRAY['population','pop_0_14','pop_15_29','pop_30_44','pop_45_59','pop_60_74','pop_75_plus','nb_menages','rev_median','taux_chomage','taux_proprio','nb_diplome_aucun','nb_diplome_bac','nb_diplome_sup','taux_diplome_sup','nb_csp_cadre','nb_csp_employe','nb_csp_ouvrier','rev_d1','rev_d9','taux_pauvrete','indice_gini','nb_emplois','taux_emploi','densite_pop','indice_jeunesse','part_pop_etrangere','part_residences_principales','part_appartements','part_logements_sociaux','part_menages_emmenages_2ans','part_familles_monoparentales','part_couples_avec_enfants','part_actifs_marche_velo','part_actifs_transport_commun','part_hommes_actifs','part_femmes_actives','part_pop_moins_18','part_pop_65_plus','part_sans_diplome','nb_emplois_commune'];
  safe_field TEXT;
  result JSON;
BEGIN
  IF p_population_field = ANY(iris_fields) THEN safe_field := p_population_field;
  ELSE safe_field := 'population'; END IF;

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
