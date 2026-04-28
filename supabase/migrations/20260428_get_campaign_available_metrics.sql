-- Chantier A3 — Détection dynamique des KPIs réellement disponibles pour une campagne.
--
-- Pour chaque KPI déclaré dans dsp_metrics_registry, retourne true si au moins
-- une ligne dsp_campaign_data de la campagne contient cette métrique.
--   - is_core = true  → vérifie la colonne native correspondante (CASE WHEN sur les
--     5 colonnes natives connues : tracked_ads, unique_impressions, impressions, clicks, spend).
--   - is_core = false → vérifie metrics ? '<field>' (présence de la clé JSONB).
--
-- Le CASE WHEN sur les 5 colonnes natives est inévitable : SQL ne peut pas
-- faire `WHERE <column_dynamic> IS NOT NULL` sans EXECUTE. Si une 6e colonne
-- native est ajoutée plus tard, mettre à jour cette RPC.
--
-- SECURITY DEFINER : auth.uid() retourne NULL via service_role ; cette RPC
-- ne lit que des metadata + une vérif d'existence, pas de données sensibles.
CREATE OR REPLACE FUNCTION public.get_campaign_available_metrics(p_campaign_id uuid)
RETURNS TABLE(field text, has_data boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH registry AS (
    SELECT m.field AS m_field, m.is_core AS m_is_core
    FROM dsp_metrics_registry m
    WHERE m.is_enabled = true
  )
  SELECT
    r.m_field AS field,
    CASE
      WHEN r.m_is_core THEN EXISTS (
        SELECT 1 FROM dsp_campaign_data dcd
        WHERE dcd.campaign_id = p_campaign_id
          AND (
               (r.m_field = 'tracked_ads'        AND dcd.tracked_ads IS NOT NULL AND dcd.tracked_ads > 0)
            OR (r.m_field = 'unique_impressions' AND dcd.unique_impressions IS NOT NULL AND dcd.unique_impressions > 0)
            OR (r.m_field = 'impressions'        AND dcd.impressions IS NOT NULL)
            OR (r.m_field = 'clicks'             AND dcd.clicks IS NOT NULL)
            OR (r.m_field = 'spend'              AND dcd.spend IS NOT NULL)
          )
        LIMIT 1
      )
      ELSE EXISTS (
        SELECT 1 FROM dsp_campaign_data dcd
        WHERE dcd.campaign_id = p_campaign_id
          AND dcd.metrics ? r.m_field
        LIMIT 1
      )
    END AS has_data
  FROM registry r;
END;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_available_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_campaign_available_metrics(uuid) TO authenticated, service_role;
