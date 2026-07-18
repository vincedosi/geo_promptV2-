-- ============================================================
-- 110 — campaign_dsp_report : flux DSP (buy side) pour la réconciliation
-- ============================================================
-- Appliquée le 2026-07-18 via MCP Supabase (migration `campaign_dsp_report`).
--
-- Miroir « buy side » des rollups de suivi (107). Deux grains disjoints dans
-- une table (Nano : ~6,3 k lignes/campagne démo, jamais de scan brut) :
--   • daily : date NOT NULL, channel=code, postal_code=''  → global/tendance/canal
--   • CP    : date NULL,     channel='',   postal_code=CP   → carte
-- format/creative_ref : plomberie nullable, activés quand l'ingestion ad
-- server conservera ces dimensions (réconciliation à deux côtés par format/création).
-- Alimentée par API (lib/dsp/report) en prod, par simulate_dsp_report (111) en démo.

CREATE TABLE IF NOT EXISTS public.campaign_dsp_report (
  campaign_id  uuid NOT NULL REFERENCES public.dsp_campaigns(id) ON DELETE CASCADE,
  date         date,
  channel      text NOT NULL DEFAULT '',
  postal_code  text NOT NULL DEFAULT '',
  format       text,
  creative_ref text,
  impressions  bigint NOT NULL DEFAULT 0,
  clicks       bigint NOT NULL DEFAULT 0,
  spend        numeric NOT NULL DEFAULT 0,
  source       text NOT NULL DEFAULT 'api',
  pulled_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_dsp_report_unique
  ON public.campaign_dsp_report (
    campaign_id, (COALESCE(date, '1900-01-01'::date)), channel, postal_code,
    (COALESCE(format, '')), (COALESCE(creative_ref, '')));
CREATE INDEX IF NOT EXISTS idx_campaign_dsp_report_campaign
  ON public.campaign_dsp_report (campaign_id);
-- RLS deny-all : lecture exclusivement via les routes (service role bypass).
ALTER TABLE public.campaign_dsp_report ENABLE ROW LEVEL SECURITY;
