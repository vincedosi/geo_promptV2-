-- =====================================================================
-- Chantier A1 — Extension dsp_campaign_data + tables de mapping flexible
-- =====================================================================
-- Migration ATOMIQUE additive (NULLABLE / DEFAULT). Aucune RPC modifiée,
-- aucune valeur existante touchée.
--
-- Contexte : ETAT_DES_LIEUX_DSP_PILOT.md a tranché de rester sur le legacy
-- public.dsp_campaign_data plutôt que créer un schéma dsp_pilot.* séparé.
-- Cette migration ajoute :
--   1. Colonnes natives DSP modernes sur dsp_campaign_data (nullable)
--   2. Colonnes campagne (kpi_primary, geo_strategy, total_budget…)
--   3. Table dsp_source_mappings : config parser CSV → DB par DSP
--   4. Table dsp_metrics_registry : doc des KPIs (drive dropdowns frontend)
--   5. RLS pattern GEOMATIK (get_user_role()) + indexes performance
--   6. Seeds : 12 KPIs + 18 mappings TTD + 10 mappings Adform (transposés
--      depuis lib/campaigns/column-mappings.ts au 2026-04-28)
--
-- Plan rollback (manuel si besoin) :
--   DROP TABLE IF EXISTS public.dsp_source_mappings CASCADE;
--   DROP TABLE IF EXISTS public.dsp_metrics_registry CASCADE;
--   ALTER TABLE public.dsp_campaign_data
--     DROP COLUMN IF EXISTS impressions,
--     DROP COLUMN IF EXISTS clicks,
--     DROP COLUMN IF EXISTS spend,
--     DROP COLUMN IF EXISTS metrics,
--     DROP COLUMN IF EXISTS dsp_source;
--   ALTER TABLE public.dsp_campaigns
--     DROP COLUMN IF EXISTS kpi_primary,
--     DROP COLUMN IF EXISTS kpi_target,
--     DROP COLUMN IF EXISTS geo_strategy,
--     DROP COLUMN IF EXISTS total_budget,
--     DROP COLUMN IF EXISTS currency;
-- =====================================================================

-- ---------------------------------------------------------------------
-- Étape 1 — Extension dsp_campaign_data
-- ---------------------------------------------------------------------
ALTER TABLE public.dsp_campaign_data
  ADD COLUMN IF NOT EXISTS impressions BIGINT,
  ADD COLUMN IF NOT EXISTS clicks INT,
  ADD COLUMN IF NOT EXISTS spend NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dsp_source TEXT;

COMMENT ON COLUMN public.dsp_campaign_data.impressions IS
  'Impressions natives DSP (TTD/DV360/Meta...). Distinct de tracked_ads (Adform adserver).';
COMMENT ON COLUMN public.dsp_campaign_data.clicks IS
  'Clics. Pas dispo sur Adform legacy (NULL).';
COMMENT ON COLUMN public.dsp_campaign_data.spend IS
  'Dépense € HT post ad-tech fees. Pas dispo sur Adform legacy.';
COMMENT ON COLUMN public.dsp_campaign_data.metrics IS
  'KPIs étendus en JSONB (viewable_impressions, leads, visits, bid_*, video_completions, unique_users...). Lu via dsp_metrics_registry.';
COMMENT ON COLUMN public.dsp_campaign_data.dsp_source IS
  'DSP source de la ligne. Validé via dsp_source_mappings. Redondant avec dsp_campaigns.dsp_source pour requêtes directes sans JOIN.';

CREATE INDEX IF NOT EXISTS idx_dsp_data_metrics_gin
  ON public.dsp_campaign_data USING GIN (metrics);

CREATE INDEX IF NOT EXISTS idx_dsp_data_source
  ON public.dsp_campaign_data(dsp_source) WHERE dsp_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dsp_data_impressions
  ON public.dsp_campaign_data(campaign_id, date) WHERE impressions IS NOT NULL;

-- ---------------------------------------------------------------------
-- Étape 2 — Extension dsp_campaigns
-- ---------------------------------------------------------------------
ALTER TABLE public.dsp_campaigns
  ADD COLUMN IF NOT EXISTS kpi_primary TEXT,
  ADD COLUMN IF NOT EXISTS kpi_target NUMERIC,
  ADD COLUMN IF NOT EXISTS geo_strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS total_budget NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR';

COMMENT ON COLUMN public.dsp_campaigns.kpi_primary IS
  'KPI principal (validé via dsp_metrics_registry.field). Ex: leads, cpa, roas.';
COMMENT ON COLUMN public.dsp_campaigns.kpi_target IS
  'Valeur cible du kpi_primary.';
COMMENT ON COLUMN public.dsp_campaigns.geo_strategy IS
  'Stratégie géo planner : priority_zones, exclusions, etc. JSONB libre.';
COMMENT ON COLUMN public.dsp_campaigns.total_budget IS
  'Budget total de la campagne (currency).';
COMMENT ON COLUMN public.dsp_campaigns.currency IS
  'Devise du budget (ISO 4217). Défaut EUR.';

-- ---------------------------------------------------------------------
-- Étape 3 — CREATE TABLE dsp_source_mappings
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dsp_source_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dsp_source TEXT NOT NULL,
  source_column TEXT NOT NULL,
  target_field TEXT NOT NULL,
  target_location TEXT NOT NULL
    CHECK (target_location IN ('core','metrics','dimension')),
  data_type TEXT NOT NULL
    CHECK (data_type IN ('int','bigint','numeric','text','date','timestamp')),
  transform TEXT,
  is_required BOOLEAN NOT NULL DEFAULT false,
  display_order INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dsp_source, source_column)
);

CREATE INDEX IF NOT EXISTS idx_source_mappings_dsp
  ON public.dsp_source_mappings(dsp_source);

COMMENT ON TABLE public.dsp_source_mappings IS
  'Configuration des mappings CSV → DB par DSP. Le parser d''import lit cette table pour traiter chaque colonne. Ajouter un nouveau DSP = INSERT, sans déploiement.';
COMMENT ON COLUMN public.dsp_source_mappings.target_location IS
  'core = colonne native (impressions, clicks, spend, date, postal_code, country) | metrics = clé dans le JSONB | dimension = colonne native dimensionnelle (creative_id, device_type, format, media)';
COMMENT ON COLUMN public.dsp_source_mappings.transform IS
  'Transformation à appliquer : divide_1000, parse_eu_date, strip_currency, trim, upper, lower, ou NULL.';

DROP TRIGGER IF EXISTS trg_dsp_source_mappings_updated_at ON public.dsp_source_mappings;
CREATE TRIGGER trg_dsp_source_mappings_updated_at
  BEFORE UPDATE ON public.dsp_source_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- Étape 4 — CREATE TABLE dsp_metrics_registry
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dsp_metrics_registry (
  field TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  display_name_fr TEXT,
  unit TEXT,
  description TEXT,
  is_core BOOLEAN NOT NULL DEFAULT false,
  is_kpi_eligible BOOLEAN NOT NULL DEFAULT true,
  optimization_direction TEXT
    CHECK (optimization_direction IN ('maximize','minimize')),
  display_order INT NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  is_legacy BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_registry_enabled
  ON public.dsp_metrics_registry(is_enabled) WHERE is_enabled = true;

COMMENT ON TABLE public.dsp_metrics_registry IS
  'Doc des KPIs disponibles. Drive les dropdowns frontend (sélection KPI primary, axes graphiques). Ajouter un KPI = INSERT.';
COMMENT ON COLUMN public.dsp_metrics_registry.is_core IS
  'TRUE = colonne native sur dsp_campaign_data | FALSE = clé dans metrics JSONB.';
COMMENT ON COLUMN public.dsp_metrics_registry.is_legacy IS
  'TRUE = KPI Adform legacy (tracked_ads, unique_impressions). À garder pour rétrocompat mais pas un KPI moderne.';

DROP TRIGGER IF EXISTS trg_dsp_metrics_registry_updated_at ON public.dsp_metrics_registry;
CREATE TRIGGER trg_dsp_metrics_registry_updated_at
  BEFORE UPDATE ON public.dsp_metrics_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- Étape 5 — RLS policies (pattern GEOMATIK : get_user_role())
-- ---------------------------------------------------------------------
ALTER TABLE public.dsp_source_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dsp_source_mappings_select ON public.dsp_source_mappings;
CREATE POLICY dsp_source_mappings_select
  ON public.dsp_source_mappings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS dsp_source_mappings_modify ON public.dsp_source_mappings;
CREATE POLICY dsp_source_mappings_modify
  ON public.dsp_source_mappings
  FOR ALL TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin','admin']))
  WITH CHECK (get_user_role() = ANY (ARRAY['super_admin','admin']));

ALTER TABLE public.dsp_metrics_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dsp_metrics_registry_select ON public.dsp_metrics_registry;
CREATE POLICY dsp_metrics_registry_select
  ON public.dsp_metrics_registry
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS dsp_metrics_registry_modify ON public.dsp_metrics_registry;
CREATE POLICY dsp_metrics_registry_modify
  ON public.dsp_metrics_registry
  FOR ALL TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin','admin']))
  WITH CHECK (get_user_role() = ANY (ARRAY['super_admin','admin']));

-- ---------------------------------------------------------------------
-- Étape 6a — Seed dsp_metrics_registry (12 KPIs : 3 core + 7 metrics + 2 legacy)
-- ---------------------------------------------------------------------
INSERT INTO public.dsp_metrics_registry
  (field, display_name, display_name_fr, unit, description, is_core, is_kpi_eligible, optimization_direction, display_order, is_legacy)
VALUES
  ('impressions',          'Impressions',           'Impressions',                 'count',         'Nombre total d''impressions servies (DSP natif)',                       true,  true,  'maximize',  10, false),
  ('clicks',               'Clicks',                'Clics',                       'count',         'Nombre total de clics',                                                  true,  true,  'maximize',  20, false),
  ('spend',                'Spend',                 'Dépense',                     'currency_eur',  'Dépense € HT post ad-tech fees',                                         true,  true,  'minimize',  30, false),
  ('viewable_impressions', 'Viewable Impressions',  'Impressions visibles',        'count',         'Impressions visibles selon standard MRC',                                false, true,  'maximize',  40, false),
  ('unique_users',         'Unique Users',          'Utilisateurs uniques',        'count',         'Utilisateurs uniques touchés (non additif sur la durée)',                false, true,  'maximize',  50, false),
  ('bid_requests',         'Bid Requests',          'Bid requests',                'count',         'Nombre de bids émis',                                                    false, false, NULL,        60, false),
  ('bid_won',              'Bid Won',               'Bids gagnés',                 'count',         'Nombre de bids remportés',                                               false, false, NULL,        70, false),
  ('video_completions',    'Video Completions',     'Complétions vidéo',           'count',         'Nombre de vidéos vues à 100%',                                           false, true,  'maximize',  80, false),
  ('visits',               'Visits',                'Visites',                     'count',         'Visites site post-impression (mid-funnel)',                              false, true,  'maximize',  90, false),
  ('leads',                'Leads',                 'Leads',                       'count',         'Conversions bas-funnel attribuées',                                      false, true,  'maximize', 100, false),
  ('tracked_ads',          'Tracked Ads',           'Ads trackées',                'count',         'Adform legacy : ads servies trackées par tag adserver',                  true,  true,  'maximize', 200, true),
  ('unique_impressions',   'Unique Impressions',    'Impressions uniques',         'count',         'Adform legacy : impressions uniques (parfois 0 selon walled gardens)',   true,  false, 'maximize', 210, true)
ON CONFLICT (field) DO NOTHING;

-- ---------------------------------------------------------------------
-- Étape 6b — Seed dsp_source_mappings TTD (18 colonnes)
-- ---------------------------------------------------------------------
INSERT INTO public.dsp_source_mappings
  (dsp_source, source_column, target_field, target_location, data_type, transform, is_required, display_order, notes)
VALUES
  ('ttd', 'campaign_id',          'external_campaign_id', 'dimension', 'text',    NULL,            true,   10, 'ID externe campagne TTD (matché sur dsp_campaigns.name ou champ dédié)'),
  ('ttd', 'campaign_name',        'campaign_name',        'dimension', 'text',    NULL,            false,  20, 'Nom lisible'),
  ('ttd', 'date',                 'date',                 'core',      'date',    NULL,            true,   30, 'YYYY-MM-DD ISO'),
  ('ttd', 'country_code',         'country',              'core',      'text',    'upper',         true,   40, 'ISO-3166-1 alpha-2 → mappé sur colonne country existante'),
  ('ttd', 'postal_code',          'postal_code',          'core',      'text',    'trim',          true,   50, 'String, garder leading zeros'),
  ('ttd', 'impressions',          'impressions',          'core',      'bigint',  NULL,            true,   60, NULL),
  ('ttd', 'clicks',               'clicks',               'core',      'int',     NULL,            true,   70, NULL),
  ('ttd', 'spend',                'spend',                'core',      'numeric', NULL,            true,   80, '€ HT'),
  ('ttd', 'bid_requests',         'bid_requests',         'metrics',   'bigint',  NULL,            false,  90, NULL),
  ('ttd', 'bid_won',              'bid_won',              'metrics',   'bigint',  NULL,            false, 100, NULL),
  ('ttd', 'viewable_impressions', 'viewable_impressions', 'metrics',   'bigint',  NULL,            false, 110, NULL),
  ('ttd', 'unique_users',         'unique_users',         'metrics',   'bigint',  NULL,            false, 120, 'Non additif sur la durée'),
  ('ttd', 'video_completions',    'video_completions',    'metrics',   'int',     NULL,            false, 130, NULL),
  ('ttd', 'visits',               'visits',               'metrics',   'int',     NULL,            false, 140, NULL),
  ('ttd', 'leads',                'leads',                'metrics',   'int',     NULL,            false, 150, NULL),
  ('ttd', 'creative_id',          'creative_id',          'dimension', 'text',    NULL,            false, 160, 'À ajouter en colonne native si besoin futur'),
  ('ttd', 'device_type',          'device_type',          'dimension', 'text',    'lower',         false, 170, 'mobile/desktop/tablet/ctv'),
  ('ttd', 'format',               'format',               'dimension', 'text',    'lower',         false, 180, 'display/video/native')
ON CONFLICT (dsp_source, source_column) DO NOTHING;

-- ---------------------------------------------------------------------
-- Étape 6c — Seed dsp_source_mappings Adform (transposé de lib/campaigns/column-mappings.ts)
--
-- Source : DSP_MAPPINGS.adform (10 entrées) lu le 2026-04-28.
-- Target locations alignés sur PROMPT.md :
--   tracked_ads, unique_impressions, country, postal_code, date → core
--   media, city, region, dma_region, campaign_name → dimension
-- ---------------------------------------------------------------------
INSERT INTO public.dsp_source_mappings
  (dsp_source, source_column, target_field, target_location, data_type, transform, is_required, display_order, notes)
VALUES
  ('adform', 'campaign',            'campaign_name',      'dimension', 'text',   NULL,    false,  10, 'Migration depuis column-mappings.ts'),
  ('adform', 'date',                'date',               'core',      'date',   NULL,    true,   20, 'Migration depuis column-mappings.ts (parser parseDate gère DD/MM/YYYY EU)'),
  ('adform', 'city',                'city',               'dimension', 'text',   NULL,    false,  30, 'Migration depuis column-mappings.ts'),
  ('adform', 'country',             'country',            'core',      'text',   NULL,    true,   40, 'Migration depuis column-mappings.ts'),
  ('adform', 'postal code',         'postal_code',        'core',      'text',   'trim',  true,   50, 'Migration depuis column-mappings.ts (header avec espace)'),
  ('adform', 'region',              'region',             'dimension', 'text',   NULL,    false,  60, 'Migration depuis column-mappings.ts'),
  ('adform', 'dma region',          'dma_region',         'dimension', 'text',   NULL,    false,  70, 'Migration depuis column-mappings.ts'),
  ('adform', 'tracked ads',         'tracked_ads',        'core',      'bigint', NULL,    true,   80, 'Migration depuis column-mappings.ts (KPI legacy core)'),
  ('adform', 'media',               'media',              'dimension', 'text',   NULL,    false,  90, 'Migration depuis column-mappings.ts'),
  ('adform', 'unique impressions',  'unique_impressions', 'core',      'bigint', NULL,    false, 100, 'Migration depuis column-mappings.ts (KPI legacy core, parfois 0 walled gardens)')
ON CONFLICT (dsp_source, source_column) DO NOTHING;
