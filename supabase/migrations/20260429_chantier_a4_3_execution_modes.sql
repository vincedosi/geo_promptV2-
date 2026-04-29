-- A4.3 — execution_mode + bidding_zone_config_proposals
-- Migration additive : aucune modif des objets existants au-delà de l'ALTER ADD column.
-- Appliquée en base via MCP Supabase (apply_migration name='chantier_a4_3_execution_modes').

-- 1.1 Ajouter execution_mode sur bidding_strategies
ALTER TABLE public.bidding_strategies
  ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'suggest'
    CHECK (execution_mode IN ('monitor_only', 'suggest', 'auto'));

COMMENT ON COLUMN public.bidding_strategies.execution_mode IS
  'Mode d''exécution choisi par le planner : monitor_only (log seulement), suggest (proposals à valider), auto (push direct vers bidding_zone_configs).';

-- 1.2 Table proposals
CREATE TABLE IF NOT EXISTS public.bidding_zone_config_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  postal_code TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'FR',

  proposed_bid_multiplier NUMERIC(6,3) NOT NULL,
  proposed_floor_bid NUMERIC(10,4),
  proposed_ceiling_bid NUMERIC(10,4),
  proposed_target_metrics JSONB DEFAULT '{}'::jsonb,
  proposed_constraints JSONB DEFAULT '{}'::jsonb,

  reasoning JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'expired')),
  proposed_by TEXT NOT NULL DEFAULT 'hoeffding',
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  applied_at TIMESTAMPTZ,
  applied_to_config_id UUID,

  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bzcp_multiplier_positive CHECK (proposed_bid_multiplier > 0),
  CONSTRAINT bzcp_floor_ceiling_consistent CHECK (
    proposed_floor_bid IS NULL
    OR proposed_ceiling_bid IS NULL
    OR proposed_ceiling_bid >= proposed_floor_bid
  )
);

CREATE INDEX IF NOT EXISTS idx_bzcp_strategy_status
  ON public.bidding_zone_config_proposals(strategy_id, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_bzcp_expires
  ON public.bidding_zone_config_proposals(expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_bzcp_proposed_at
  ON public.bidding_zone_config_proposals(proposed_at DESC);

DROP TRIGGER IF EXISTS trg_bzcp_set_updated_at ON public.bidding_zone_config_proposals;
CREATE TRIGGER trg_bzcp_set_updated_at
  BEFORE UPDATE ON public.bidding_zone_config_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.bidding_zone_config_proposals IS
  'Queue de propositions de bid_multipliers générées par les algos ML. Mode "suggest" écrit ici, le planner valide, transfert vers bidding_zone_configs.';
COMMENT ON COLUMN public.bidding_zone_config_proposals.reasoning IS
  'Justification de la proposition (model_score, features, drift_context). Lu par l''agent LLM en A4.5.';
COMMENT ON COLUMN public.bidding_zone_config_proposals.proposed_by IS
  'Source de la proposition : ''hoeffding'' (algo ML) ou ''agent_llm'' (futur A4.5).';

-- 1.3 RLS
ALTER TABLE public.bidding_zone_config_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_authenticated" ON public.bidding_zone_config_proposals;
CREATE POLICY "select_authenticated" ON public.bidding_zone_config_proposals
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_admin" ON public.bidding_zone_config_proposals;
CREATE POLICY "insert_admin" ON public.bidding_zone_config_proposals
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = ANY (ARRAY['super_admin','admin']));

DROP POLICY IF EXISTS "update_admin" ON public.bidding_zone_config_proposals;
CREATE POLICY "update_admin" ON public.bidding_zone_config_proposals
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = ANY (ARRAY['super_admin','admin']))
  WITH CHECK (public.get_user_role() = ANY (ARRAY['super_admin','admin']));

-- 1.4 Stratégie démo en mode auto
UPDATE public.bidding_strategies
SET execution_mode = 'auto'
WHERE is_demo = true AND name = 'Pitch Demo — Maximize Leads (Hoeffding)';
