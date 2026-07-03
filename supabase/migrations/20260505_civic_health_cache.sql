-- Cache des indicateurs ATMO + pollen par commune INSEE.
-- TTL 24h, fallback stale 48h. Source : Atmo France et AASQA (ODbL).
--
-- Lecture publique : data ODbL accessible à tous (auth Supabase quand même
-- requise côté API par cohérence avec les autres routes civic-indicators).
-- Écriture : service role uniquement (route API serveur).
CREATE TABLE IF NOT EXISTS public.civic_health_cache (
    code_insee  text PRIMARY KEY,
    payload     jsonb NOT NULL,
    fetched_at  timestamptz NOT NULL DEFAULT now(),
    provider    text NOT NULL DEFAULT 'atmofrance'
                CHECK (provider IN ('atmofrance', 'mock'))
);

CREATE INDEX IF NOT EXISTS civic_health_cache_fetched_at_idx
    ON public.civic_health_cache (fetched_at DESC);

ALTER TABLE public.civic_health_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS civic_health_cache_read_anon ON public.civic_health_cache;
CREATE POLICY civic_health_cache_read_anon
    ON public.civic_health_cache
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS civic_health_cache_write_service ON public.civic_health_cache;
CREATE POLICY civic_health_cache_write_service
    ON public.civic_health_cache
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMENT ON TABLE public.civic_health_cache IS
    'Cache des indicateurs ATMO + pollen par commune INSEE. TTL 24h, fallback 48h. Source : Atmo France et AASQA (ODbL).';
COMMENT ON COLUMN public.civic_health_cache.provider IS
    'Origine du payload : atmofrance (prod) ou mock (dev sans creds Atmo).';
