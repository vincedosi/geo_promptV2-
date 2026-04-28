-- Chantier A3 — Somme du KPI choisi sur toute la campagne.
--
-- Renvoie un numeric : SUM(<col>) pour les KPIs core, SUM((metrics->>'<field>')::numeric)
-- pour les KPIs JSONB. NULL si aucune ligne / aucune valeur.
--
-- L'identification de la colonne native est faite par CASE WHEN sur les 5 colonnes
-- natives connues (cf. get_campaign_available_metrics). Si une 6e colonne native est
-- ajoutée plus tard, mettre à jour cette RPC.
CREATE OR REPLACE FUNCTION public.aggregate_campaign_metric(
  p_campaign_id uuid,
  p_metric_field text,
  p_is_core boolean
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_is_core THEN
    SELECT
      CASE p_metric_field
        WHEN 'tracked_ads'        THEN SUM(tracked_ads)::numeric
        WHEN 'unique_impressions' THEN SUM(unique_impressions)::numeric
        WHEN 'impressions'        THEN SUM(impressions)::numeric
        WHEN 'clicks'             THEN SUM(clicks)::numeric
        WHEN 'spend'              THEN SUM(spend)
        ELSE NULL
      END
    INTO v_total
    FROM dsp_campaign_data
    WHERE campaign_id = p_campaign_id;
  ELSE
    SELECT SUM(((metrics ->> p_metric_field))::numeric)
    INTO v_total
    FROM dsp_campaign_data
    WHERE campaign_id = p_campaign_id
      AND metrics ? p_metric_field;
  END IF;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.aggregate_campaign_metric(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aggregate_campaign_metric(uuid, text, boolean) TO authenticated, service_role;
