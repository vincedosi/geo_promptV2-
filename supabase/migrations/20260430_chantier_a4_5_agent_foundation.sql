-- A4.5 — Fondation agent IA superviseur (GeoAgent).
-- 2 tables additives + 2 colonnes additives sur bidding_drift_events.
-- Aucune modif des tables / RPCs existantes.
-- Appliquée en base via MCP Supabase (apply_migration name='chantier_a4_5_agent_foundation').

-- ─── 1. agent_autonomy_settings ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_autonomy_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  scope_type TEXT NOT NULL CHECK (scope_type IN ('user_default', 'strategy_override')),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,

  -- Niveau d'autonomie (0 à 4) :
  --   0 = Observer (l'agent répond uniquement quand sollicité)
  --   1 = Explainer (notifications proactives mais aucune action)
  --   2 = Suggester (propose des actions concrètes avec validation manuelle)
  --   3 = Auto-low-risk (agit seul sur low-risk ; demande validation pour le reste)
  --   4 = Auto-full (agit seul partout)
  autonomy_level INT NOT NULL CHECK (autonomy_level BETWEEN 0 AND 4),

  config JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT aas_scope_consistency CHECK (
    (scope_type = 'user_default' AND user_id IS NOT NULL AND strategy_id IS NULL)
    OR (scope_type = 'strategy_override' AND strategy_id IS NOT NULL)
  ),

  UNIQUE (user_id, strategy_id, scope_type)
);

CREATE INDEX IF NOT EXISTS idx_aas_user
  ON public.agent_autonomy_settings(user_id)
  WHERE scope_type = 'user_default';

CREATE INDEX IF NOT EXISTS idx_aas_strategy
  ON public.agent_autonomy_settings(strategy_id)
  WHERE scope_type = 'strategy_override';

DROP TRIGGER IF EXISTS tr_aas_updated ON public.agent_autonomy_settings;
CREATE TRIGGER tr_aas_updated
  BEFORE UPDATE ON public.agent_autonomy_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.agent_autonomy_settings IS
  'Niveau d''autonomie de l''agent IA, configurable par user (default) ou par stratégie (override). 5 niveaux 0-4.';

-- RLS
ALTER TABLE public.agent_autonomy_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aas_select_own" ON public.agent_autonomy_settings;
CREATE POLICY "aas_select_own" ON public.agent_autonomy_settings
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.get_user_role() = ANY (ARRAY['super_admin', 'admin'])
  );

DROP POLICY IF EXISTS "aas_insert_own" ON public.agent_autonomy_settings;
CREATE POLICY "aas_insert_own" ON public.agent_autonomy_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.get_user_role() = ANY (ARRAY['super_admin', 'admin'])
  );

DROP POLICY IF EXISTS "aas_update_own" ON public.agent_autonomy_settings;
CREATE POLICY "aas_update_own" ON public.agent_autonomy_settings
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.get_user_role() = ANY (ARRAY['super_admin', 'admin'])
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.get_user_role() = ANY (ARRAY['super_admin', 'admin'])
  );

DROP POLICY IF EXISTS "aas_delete_own" ON public.agent_autonomy_settings;
CREATE POLICY "aas_delete_own" ON public.agent_autonomy_settings
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.get_user_role() = ANY (ARRAY['super_admin', 'admin'])
  );


-- ─── 2. bidding_agent_actions (audit trail) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bidding_agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  strategy_id UUID REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  drift_event_id UUID REFERENCES public.bidding_drift_events(id) ON DELETE SET NULL,

  intent TEXT NOT NULL,

  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('user_chat', 'proactive', 'api')),

  user_message TEXT,
  agent_response TEXT,
  recommendations JSONB DEFAULT '[]'::jsonb,

  action_taken TEXT CHECK (action_taken IN (
    'none',
    'suggested',
    'auto_applied',
    'human_approved',
    'human_rejected'
  )),
  applied_at TIMESTAMPTZ,

  llm_model TEXT,
  llm_tokens_input INT,
  llm_tokens_output INT,
  llm_duration_ms INT,
  autonomy_level_at_time INT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_baa_user
  ON public.bidding_agent_actions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_baa_strategy
  ON public.bidding_agent_actions(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_baa_drift
  ON public.bidding_agent_actions(drift_event_id)
  WHERE drift_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_baa_intent
  ON public.bidding_agent_actions(intent, created_at DESC);

COMMENT ON TABLE public.bidding_agent_actions IS
  'Audit trail complet des interactions agent IA <-> user et des actions automatiques. Conformité + debug + analytics.';

ALTER TABLE public.bidding_agent_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "baa_select_own_or_admin" ON public.bidding_agent_actions;
CREATE POLICY "baa_select_own_or_admin" ON public.bidding_agent_actions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.get_user_role() = ANY (ARRAY['super_admin', 'admin'])
  );

-- Pas de policy INSERT/UPDATE pour authenticated → service_role only.


-- ─── 3. Colonnes additives sur bidding_drift_events ─────────────────────────

ALTER TABLE public.bidding_drift_events
  ADD COLUMN IF NOT EXISTS agent_recommendation JSONB,
  ADD COLUMN IF NOT EXISTS agent_analyzed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bde_unanalyzed
  ON public.bidding_drift_events(detected_at)
  WHERE agent_analyzed_at IS NULL;

COMMENT ON COLUMN public.bidding_drift_events.agent_recommendation IS
  'Recommandation structurée de l''agent IA pour ce drift event (raisonnement + actions proposées).';
COMMENT ON COLUMN public.bidding_drift_events.agent_analyzed_at IS
  'Timestamp de l''analyse par l''agent. NULL = non encore analysé. Index partiel pour queue.';
