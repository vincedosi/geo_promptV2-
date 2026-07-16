-- 106 — Valeurs d'indicateur par code postal : socle de la pression sur l'indicateur choisi.
-- La courbe d'enchère (apply_zone_weights_to_strategy) et l'export custom bidding lisent ici,
-- quel que soit l'indicateur du registre cibles (l'abstention devient un indicateur comme un autre).

CREATE TABLE IF NOT EXISTS public.indicator_cp_values (
  indicator_code text NOT NULL REFERENCES cible_indicator_registry(indicator_code),
  postal_code text NOT NULL,
  value numeric NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (indicator_code, postal_code)
);
ALTER TABLE public.indicator_cp_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "icv_read_auth" ON public.indicator_cp_values
  FOR SELECT TO authenticated USING (true);

-- Matérialise un indicateur : IRIS → commune (code_commune) → CP (postal_code_commune),
-- moyenne pondérée par population. Échelle 'cp' (abstention/pollen/atmo) : copie directe.
CREATE OR REPLACE FUNCTION public.materialize_indicator_cp_values(p_indicator_code text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reg record;
  v_expr text;
  n int := 0;
BEGIN
  SELECT * INTO reg FROM cible_indicator_registry
   WHERE indicator_code = p_indicator_code AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'indicateur inconnu ou inactif %', p_indicator_code; END IF;

  DELETE FROM indicator_cp_values WHERE indicator_code = p_indicator_code;

  IF reg.data_source = 'iris_column' THEN
    IF reg.normalize = 'pct_of_population' THEN
      v_expr := format('(i.%I::float / nullif(i.population,0) * 100)', reg.data_column);
    ELSE
      v_expr := format('i.%I', reg.data_column);
    END IF;
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, pcc.code_postal,
              sum(%s * coalesce(i.population,0)) / nullif(sum(coalesce(i.population,0)),0)
         FROM iris i
         JOIN postal_code_commune pcc ON pcc.code_commune = i.code_commune
        WHERE i.is_true_iris AND %s IS NOT NULL
        GROUP BY pcc.code_postal
       HAVING sum(coalesce(i.population,0)) > 0',
      p_indicator_code, v_expr, v_expr);
  ELSIF reg.data_source = 'abstention' THEN
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, code_postal, %I FROM dataset_abstention_2022 WHERE %I IS NOT NULL',
      p_indicator_code, reg.data_column, reg.data_column);
  ELSIF reg.data_source = 'pollen' THEN
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, code_postal, %I FROM pollen_map_daily
        WHERE date_ech = (SELECT max(date_ech) FROM pollen_map_daily) AND %I IS NOT NULL',
      p_indicator_code, reg.data_column, reg.data_column);
  ELSE -- atmo
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, code_postal, %I FROM atmo_map_daily
        WHERE date_ech = (SELECT max(date_ech) FROM atmo_map_daily) AND %I IS NOT NULL',
      p_indicator_code, reg.data_column, reg.data_column);
  END IF;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.materialize_indicator_cp_values(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_indicator_cp_values(text) TO service_role;

-- Seed : l'abstention (seule source historique de la courbe) est matérialisée immédiatement.
SELECT public.materialize_indicator_cp_values('abstention_pres_2022');

-- Généralisation de apply_zone_weights_to_strategy : la branche 'by_insee_variable' interpole
-- désormais sur indicator_cp_values (n'importe quel variable_code du registre cibles) au lieu
-- d'être câblée en dur sur dataset_abstention_2022 / taux_abstention.
CREATE OR REPLACE FUNCTION public.apply_zone_weights_to_strategy(p_strategy_id uuid, p_in_weights jsonb, p_out_weights jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_zone_id UUID;
  v_n_inserted INT := 0;
  v_in_mode TEXT;
  v_out_mode TEXT;
  v_var text;
BEGIN
  SELECT zone_id INTO v_zone_id FROM bidding_strategies WHERE id = p_strategy_id;
  v_in_mode  := COALESCE(p_in_weights->>'mode',  'uniform');
  v_out_mode := COALESCE(p_out_weights->>'mode', 'uniform');
  v_var := COALESCE(p_in_weights->>'variable_code', 'abstention_pres_2022');

  DELETE FROM bidding_zone_configs WHERE strategy_id = p_strategy_id;

  IF v_zone_id IS NULL THEN
    INSERT INTO bidding_zone_configs (strategy_id, postal_code, country_code, bid_multiplier, is_active)
    SELECT
      p_strategy_id, cp.postal_code, 'FR',
      GREATEST(0, LEAST(5,
        CASE
          WHEN v_in_mode = 'uniform' THEN COALESCE((p_in_weights->>'value')::numeric, 1.0)
          WHEN v_in_mode = 'by_tier' THEN COALESCE((p_in_weights->'values'->>infer_tier(cp.postal_code))::numeric, 1.0)
          WHEN v_in_mode = 'by_insee_variable'
            THEN COALESCE(interpolate_on_curve(p_in_weights->'curve', av.value), 1.0)
          ELSE 1.0
        END
      )),
      true
    FROM (SELECT DISTINCT postal_code FROM dsp_campaign_data WHERE postal_code IS NOT NULL) cp
    LEFT JOIN indicator_cp_values av ON av.postal_code = cp.postal_code AND av.indicator_code = v_var;
    GET DIAGNOSTICS v_n_inserted = ROW_COUNT;
    RETURN v_n_inserted;
  END IF;

  WITH all_fr_cps AS (
    SELECT DISTINCT postal_code FROM dsp_campaign_data WHERE postal_code IS NOT NULL
  ),
  zone_cps AS (
    SELECT DISTINCT cgzc.code AS postal_code
    FROM custom_geo_zone_codes cgzc
    WHERE cgzc.zone_id = v_zone_id AND cgzc.code_type = 'cp'
  ),
  classified AS (
    SELECT cp.postal_code,
           (zc.postal_code IS NOT NULL) AS is_in_zone,
           av.value
    FROM all_fr_cps cp
    LEFT JOIN zone_cps zc ON zc.postal_code = cp.postal_code
    LEFT JOIN indicator_cp_values av ON av.postal_code = cp.postal_code AND av.indicator_code = v_var
  ),
  with_multiplier AS (
    SELECT c.postal_code,
      CASE
        WHEN c.is_in_zone AND v_in_mode = 'uniform' THEN COALESCE((p_in_weights->>'value')::numeric, 1.0)
        WHEN c.is_in_zone AND v_in_mode = 'by_tier' THEN COALESCE((p_in_weights->'values'->>infer_tier(c.postal_code))::numeric, 1.0)
        WHEN c.is_in_zone AND v_in_mode = 'by_subzone' THEN COALESCE((p_in_weights->>'value')::numeric, 1.0)
        WHEN c.is_in_zone AND v_in_mode = 'by_cp_csv' THEN COALESCE((p_in_weights->'values'->>c.postal_code)::numeric, 1.0)
        WHEN c.is_in_zone AND v_in_mode = 'by_insee_variable'
          THEN COALESCE(interpolate_on_curve(p_in_weights->'curve', c.value), 1.0)
        WHEN NOT c.is_in_zone AND v_out_mode = 'uniform' THEN COALESCE((p_out_weights->>'value')::numeric, 1.0)
        WHEN NOT c.is_in_zone AND v_out_mode = 'exclusion' THEN 0.0
        WHEN NOT c.is_in_zone AND v_out_mode = 'by_tier' THEN COALESCE((p_out_weights->'values'->>infer_tier(c.postal_code))::numeric, 1.0)
        ELSE 1.0
      END AS multiplier
    FROM classified c
  )
  INSERT INTO bidding_zone_configs (strategy_id, postal_code, country_code, bid_multiplier, is_active)
  SELECT p_strategy_id, postal_code, 'FR', GREATEST(0, LEAST(5, multiplier)), true
  FROM with_multiplier WHERE multiplier IS NOT NULL;
  GET DIAGNOSTICS v_n_inserted = ROW_COUNT;

  IF v_in_mode = 'by_subzone' THEN
    UPDATE bidding_zone_configs bzc
    SET bid_multiplier = GREATEST(0, LEAST(5, sz.multiplier))
    FROM bidding_strategy_subzones sz
    WHERE bzc.strategy_id = p_strategy_id
      AND bzc.postal_code = ANY(sz.postal_codes)
      AND sz.strategy_id = p_strategy_id;
  END IF;

  RETURN v_n_inserted;
END;
$function$
