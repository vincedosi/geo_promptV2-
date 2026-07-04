-- ============================================================
-- 093 — Statut de campagne : override manuel + date de dernière donnée
-- ============================================================
-- Appliquée le 2026-07-04 via MCP Supabase (migration campaign_status_override).
--
-- Le statut effectif est CALCULÉ (lib/campaigns/status.ts) : override manuel
-- sinon dérivé du calendrier. Seules les corrections manuelles sont persistées.
-- get_campaign_last_data_dates alimente le signal d'attention (campagne en cours
-- sans donnée récente). ATTENTION : la version sans argument ci-dessous fait un
-- FULL SEQ SCAN de dsp_campaign_data (Postgres 15 = pas de skip-scan). Remplacée
-- par la version bornée `get_campaign_last_data_dates(p_ids uuid[])` en sql/095
-- (index scan). Ne pas réintroduire d'appel sans argument.

ALTER TABLE public.dsp_campaigns
  ADD COLUMN IF NOT EXISTS status_override    text,
  ADD COLUMN IF NOT EXISTS status_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_override_by uuid;

ALTER TABLE public.dsp_campaigns
  DROP CONSTRAINT IF EXISTS dsp_campaigns_status_override_check;
ALTER TABLE public.dsp_campaigns
  ADD CONSTRAINT dsp_campaigns_status_override_check
  CHECK (status_override IS NULL OR status_override IN ('paused','ended','archived'));

CREATE OR REPLACE FUNCTION public.get_campaign_last_data_dates()
RETURNS TABLE(campaign_id uuid, last_data_date date)
LANGUAGE sql
STABLE
AS $$
  SELECT campaign_id, max(date) AS last_data_date
  FROM public.dsp_campaign_data
  GROUP BY campaign_id;
$$;
