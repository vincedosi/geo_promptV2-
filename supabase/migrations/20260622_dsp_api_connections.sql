-- =====================================================================
-- Onglet API — connexions DSP (DV360 d'abord)
-- Tables : dsp_connections (credentials chiffrés par org) + dsp_api_logs
-- Appliqué en prod via MCP Supabase apply_migration (2026-06-22).
-- =====================================================================

-- ── dsp_connections ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dsp_connections (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider                      text NOT NULL CHECK (provider IN ('dv360','meta','tiktok','ttd')),
  auth_method                   text CHECK (auth_method IN ('service_account','oauth')),
  status                        text NOT NULL DEFAULT 'disconnected'
                                  CHECK (status IN ('disconnected','connected','error')),
  partner_id                    text,
  advertiser_ids                jsonb NOT NULL DEFAULT '[]'::jsonb,
  credentials_encrypted         text,
  oauth_refresh_token_encrypted text,
  token_expires_at              timestamptz,
  last_error                    text,
  meta                          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  created_by                    uuid REFERENCES public.profiles(id),
  UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_dsp_connections_org
  ON public.dsp_connections (organization_id);

-- trigger updated_at
CREATE OR REPLACE FUNCTION public.set_dsp_connections_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_dsp_connections_updated_at ON public.dsp_connections;
CREATE TRIGGER trg_dsp_connections_updated_at
  BEFORE UPDATE ON public.dsp_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_dsp_connections_updated_at();

-- ── dsp_api_logs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dsp_api_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('dv360','meta','tiktok','ttd')),
  category        text NOT NULL CHECK (category IN ('api_call','connection','job')),
  level           text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  action          text NOT NULL,
  status_code     int,
  duration_ms     int,
  message         text,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsp_api_logs_org_created
  ON public.dsp_api_logs (organization_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────
-- Lecture réservée aux membres de l'org ; écritures via service role (routes).
-- get_user_org() prend l'org de l'appelant via auth.uid() en interne (sans argument).
ALTER TABLE public.dsp_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dsp_connections_select ON public.dsp_connections;
CREATE POLICY dsp_connections_select ON public.dsp_connections
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org());

ALTER TABLE public.dsp_api_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dsp_api_logs_select ON public.dsp_api_logs;
CREATE POLICY dsp_api_logs_select ON public.dsp_api_logs
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org());
