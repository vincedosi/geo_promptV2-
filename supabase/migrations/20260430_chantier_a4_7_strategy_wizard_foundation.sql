-- =====================================================================
-- A4.7 — Wizard de configuration de stratégie : foundation DB
-- =====================================================================
-- Tables nouvelles :
--   * bidding_init_presets         — 5 presets de pondération (boost_light, focus, exclusive, neutral, custom)
--   * bidding_strategy_drafts      — autosave wizard (1s debounce, expire 30j)
--   * bidding_strategy_subzones    — sous-zones avec multipliers individuels (mode by_subzone)
--   * strategy_changes             — audit trail conformité Dentsu/Renault
--
-- ALTER additif sur bidding_strategies : 19 colonnes (advertiser, brand,
--   inventory_type, kpi_secondary, weighting_mode, in_zone_weights JSONB, etc.)
--
-- RPCs nouvelles :
--   * infer_tier(postal_code TEXT) → TEXT     — classement CP en 4 tiers
--   * apply_zone_weights_to_strategy(...)     — peuple bidding_zone_configs
--   * log_strategy_change(...)                — INSERT helper audit trail
--
-- Adform legacy strict : intacte (4 / 294 135 / 172 056 383)
-- =====================================================================

-- -----------------------------------------------------
-- 1. ALTER additif sur bidding_strategies
-- -----------------------------------------------------
ALTER TABLE public.bidding_strategies
  ADD COLUMN IF NOT EXISTS advertiser TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS internal_reference TEXT,
  ADD COLUMN IF NOT EXISTS inventory_type TEXT
    CHECK (inventory_type IS NULL OR inventory_type IN ('display','video','dooh','ctv','audio')),
  ADD COLUMN IF NOT EXISTS dsp_external_id TEXT,
  ADD COLUMN IF NOT EXISTS kpi_target NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS kpi_secondary TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS attribution_model TEXT
    CHECK (attribution_model IS NULL OR attribution_model IN ('last_click','first_click','linear')),
  ADD COLUMN IF NOT EXISTS total_budget NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS daily_budget_max NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS pacing_strategy TEXT
    CHECK (pacing_strategy IS NULL OR pacing_strategy IN ('even','front_loaded','back_loaded','custom')),
  ADD COLUMN IF NOT EXISTS forecast_cpm NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS frequency_cap_imps INT,
  ADD COLUMN IF NOT EXISTS frequency_cap_period_days INT,
  ADD COLUMN IF NOT EXISTS granularity TEXT NOT NULL DEFAULT 'postal_code'
    CHECK (granularity IN ('postal_code','iris')),
  ADD COLUMN IF NOT EXISTS init_preset_code TEXT,
  ADD COLUMN IF NOT EXISTS weighting_mode TEXT NOT NULL DEFAULT 'uniform'
    CHECK (weighting_mode IN ('uniform','by_tier','by_subzone','by_cp_csv')),
  ADD COLUMN IF NOT EXISTS in_zone_weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS out_zone_weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notification_channels TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS alert_severity_threshold TEXT
    CHECK (alert_severity_threshold IS NULL OR alert_severity_threshold IN ('low','medium','high','critical')),
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.bidding_strategies.in_zone_weights IS
  'JSONB : { "mode":"uniform","value":1.5 } OR { "mode":"by_tier","values":{"premium_urban":2.0,...} } OR { "mode":"by_subzone" }';

COMMENT ON COLUMN public.bidding_strategies.out_zone_weights IS
  'JSONB : { "mode":"uniform","value":0.7 } OR { "mode":"exclusion" } OR { "mode":"by_tier","values":{...} }';

COMMENT ON COLUMN public.bidding_strategies.weighting_mode IS
  'Mode de pondération : uniform | by_tier | by_subzone | by_cp_csv';


-- -----------------------------------------------------
-- 2. Table bidding_init_presets
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bidding_init_presets (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  display_name_fr TEXT NOT NULL,
  description TEXT NOT NULL,
  description_fr TEXT NOT NULL,
  in_zone_multiplier NUMERIC(6,3) NOT NULL,
  out_zone_multiplier NUMERIC(6,3) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  display_order INT NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.bidding_init_presets
  (code, display_name, display_name_fr, description, description_fr,
   in_zone_multiplier, out_zone_multiplier, is_default, display_order)
VALUES
  ('boost_light','Light Boost','Boost léger',
   'Moderate boost on the priority zone, slight reduction outside',
   'Boost modéré sur la zone prioritaire, légère réduction hors zone',
   1.5, 0.7, true, 10),
  ('focus','Focused','Focalisé',
   'Strong concentration on the zone, significant reduction outside',
   'Forte concentration sur la zone, réduction marquée hors zone',
   2.0, 0.3, false, 20),
  ('exclusive','Zone Only','Zone exclusive',
   'Bidding exclusively on the zone, no spend outside',
   'Bidding exclusivement sur la zone, aucune dépense hors zone',
   2.5, 0.0, false, 30),
  ('neutral','Neutral','Neutre',
   'Equal weights everywhere — algorithm learns from scratch',
   'Poids égaux partout — l''algorithme apprend tout seul',
   1.0, 1.0, false, 40),
  ('custom','Custom','Personnalisé',
   'Define multipliers manually per tier or by CSV upload',
   'Définir les multipliers manuellement par tier ou par CSV',
   1.0, 1.0, false, 100)
ON CONFLICT (code) DO NOTHING;


-- -----------------------------------------------------
-- 3. Table bidding_strategy_drafts
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bidding_strategy_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.dsp_campaigns(id) ON DELETE CASCADE,
  current_step INT NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
  draft_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  consumed_at TIMESTAMPTZ,
  resulting_strategy_id UUID REFERENCES public.bidding_strategies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_bsd_user_active
  ON public.bidding_strategy_drafts(user_id, last_saved_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bsd_expires
  ON public.bidding_strategy_drafts(expires_at)
  WHERE consumed_at IS NULL;

DROP TRIGGER IF EXISTS tr_bsd_updated ON public.bidding_strategy_drafts;
CREATE TRIGGER tr_bsd_updated
  BEFORE UPDATE ON public.bidding_strategy_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.bidding_strategy_drafts IS
  'Brouillons de configuration en cours d''édition. Autosave 1s debounce. Expirent à 30j.';


-- -----------------------------------------------------
-- 4. Table bidding_strategy_subzones
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bidding_strategy_subzones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  postal_codes TEXT[] NOT NULL,
  multiplier NUMERIC(6,3) NOT NULL CHECK (multiplier >= 0 AND multiplier <= 5),
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bss_strategy
  ON public.bidding_strategy_subzones(strategy_id, display_order);

DROP TRIGGER IF EXISTS tr_bss_updated ON public.bidding_strategy_subzones;
CREATE TRIGGER tr_bss_updated
  BEFORE UPDATE ON public.bidding_strategy_subzones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.bidding_strategy_subzones IS
  'Sous-zones avec multipliers individuels (mode by_subzone). Ex : "Métropole Rennes" → ×2.0';


-- -----------------------------------------------------
-- 5. Table strategy_changes (audit trail)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strategy_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL CHECK (change_type IN (
    'created','config_updated','scope_changed','weighting_updated',
    'preset_applied','subzones_modified','mode_changed','autonomy_changed',
    'paused','resumed','archived','reactivated'
  )),
  field_path TEXT,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'user'
    CHECK (triggered_by IN ('user','agent','system','api')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sc_strategy
  ON public.strategy_changes(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_user
  ON public.strategy_changes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_type
  ON public.strategy_changes(change_type, created_at DESC);

COMMENT ON TABLE public.strategy_changes IS
  'Audit trail complet des modifications de stratégie. Conformité Dentsu/Renault.';


-- -----------------------------------------------------
-- 6. RLS
-- -----------------------------------------------------
ALTER TABLE public.bidding_init_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bidding_strategy_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bidding_strategy_subzones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_changes ENABLE ROW LEVEL SECURITY;

-- bidding_init_presets : SELECT public, write admin only
DROP POLICY IF EXISTS bip_select ON public.bidding_init_presets;
CREATE POLICY bip_select ON public.bidding_init_presets FOR SELECT USING (true);

DROP POLICY IF EXISTS bip_write ON public.bidding_init_presets;
CREATE POLICY bip_write ON public.bidding_init_presets FOR ALL
  USING (get_user_role() = ANY (ARRAY['super_admin'::text,'admin'::text]))
  WITH CHECK (get_user_role() = ANY (ARRAY['super_admin'::text,'admin'::text]));

-- bidding_strategy_drafts : owner-only
DROP POLICY IF EXISTS bsd_select ON public.bidding_strategy_drafts;
CREATE POLICY bsd_select ON public.bidding_strategy_drafts FOR SELECT
  USING (user_id = auth.uid()
         OR get_user_role() = ANY (ARRAY['super_admin'::text,'admin'::text]));

DROP POLICY IF EXISTS bsd_insert ON public.bidding_strategy_drafts;
CREATE POLICY bsd_insert ON public.bidding_strategy_drafts FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS bsd_update ON public.bidding_strategy_drafts;
CREATE POLICY bsd_update ON public.bidding_strategy_drafts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS bsd_delete ON public.bidding_strategy_drafts;
CREATE POLICY bsd_delete ON public.bidding_strategy_drafts FOR DELETE
  USING (user_id = auth.uid()
         OR get_user_role() = ANY (ARRAY['super_admin'::text,'admin'::text]));

-- bidding_strategy_subzones : SELECT authenticated, write admin
DROP POLICY IF EXISTS bss_select ON public.bidding_strategy_subzones;
CREATE POLICY bss_select ON public.bidding_strategy_subzones FOR SELECT USING (true);

DROP POLICY IF EXISTS bss_write ON public.bidding_strategy_subzones;
CREATE POLICY bss_write ON public.bidding_strategy_subzones FOR ALL
  USING (get_user_role() = ANY (ARRAY['super_admin'::text,'admin'::text]))
  WITH CHECK (get_user_role() = ANY (ARRAY['super_admin'::text,'admin'::text]));

-- strategy_changes : SELECT auth, INSERT only via SECURITY DEFINER RPC
DROP POLICY IF EXISTS sc_select ON public.strategy_changes;
CREATE POLICY sc_select ON public.strategy_changes FOR SELECT USING (true);


-- -----------------------------------------------------
-- 7. RPC infer_tier(postal_code)
-- -----------------------------------------------------
-- Classement simple basé sur le code postal :
--   75xxx, 92xxx, 69001-69009, 13001-13016, 33000  → premium_urban
--   préfixes des grandes métros (33, 31, 67, 44, 59, 06, 21, 38) → urban
--   départements 91-95, 78, 77, 13, 69 hors centre  → suburban
--   sinon                                            → rural
CREATE OR REPLACE FUNCTION public.infer_tier(p_postal_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_dept TEXT;
  v_full TEXT;
BEGIN
  IF p_postal_code IS NULL OR length(p_postal_code) < 2 THEN
    RETURN 'rural';
  END IF;

  v_dept := substring(p_postal_code FROM 1 FOR 2);
  v_full := p_postal_code;

  -- Premium urbain : Paris intra-muros, Lyon centre, Marseille centre, Bordeaux centre
  IF v_dept = '75' THEN RETURN 'premium_urban'; END IF;
  IF v_full = ANY (ARRAY['69001','69002','69003','69004','69005','69006','69007','69008','69009']) THEN RETURN 'premium_urban'; END IF;
  IF v_full = ANY (ARRAY['13001','13002','13003','13004','13005','13006','13007','13008']) THEN RETURN 'premium_urban'; END IF;
  IF v_full IN ('33000','31000','44000','59000','67000','06000','06400','06500','21000','38000','35000','34000','54000','37000','45000','42000','51100','64000','76000','86000','87000','49000','50000','60200','71000','72000','74000','17000','19000','25000','26000','29200','30000','38200','41000','58000','63000','79000','80000','81000','82000','83000','85000','89000','27000','08000') THEN RETURN 'premium_urban'; END IF;

  -- Urbain : départements à forte densité urbaine
  IF v_dept IN ('92','93','94','69','13','33','31','44','59','67','06','21','38','35','34','54','37','45','42','51','64','76','86','87','49','50','60','71','72','74','17','19','25','26','29','30','41','58','63','79','80','81','82','83','85','89','27','08') THEN
    RETURN 'urban';
  END IF;

  -- Suburbain : couronne IDF + départements péri-métropolitains
  IF v_dept IN ('77','78','91','95','01','38','62','57','68','73','11','15','22','24','40','46','47','55','56','61','65','66','84','88') THEN
    RETURN 'suburban';
  END IF;

  RETURN 'rural';
END;
$$;

COMMENT ON FUNCTION public.infer_tier IS
  'Classement simple d''un code postal en 4 tiers : premium_urban / urban / suburban / rural. Heuristique géographique sans réf externe.';


-- -----------------------------------------------------
-- 8. RPC apply_zone_weights_to_strategy
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_zone_weights_to_strategy(
  p_strategy_id UUID,
  p_in_weights JSONB,
  p_out_weights JSONB
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_zone_id UUID;
  v_n_inserted INT := 0;
  v_in_mode TEXT;
  v_out_mode TEXT;
BEGIN
  SELECT zone_id INTO v_zone_id FROM bidding_strategies WHERE id = p_strategy_id;

  v_in_mode  := COALESCE(p_in_weights->>'mode',  'uniform');
  v_out_mode := COALESCE(p_out_weights->>'mode', 'uniform');

  -- Reset configs existantes
  DELETE FROM bidding_zone_configs WHERE strategy_id = p_strategy_id;

  -- Cas 1 : pas de zone (national) → multiplier uniforme partout sur tous les CPs FR connus
  IF v_zone_id IS NULL THEN
    INSERT INTO bidding_zone_configs (strategy_id, postal_code, country_code, bid_multiplier, is_active)
    SELECT
      p_strategy_id,
      cp.postal_code,
      'FR',
      GREATEST(0, LEAST(5,
        CASE
          WHEN v_in_mode = 'uniform' THEN COALESCE((p_in_weights->>'value')::numeric, 1.0)
          WHEN v_in_mode = 'by_tier' THEN COALESCE((p_in_weights->'values'->>infer_tier(cp.postal_code))::numeric, 1.0)
          ELSE 1.0
        END
      )),
      true
    FROM (
      SELECT DISTINCT postal_code FROM dsp_campaign_data WHERE postal_code IS NOT NULL
    ) cp;

    GET DIAGNOSTICS v_n_inserted = ROW_COUNT;
    RETURN v_n_inserted;
  END IF;

  -- Cas 2 : zone définie → in/out CPs séparés
  WITH all_fr_cps AS (
    SELECT DISTINCT postal_code FROM dsp_campaign_data WHERE postal_code IS NOT NULL
  ),
  zone_cps AS (
    SELECT DISTINCT cgzc.code AS postal_code
    FROM custom_geo_zone_codes cgzc
    WHERE cgzc.zone_id = v_zone_id AND cgzc.code_type = 'cp'
  ),
  classified AS (
    SELECT
      cp.postal_code,
      (zc.postal_code IS NOT NULL) AS is_in_zone
    FROM all_fr_cps cp
    LEFT JOIN zone_cps zc ON zc.postal_code = cp.postal_code
  ),
  with_multiplier AS (
    SELECT
      c.postal_code,
      CASE
        -- IN ZONE
        WHEN c.is_in_zone AND v_in_mode = 'uniform' THEN
          COALESCE((p_in_weights->>'value')::numeric, 1.0)
        WHEN c.is_in_zone AND v_in_mode = 'by_tier' THEN
          COALESCE((p_in_weights->'values'->>infer_tier(c.postal_code))::numeric, 1.0)
        WHEN c.is_in_zone AND v_in_mode = 'by_subzone' THEN
          COALESCE((p_in_weights->>'value')::numeric, 1.0)  -- override par UPDATE après
        WHEN c.is_in_zone AND v_in_mode = 'by_cp_csv' THEN
          COALESCE((p_in_weights->'values'->>c.postal_code)::numeric, 1.0)
        -- OUT ZONE
        WHEN NOT c.is_in_zone AND v_out_mode = 'uniform' THEN
          COALESCE((p_out_weights->>'value')::numeric, 1.0)
        WHEN NOT c.is_in_zone AND v_out_mode = 'exclusion' THEN
          0.0
        WHEN NOT c.is_in_zone AND v_out_mode = 'by_tier' THEN
          COALESCE((p_out_weights->'values'->>infer_tier(c.postal_code))::numeric, 1.0)
        ELSE 1.0
      END AS multiplier
    FROM classified c
  )
  INSERT INTO bidding_zone_configs (strategy_id, postal_code, country_code, bid_multiplier, is_active)
  SELECT p_strategy_id, postal_code, 'FR', GREATEST(0, LEAST(5, multiplier)), true
  FROM with_multiplier
  WHERE multiplier IS NOT NULL;

  GET DIAGNOSTICS v_n_inserted = ROW_COUNT;

  -- Override par sous-zones si by_subzone
  IF v_in_mode = 'by_subzone' THEN
    UPDATE bidding_zone_configs bzc
    SET bid_multiplier = GREATEST(0, LEAST(5, sz.multiplier))
    FROM bidding_strategy_subzones sz
    WHERE bzc.strategy_id = p_strategy_id
      AND bzc.postal_code = ANY(sz.postal_codes)
      AND sz.strategy_id = p_strategy_id;
  END IF;

  RETURN v_n_inserted;
END;
$$;

COMMENT ON FUNCTION public.apply_zone_weights_to_strategy IS
  'Calcule et insère les bid_multipliers pour tous les CPs FR selon les weights in_zone et out_zone. Retourne le nombre de rows insérées.';


-- -----------------------------------------------------
-- 9. RPC log_strategy_change (helper SECURITY DEFINER)
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_strategy_change(
  p_strategy_id UUID,
  p_change_type TEXT,
  p_field_path TEXT DEFAULT NULL,
  p_old_value JSONB DEFAULT NULL,
  p_new_value JSONB DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_triggered_by TEXT DEFAULT 'user'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO strategy_changes
    (strategy_id, user_id, change_type, field_path, old_value, new_value, reason, triggered_by)
  VALUES
    (p_strategy_id, auth.uid(), p_change_type, p_field_path, p_old_value, p_new_value, p_reason, p_triggered_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_strategy_change IS
  'Helper INSERT pour audit trail strategy_changes. Écrit auth.uid() automatiquement.';
