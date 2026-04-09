-- Geo-Equity v3: median_equity in stats + full France mode with simplified geom

-- 1. Updated get_equity_stats with median_equity
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
    WITH eq AS (
      SELECT
        v.impressions,
        v.%I as pop,
        CASE WHEN v.%I > 0 THEN v.impressions / v.%I * 1000 END as eq_idx
      FROM v_dsp_iris_equity v
      WHERE v.campaign_id = $1
    )
    SELECT json_build_object(
      ''total_impressions'', ROUND(COALESCE(SUM(impressions), 0)::numeric, 0),
      ''total_population'', COALESCE(SUM(pop), 0),
      ''avg_equity'', ROUND(COALESCE(AVG(eq_idx), 0)::numeric, 2),
      ''median_equity'', ROUND(COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY eq_idx), 0)::numeric, 2),
      ''zones_sous_servies'', COUNT(*) FILTER (WHERE eq_idx < 0.5),
      ''zones_sur_servies'', COUNT(*) FILTER (WHERE eq_idx > 2.0),
      ''zones_equilibrees'', COUNT(*) FILTER (WHERE eq_idx BETWEEN 0.5 AND 2.0),
      ''total_zones'', COUNT(*)
    )
    FROM eq
  ', safe_field, safe_field, safe_field)
  INTO result
  USING p_campaign_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 2. Updated get_equity_analysis with p_full param + simplified geom for France view
DROP FUNCTION IF EXISTS get_equity_analysis(UUID, TEXT, TEXT, float8[]);
DROP FUNCTION IF EXISTS get_equity_analysis(UUID, TEXT, TEXT, float8[], BOOLEAN);

CREATE OR REPLACE FUNCTION get_equity_analysis(
  p_campaign_id UUID,
  p_source TEXT DEFAULT 'iris',
  p_population_field TEXT DEFAULT 'population',
  p_bbox float8[] DEFAULT NULL,
  p_full BOOLEAN DEFAULT FALSE
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
  geom_col TEXT;
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

    IF p_full THEN geom_col := 'geom_z7';
    ELSE geom_col := 'geom'; END IF;

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
        i.%I as geom
      FROM v_dsp_iris_equity v
      JOIN iris i ON i.code_iris = v.code_iris
      WHERE v.campaign_id = $1
        AND ($3 OR ($2 IS NOT NULL AND i.geom && ST_MakeEnvelope($2[1], $2[2], $2[3], $2[4], 4326)))
    ', safe_field, safe_field, safe_field, geom_col)
    USING p_campaign_id, p_bbox, p_full;
  END IF;
END;
$$ LANGUAGE plpgsql;
