-- ── Migration 065 : Table d'historique des imports manuels IRIS ──────────────
-- Stocke l'historique des imports CSV manuels depuis /dashboard/iris-crawler

CREATE TABLE IF NOT EXISTS public.iris_import_history (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at     TIMESTAMPTZ DEFAULT now(),
  filename       TEXT        NOT NULL,
  total_rows     INTEGER     NOT NULL,
  inserted_rows  INTEGER     DEFAULT 0,
  updated_rows   INTEGER     DEFAULT 0,
  error_rows     INTEGER     DEFAULT 0,
  status         TEXT        CHECK (status IN ('pending', 'processing', 'success', 'partial', 'error')) DEFAULT 'pending',
  user_id        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  error_details  JSONB,
  column_mapping JSONB
);

-- Index pour tri par date (vue historique)
CREATE INDEX IF NOT EXISTS iris_import_history_created_at_idx
  ON public.iris_import_history (created_at DESC);

-- RLS : seuls les super_admin peuvent lire/écrire (via service role)
ALTER TABLE public.iris_import_history ENABLE ROW LEVEL SECURITY;

-- Politique lecture : authentifié avec rôle admin
CREATE POLICY "iris_import_history_select"
  ON public.iris_import_history
  FOR SELECT
  USING (auth.role() = 'service_role');

CREATE POLICY "iris_import_history_insert"
  ON public.iris_import_history
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "iris_import_history_update"
  ON public.iris_import_history
  FOR UPDATE
  USING (auth.role() = 'service_role');
