/**
 * Zones cibles — nommage auto + métadonnées de définition.
 * La définition (indicateur + opérateur + seuil) reste attachée à la zone
 * (source_metadata) : c'est elle que l'agent IA relira en cours de vague (V2).
 */
export interface CibleIndicator {
  indicator_code: string;
  label: string;
  famille: 'audience' | 'comportement' | 'contexte';
  unit: string;
  slider_min: number;
  slider_max: number;
  slider_step: number;
  default_operator: '>=' | '<=';
  scale: 'iris' | 'cp';
  dynamic: boolean;
}

const OP_SYMBOL: Record<'>=' | '<=', string> = { '>=': '≥', '<=': '≤' };

export function buildCibleName(
  label: string, operator: '>=' | '<=', threshold: number, unit: string, now: Date,
): string {
  const month = now.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  return `${label} ${OP_SYMBOL[operator]} ${threshold} ${unit} — ${month}`;
}

export function buildCibleMetadata(
  ind: CibleIndicator, operator: '>=' | '<=', threshold: number, now: Date,
): Record<string, unknown> {
  return {
    kind: 'indicator_threshold',
    indicator: ind.indicator_code,
    operator,
    threshold,
    unit: ind.unit,
    scale: ind.scale,
    materialized_at: now.toISOString(),
  };
}
