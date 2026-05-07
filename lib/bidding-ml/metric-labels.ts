/**
 * Helpers de labellisation métier-aware pour le module Custom Bidding.
 * La métrique principale d'une stratégie est lue dynamiquement depuis
 * `bidding_objectives.required_metrics[0]` (cf. PilotageOverlay) — on adapte
 * tout le wording (cartes, KPI, hero) en fonction.
 */

export type PrimaryMetric = 'impressions' | 'clicks' | 'leads' | 'spend';

export interface MetricLabels {
  /** Nom court de la métrique principale, sentence case. Ex: "Impressions". */
  name: string;
  /** Nom du coût unitaire associé. CPM pour impressions, CPC pour clics, CPL pour leads. */
  costName: string;
  /** Label de performance global. Ex: "Couverture", "Taux de clic", "Conversion". */
  perfLabel: string;
  /** Format de la valeur principale (entier français). */
  formatMain: (n: number) => string;
  /** Format du coût unitaire (€ avec 2 décimales). */
  formatCost: (n: number) => string;
  /** Suffixe d'unité courte pour mini-affichage (ex: "imp.", "leads"). */
  unitShort: string;
}

const fmtCount = (n: number) =>
  Math.round(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const fmtEur2 = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

const TABLE: Record<PrimaryMetric, MetricLabels> = {
  impressions: {
    name: 'Impressions',
    costName: 'CPM',
    perfLabel: 'Couverture',
    formatMain: fmtCount,
    formatCost: fmtEur2,
    unitShort: 'imp.',
  },
  clicks: {
    name: 'Clics',
    costName: 'CPC',
    perfLabel: 'Taux de clic',
    formatMain: fmtCount,
    formatCost: fmtEur2,
    unitShort: 'clics',
  },
  leads: {
    name: 'Leads',
    costName: 'CPL',
    perfLabel: 'Conversion',
    formatMain: fmtCount,
    formatCost: fmtEur2,
    unitShort: 'leads',
  },
  spend: {
    name: 'Spend',
    costName: 'CPM',
    perfLabel: 'Efficience',
    formatMain: fmtEur2,
    formatCost: fmtEur2,
    unitShort: '€',
  },
};

const ALIASES: Record<string, PrimaryMetric> = {
  // Impressions (et synonymes / objectifs orientés diffusion)
  impressions: 'impressions',
  imps: 'impressions',
  imp: 'impressions',
  viewable_impressions: 'impressions',
  visits: 'impressions',           // DOOH "visits" = expositions tracked
  visit: 'impressions',
  reach: 'impressions',
  awareness: 'impressions',
  maximize_impressions: 'impressions',
  maximize_viewability: 'impressions',
  maximize_visits: 'impressions',
  maximize_reach: 'impressions',
  // Clics
  clicks: 'clicks',
  click: 'clicks',
  ctr: 'clicks',
  maximize_ctr: 'clicks',
  minimize_cpc: 'clicks',
  // Leads / conversions
  leads: 'leads',
  lead: 'leads',
  cpa: 'leads',
  cpl: 'leads',
  conversions: 'leads',
  maximize_leads: 'leads',
  minimize_cpa: 'leads',
  // Spend / ROAS
  spend: 'spend',
  cost: 'spend',
  maximize_roas: 'spend',
};

export function resolvePrimaryMetric(raw: string | null | undefined): PrimaryMetric {
  if (!raw) return 'leads';
  const k = raw.toLowerCase().trim();
  return ALIASES[k] ?? 'leads';
}

export function getMetricLabels(raw: string | null | undefined): MetricLabels {
  return TABLE[resolvePrimaryMetric(raw)];
}

/**
 * Mapping `primaryMetric` → champ ComparisonRow utilisé pour les calculs.
 */
export function metricFields(metric: PrimaryMetric): { real: string; sim: string } {
  if (metric === 'spend') return { real: 'spend_real', sim: 'spend_sim' };
  return { real: `${metric}_real`, sim: `${metric}_sim` };
}

/**
 * Mapping `weighting_mode` → label de la cible métier.
 *
 * Pour `by_insee_variable` avec `variable_code = 'abstention_pres_2022'` :
 * la cible est "zones à fort taux d'abstention". Pour `uniform` ou `by_subzone`,
 * pas de cible métier explicite — le label reste générique.
 */
export interface WeightingTarget {
  /** Code variable INSEE si applicable (ex: 'abstention_pres_2022'). */
  variableCode: string | null;
  /** Label court de la variable cible (ex: "taux d'abstention"). */
  variableLabel: string | null;
  /** Label des zones cibles (ex: "zones à fort taux d'abstention"). */
  targetLabel: string;
  /** Sens d'optimisation : true = on vise les valeurs HAUTES, false = les valeurs BASSES. */
  highIsTarget: boolean;
}

const VARIABLE_LABELS: Record<string, { label: string; targetLabel: string; highIsTarget: boolean }> = {
  abstention_pres_2022: {
    label: "taux d'abstention",
    targetLabel: "zones à fort taux d'abstention",
    highIsTarget: true,
  },
};

export function resolveWeightingTarget(
  weightingMode: string | null | undefined,
  inZoneWeights: Record<string, unknown> | null | undefined,
): WeightingTarget {
  if (weightingMode === 'by_insee_variable' && inZoneWeights) {
    const code = typeof inZoneWeights.variable_code === 'string' ? inZoneWeights.variable_code : null;
    if (code && VARIABLE_LABELS[code]) {
      const cfg = VARIABLE_LABELS[code];
      return {
        variableCode: code,
        variableLabel: cfg.label,
        targetLabel: cfg.targetLabel,
        highIsTarget: cfg.highIsTarget,
      };
    }
    if (code) {
      return {
        variableCode: code,
        variableLabel: code,
        targetLabel: `zones à forte ${code}`,
        highIsTarget: true,
      };
    }
  }
  return {
    variableCode: null,
    variableLabel: null,
    targetLabel: 'zones cibles',
    highIsTarget: true,
  };
}
