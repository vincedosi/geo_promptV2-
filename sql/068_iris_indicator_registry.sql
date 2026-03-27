-- ── Migration 068 : Table registre des indicateurs JSONB ────────────────────
-- Permet au copilote de savoir quels indicateurs sont disponibles dans iris.indicators
-- et de construire des requêtes SQL sur iris.indicators->>'DEC_D121' etc.

CREATE TABLE IF NOT EXISTS public.iris_indicator_registry (
  key           TEXT        PRIMARY KEY,                    -- Clé dans le JSONB (ex: 'DEC_MED21')
  dataset       TEXT        NOT NULL,                       -- Source dataset (ex: 'filosofi_2021')
  label         TEXT,                                       -- Description humaine
  type          TEXT        DEFAULT 'numeric'
                CHECK (type IN ('numeric', 'text')),
  imported_at   TIMESTAMPTZ DEFAULT now(),
  sample_values JSONB                                       -- Quelques valeurs d'exemple
);

CREATE INDEX IF NOT EXISTS iris_indicator_registry_dataset_idx
  ON public.iris_indicator_registry (dataset);

COMMENT ON TABLE public.iris_indicator_registry IS
  'Registre des indicateurs stockés dans iris.indicators (JSONB). '
  'Mis à jour automatiquement à chaque import. '
  'Utilisé par le copilote pour découvrir les indicateurs disponibles.';

-- RLS : lecture publique (copilote), écriture service_role
ALTER TABLE public.iris_indicator_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "iris_indicator_registry_read"
  ON public.iris_indicator_registry FOR SELECT
  USING (true);

CREATE POLICY "iris_indicator_registry_write"
  ON public.iris_indicator_registry FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
