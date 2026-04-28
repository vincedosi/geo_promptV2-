-- =====================================================================
-- Chantier A4.1 — Custom Bidding : Schéma DB (8 tables + is_demo + RLS)
-- =====================================================================
-- Ne crée PAS de RPC métier (réservé pour A4.3).
-- RLS pattern GEOMATIK : SELECT auth + ALL admin via get_user_role().

ALTER TABLE public.dsp_campaigns
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_dsp_campaigns_demo
  ON public.dsp_campaigns(is_demo) WHERE is_demo = true;
COMMENT ON COLUMN public.dsp_campaigns.is_demo IS
  'TRUE = campagne démo pour pitch (ttd_test_dataset). Distingue du réel et permet de filtrer en prod.';

CREATE TABLE IF NOT EXISTS public.bidding_algorithms (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  display_name_fr TEXT,
  description TEXT,
  family TEXT NOT NULL,
  library TEXT,
  config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  supports_drift_detection BOOLEAN NOT NULL DEFAULT true,
  supports_online_learning BOOLEAN NOT NULL DEFAULT true,
  is_baseline BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bidding_algos_enabled ON public.bidding_algorithms(is_enabled) WHERE is_enabled = true;

CREATE TABLE IF NOT EXISTS public.bidding_objectives (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  display_name_fr TEXT,
  description TEXT,
  optimization_direction TEXT NOT NULL CHECK (optimization_direction IN ('maximize','minimize')),
  required_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  formula TEXT,
  unit TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.bidding_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  campaign_id UUID NOT NULL REFERENCES public.dsp_campaigns(id) ON DELETE CASCADE,
  algorithm_code TEXT NOT NULL REFERENCES public.bidding_algorithms(code),
  objective_code TEXT NOT NULL REFERENCES public.bidding_objectives(code),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope_type TEXT NOT NULL DEFAULT 'national' CHECK (scope_type IN ('custom_zone','national')),
  zone_id UUID REFERENCES public.custom_geo_zones(id) ON DELETE RESTRICT,
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','archived')),
  activated_at TIMESTAMPTZ,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bs_zone_scope_consistent CHECK (
    (scope_type = 'custom_zone' AND zone_id IS NOT NULL)
    OR (scope_type = 'national' AND zone_id IS NULL)
  ),
  CONSTRAINT bs_dates_consistent CHECK (
    end_date IS NULL OR start_date IS NULL OR end_date >= start_date
  )
);
CREATE INDEX IF NOT EXISTS idx_bidding_strats_campaign ON public.bidding_strategies(campaign_id);
CREATE INDEX IF NOT EXISTS idx_bidding_strats_status ON public.bidding_strategies(status) WHERE status IN ('active','paused');
CREATE INDEX IF NOT EXISTS idx_bidding_strats_zone ON public.bidding_strategies(zone_id) WHERE zone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bidding_strats_demo ON public.bidding_strategies(is_demo) WHERE is_demo = true;
DROP TRIGGER IF EXISTS tr_bidding_strats_updated ON public.bidding_strategies;
CREATE TRIGGER tr_bidding_strats_updated BEFORE UPDATE ON public.bidding_strategies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.bidding_zone_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  postal_code TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'FR',
  bid_multiplier NUMERIC(6,3) NOT NULL DEFAULT 1.000,
  floor_bid NUMERIC(10,4),
  ceiling_bid NUMERIC(10,4),
  weight NUMERIC(6,3) NOT NULL DEFAULT 1.000,
  target_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, postal_code, country_code),
  CONSTRAINT bzc_bid_multiplier_positive CHECK (bid_multiplier > 0),
  CONSTRAINT bzc_floor_ceiling_consistent CHECK (
    floor_bid IS NULL OR ceiling_bid IS NULL OR ceiling_bid >= floor_bid
  )
);
CREATE INDEX IF NOT EXISTS idx_bzc_strategy_active ON public.bidding_zone_configs(strategy_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_bzc_postal ON public.bidding_zone_configs(postal_code, country_code);
DROP TRIGGER IF EXISTS tr_bzc_updated ON public.bidding_zone_configs;
CREATE TRIGGER tr_bzc_updated BEFORE UPDATE ON public.bidding_zone_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.bidding_daily_state (
  id BIGSERIAL PRIMARY KEY,
  strategy_id UUID NOT NULL REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  postal_code TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'FR',
  date DATE NOT NULL,
  applied_bid_multiplier NUMERIC(6,3) NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  conversions BIGINT NOT NULL DEFAULT 0,
  spend NUMERIC(12,4) NOT NULL DEFAULT 0,
  revenue NUMERIC(12,4),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_decision JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, postal_code, country_code, date)
);
CREATE INDEX IF NOT EXISTS idx_bds_strategy_date ON public.bidding_daily_state(strategy_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_bds_postal_date ON public.bidding_daily_state(postal_code, date DESC);
CREATE INDEX IF NOT EXISTS idx_bds_metrics_gin ON public.bidding_daily_state USING GIN (metrics);

CREATE TABLE IF NOT EXISTS public.bidding_simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID REFERENCES public.bidding_strategies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  parameters JSONB NOT NULL,
  baseline_metrics JSONB,
  simulated_metrics JSONB,
  delta JSONB,
  zone_results JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bsim_strategy ON public.bidding_simulations(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bsim_status ON public.bidding_simulations(status) WHERE status IN ('pending','running');

CREATE TABLE IF NOT EXISTS public.adaptive_model_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  algorithm_code TEXT NOT NULL REFERENCES public.bidding_algorithms(code),
  model_version TEXT NOT NULL,
  parameters JSONB NOT NULL,
  hyperparameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  training_window_start DATE,
  training_window_end DATE,
  performance_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT false,
  trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  promoted_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE (strategy_id, model_version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ams_one_active
  ON public.adaptive_model_state(strategy_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ams_strategy ON public.adaptive_model_state(strategy_id);

CREATE TABLE IF NOT EXISTS public.bidding_drift_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  postal_code TEXT,
  country_code TEXT DEFAULT 'FR',
  model_state_id UUID REFERENCES public.adaptive_model_state(id),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  drift_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  metric_before JSONB,
  metric_after JSONB,
  delta NUMERIC,
  threshold NUMERIC,
  description TEXT,
  auto_action TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bde_strategy ON public.bidding_drift_events(strategy_id);
CREATE INDEX IF NOT EXISTS idx_bde_unresolved ON public.bidding_drift_events(strategy_id, severity) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bde_detected ON public.bidding_drift_events(detected_at DESC);

-- RLS pattern GEOMATIK (get_user_role)
ALTER TABLE public.bidding_algorithms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bidding_algorithms_select ON public.bidding_algorithms;
CREATE POLICY bidding_algorithms_select ON public.bidding_algorithms FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS bidding_algorithms_modify ON public.bidding_algorithms;
CREATE POLICY bidding_algorithms_modify ON public.bidding_algorithms FOR ALL TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin','admin']))
  WITH CHECK (get_user_role() = ANY (ARRAY['super_admin','admin']));

ALTER TABLE public.bidding_objectives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bidding_objectives_select ON public.bidding_objectives;
CREATE POLICY bidding_objectives_select ON public.bidding_objectives FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS bidding_objectives_modify ON public.bidding_objectives;
CREATE POLICY bidding_objectives_modify ON public.bidding_objectives FOR ALL TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin','admin']))
  WITH CHECK (get_user_role() = ANY (ARRAY['super_admin','admin']));

ALTER TABLE public.bidding_strategies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bidding_strategies_select ON public.bidding_strategies;
CREATE POLICY bidding_strategies_select ON public.bidding_strategies FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS bidding_strategies_insert ON public.bidding_strategies;
CREATE POLICY bidding_strategies_insert ON public.bidding_strategies FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() OR get_user_role() = ANY (ARRAY['super_admin','admin']));
DROP POLICY IF EXISTS bidding_strategies_update ON public.bidding_strategies;
CREATE POLICY bidding_strategies_update ON public.bidding_strategies FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR get_user_role() = ANY (ARRAY['super_admin','admin']))
  WITH CHECK (created_by = auth.uid() OR get_user_role() = ANY (ARRAY['super_admin','admin']));
DROP POLICY IF EXISTS bidding_strategies_delete ON public.bidding_strategies;
CREATE POLICY bidding_strategies_delete ON public.bidding_strategies FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin','admin']));

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bidding_zone_configs','bidding_daily_state','bidding_simulations',
    'adaptive_model_state','bidding_drift_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_modify ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_modify ON public.%I FOR ALL TO authenticated '
      'USING (get_user_role() = ANY (ARRAY[''super_admin'',''admin''])) '
      'WITH CHECK (get_user_role() = ANY (ARRAY[''super_admin'',''admin'']))',
      t, t
    );
  END LOOP;
END $$;
