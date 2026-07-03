-- ============================================================
-- 084 — Table pollen_map_daily : indice pollen national par code postal
-- ============================================================
-- Appliquée le 2026-07-03 via MCP Supabase (migration `pollen_map_daily`).
--
-- Alimentée par l'ingestion bulk Atmo (lib/civic-health/pollen-ingest.ts) :
--   cron Inngest quotidien `pollen-daily-ingest` + trigger admin
--   POST /api/admin/pollen-ingest (NDJSON streaming, progression).
--
-- Niveaux = MAX des communes du code postal (mapping postal_code_commune),
-- choix conservateur pour une carte « zones à risque ».
-- Volumétrie : ~6 200 lignes/jour, purge à J-2 par l'ingestion.
-- Source : Atmo France et les AASQA — licence ODbL (mention obligatoire UI).

CREATE TABLE IF NOT EXISTS public.pollen_map_daily (
  date_ech      date        NOT NULL,
  code_postal   text        NOT NULL,
  indice_global smallint    NOT NULL DEFAULT 0,
  ambroisie     smallint    NOT NULL DEFAULT 0,
  armoise       smallint    NOT NULL DEFAULT 0,
  aulne         smallint    NOT NULL DEFAULT 0,
  bouleau       smallint    NOT NULL DEFAULT 0,
  graminees     smallint    NOT NULL DEFAULT 0,
  olivier       smallint    NOT NULL DEFAULT 0,
  nb_communes   integer     NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date_ech, code_postal)
);

COMMENT ON TABLE public.pollen_map_daily IS
  'Indice pollen Atmo France agrégé par code postal (max des communes du CP). Source ODbL Atmo France et les AASQA.';

ALTER TABLE public.pollen_map_daily ENABLE ROW LEVEL SECURITY;

-- Lecture pour tout utilisateur authentifié (carte), écriture service role uniquement (ingestion)
DROP POLICY IF EXISTS pollen_map_daily_read ON public.pollen_map_daily;
CREATE POLICY pollen_map_daily_read ON public.pollen_map_daily
  FOR SELECT TO authenticated USING (true);
