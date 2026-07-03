/**
 * GENESIS — A4.7 Strategy Wizard : types partagés client/serveur.
 */

export type InventoryType = 'display' | 'video' | 'dooh' | 'ctv' | 'audio';
export type ScopeType = 'national' | 'custom_zone';
export type WeightingMode = 'uniform' | 'by_tier' | 'by_subzone' | 'by_cp_csv' | 'by_insee_variable';
export type AttributionModel = 'last_click' | 'first_click' | 'linear';
export type PacingStrategy = 'even' | 'front_loaded' | 'back_loaded' | 'custom';
export type ExecutionMode = 'monitor_only' | 'suggest' | 'auto';
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type Tier = 'premium_urban' | 'urban' | 'suburban' | 'rural';

export interface UniformWeights { mode: 'uniform'; value: number }
export interface ByTierWeightsT { mode: 'by_tier'; values: Partial<Record<Tier, number>> }
export interface BySubzoneWeights { mode: 'by_subzone'; value?: number }
export interface ByCpCsvWeights { mode: 'by_cp_csv'; values: Record<string, number> }
export interface ExclusionWeights { mode: 'exclusion' }

/** Pondération par variable socio-démo INSEE.
 *  La courbe est définie par une liste de points (x = valeur variable, y = multiplier),
 *  triés par x croissant. Entre deux points : interpolation linéaire.
 *  Avant le premier / après le dernier : on extrapole en valeur constante (clamp). */
export interface ByInseeVariableWeights {
  mode: 'by_insee_variable';
  variable_code: string;            // ex: 'abstention_pres_2022'
  curve: Array<{ x: number; y: number }>;  // ≥ 2 points triés par x croissant
}

export type InZoneWeights = UniformWeights | ByTierWeightsT | BySubzoneWeights | ByCpCsvWeights | ByInseeVariableWeights;
export type OutZoneWeights = UniformWeights | ByTierWeightsT | ExclusionWeights;

export interface Subzone {
  id?: string;
  name: string;
  postal_codes: string[];
  multiplier: number;
}

// Step-by-step state stored in draft_data JSONB
export interface IdentityStep {
  name?: string;
  description?: string;
  advertiser?: string;
  brand?: string;
  internal_reference?: string;
  inventory_type?: InventoryType;
  start_date?: string;
  end_date?: string;
}

export interface GeographyStep {
  scope_type: ScopeType;
  zone_id?: string | null;
  weighting_mode: WeightingMode;
  in_zone_weights: Record<string, unknown>;
  out_zone_weights: Record<string, unknown>;
  subzones?: Subzone[];
}

export interface ObjectiveStep {
  algorithm_code?: string;
  objective_code?: string;
  kpi_target?: number;
  kpi_secondary?: string[];
  attribution_model?: AttributionModel;
}

export interface BudgetStep {
  total_budget?: number;
  currency?: string;
  daily_budget_max?: number;
  pacing_strategy?: PacingStrategy;
  dsp_external_id?: string;
  forecast_cpm?: number;
  frequency_cap_imps?: number;
  frequency_cap_period_days?: number;
}

export interface MLAgentStep {
  algorithm_code?: string;
  init_preset_code?: string;
  execution_mode?: ExecutionMode;
  agent_autonomy_override?: 0 | 1 | 2 | 3 | 4 | null;
  notification_channels?: string[];
  alert_severity_threshold?: AlertSeverity;
}

export interface WizardDraftData {
  identity?: IdentityStep;
  geography?: GeographyStep;
  objective?: ObjectiveStep;
  budget?: BudgetStep;
  mlagent?: MLAgentStep;
}

export interface InitPreset {
  code: string;
  display_name: string;
  display_name_fr: string;
  description: string;
  description_fr: string;
  in_zone_multiplier: number;
  out_zone_multiplier: number;
  is_default: boolean;
  display_order: number;
}

export interface PreviewStats {
  n_in_zone: number;
  n_out_zone: number;
  n_excluded: number;
  n_total_sampled: number;
  avg_multiplier_in: number;
  avg_multiplier_out: number;
  budget_share_in_pct: number;
  budget_share_out_pct: number;
}

export const STEP_LABELS_FR: Record<number, string> = {
  1: 'Identité',
  2: 'Périmètre & Pondération',
  3: 'Objectif',
  4: 'Budget',
  5: 'ML & Agent',
};

export const TIER_LABELS_FR: Record<Tier, string> = {
  premium_urban: 'Premium urbain (Paris, Lyon, Marseille centre)',
  urban: 'Urbain (grandes villes)',
  suburban: 'Suburbain (banlieues + couronne IDF)',
  rural: 'Rural',
};

export const AUTONOMY_LABELS_FR: Record<number, string> = {
  0: 'Observer (lecture seule)',
  1: 'Explainer (explique sans agir)',
  2: 'Suggester (propose, valide manuelle)',
  3: 'Auto low-risk (agit sans confirm sur low)',
  4: 'Full-auto (agit sur tout)',
};

// ─────────────────────────────────────────────────────────────────────────────
// Mappings code → libellé FR — utilisés par Step6Recap et tous les selects
// pour ne JAMAIS afficher de snake_case à l'utilisateur final.
// ─────────────────────────────────────────────────────────────────────────────

export const INVENTORY_LABELS_FR: Record<InventoryType, string> = {
  display: 'Display',
  video:   'Vidéo',
  dooh:    'DOOH',
  ctv:     'CTV',
  audio:   'Audio',
};

export const SCOPE_LABELS_FR: Record<ScopeType, string> = {
  national:    'National (toute la France)',
  custom_zone: 'Zone custom',
};

export const WEIGHTING_MODE_LABELS_FR: Record<WeightingMode, string> = {
  uniform:           'Uniforme',
  by_tier:           'Par tier',
  by_subzone:        'Par sous-zone',
  by_cp_csv:         'CSV par CP',
  by_insee_variable: 'Par variable INSEE',
};

export const ATTRIBUTION_LABELS_FR: Record<AttributionModel, string> = {
  last_click:  'Last-click',
  first_click: 'First-click',
  linear:      'Linéaire',
};

export const PACING_LABELS_FR: Record<PacingStrategy, string> = {
  even:         'Régulière',
  front_loaded: 'Anticipée (front-loaded)',
  back_loaded:  'Différée (back-loaded)',
  custom:       'Personnalisée',
};

export const EXECUTION_MODE_LABELS_FR: Record<ExecutionMode, string> = {
  monitor_only: 'Surveiller',
  suggest:      'Suggérer',
  auto:         'Automatique',
};

export const EXECUTION_MODE_DESC_FR: Record<ExecutionMode, string> = {
  monitor_only: "L'algorithme observe sans agir",
  suggest:      'Propose, vous validez (recommandé)',
  auto:         "L'algorithme agit seul, sans confirmation",
};

export const ALERT_SEVERITY_LABELS_FR: Record<AlertSeverity, string> = {
  low:      'Faible',
  medium:   'Moyenne',
  high:     'Élevée',
  critical: 'Critique',
};

export const NOTIFICATION_CHANNEL_LABELS_FR: Record<string, string> = {
  in_app: 'Dans l\'app',
  email:  'Email',
  slack:  'Slack',
};

/**
 * Algorithme : on garde le code technique en sous-label,
 * label principal = nom marketing court.
 */
export const ALGORITHM_LABELS_FR: Record<string, string> = {
  hoeffding_adaptive_tree: 'Adaptatif',
  online_lgbm:             'Gradient boosting',
  contextual_bandit:       'Bandit contextuel',
  thompson_sampling:       'Thompson sampling',
  // fallback : le code lui-même (snake_case) si non listé
};

/** Helper unique pour résoudre n'importe quel code → libellé FR ou fallback. */
export function frLabel<T extends string>(
  map: Record<string, string>,
  code: T | undefined | null,
  fallback = '—',
): string {
  if (code === null || code === undefined || code === '') return fallback;
  return map[code] ?? code;
}
