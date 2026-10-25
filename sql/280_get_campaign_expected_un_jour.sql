-- =============================================================================
-- 280 — get_campaign_expected : une période d'UN jour a un volume attendu (lot 6, relecture 3, Important 2)
-- =============================================================================
--
-- La garde de sql/113 sortait sur `end_date <= start_date` : une campagne du 30/11 au 30/11 rendait NULL, alors que
-- l'étape ⑥ l'accepte et y écrit `kpi_target`. La garde devient `end_date < start_date` ; une période à l'envers est de toute façon refusée par la
-- contrainte `bs_dates_consistent` : seul le cas d'un jour change.
--
-- IDENTITÉ pour toute période de DEUX jours ou plus : pour elles `end_date > start_date`, les deux gardes laissent
-- passer de la même façon, et la suite du corps est recopiée À L'IDENTIQUE de sql/113. La formule a déjà son `+ 1`
-- au dénominateur (`end_date - start_date + 1` = 1 pour un jour) : aucune division par zéro.
-- Prouvé le 2026-10-25 en local (rapport fix-c1) : balayage de 708 stratégies synthétiques (périodes de 2 à 60
-- jours, rollups avant/pendant/après, deux branches kpi/budget) — 0 écart entre l’ancienne et la nouvelle ; les 12 d’un jour passent de NULL à une valeur ; et les
-- campagnes réelles de la base, avant/après : identiques.
--
-- CREATE OR REPLACE, même signature : aucun DROP (base partagée). Droits inchangés, réaffirmés.
CREATE OR REPLACE FUNCTION public.get_campaign_expected(p_campaign_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE s record; v_as_of date; v_time numeric; v_expected numeric;
BEGIN
  SELECT s2.total_budget, s2.forecast_cpm, s2.start_date, s2.end_date, s2.kpi_target, s2.objective_code
  INTO s FROM bidding_strategies s2 WHERE s2.campaign_id = p_campaign_id
  ORDER BY s2.created_at DESC LIMIT 1;
  IF s IS NULL THEN RETURN NULL; END IF;
  SELECT MAX(date) INTO v_as_of FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;
  IF v_as_of IS NULL OR s.start_date IS NULL OR s.end_date IS NULL OR s.end_date < s.start_date THEN
    RETURN NULL; END IF;
  v_time := ROUND(LEAST(1, GREATEST(0, (v_as_of - s.start_date + 1)::numeric / (s.end_date - s.start_date + 1))) * 100, 1) / 100;
  IF s.kpi_target IS NOT NULL AND s.kpi_target > 0 AND s.objective_code = 'maximize_impressions' THEN
    v_expected := s.kpi_target * v_time;
  ELSIF s.total_budget IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_expected := s.total_budget * v_time / s.forecast_cpm * 1000;
  END IF;
  RETURN v_expected;
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_expected(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_expected(uuid) TO service_role;
