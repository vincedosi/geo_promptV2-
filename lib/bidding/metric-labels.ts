/**
 * Libellé métier de la cible d'une stratégie d'enchères, lu par l'export
 * (`app/api/bidding/strategies/[id]/export/route.ts`).
 *
 * Déplacé de `lib/bidding-ml/` le 2026-10-12 (suppression de toute l'IA,
 * lot 3). Ce fichier portait aussi les libellés de la métrique principale
 * (`resolvePrimaryMetric`, `getMetricLabels`, `metricFields`) : leur seul
 * consommateur était le bilan exécutif Gemini, retiré le même jour.
 */

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
