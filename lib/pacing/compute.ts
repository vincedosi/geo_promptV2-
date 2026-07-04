/**
 * Pacing plan-vs-réel — logique pure (zéro I/O, testable).
 * Compare la part planifiée (figée au push) à la part réelle délivrée, PAR ITEM,
 * normalisée INTRA-ZONE. delta_pts = (part réelle − part planifiée) × 100.
 */

export type PacingStatus = 'sur_servi' | 'conforme' | 'sous_servi' | 'en_attente';

/** Seuil (points) au-delà duquel un item est sur/sous-servi vs son plan. */
export const PACING_TOLERANCE_PTS = 5;

export interface PacingItemInput {
  zone_id: string;
  zone_name: string;
  item_id: string;
  item_name: string;
  item_weight: number;
  expected_share: number; // [0,1], intra-zone (figé)
  actual_imp: number;
  actual_spend: number;
  cp_count: number;
}

export interface PacingItem extends PacingItemInput {
  actual_share: number; // [0,1], intra-zone
  delta_pts: number;
  status: PacingStatus;
}

function classify(deltaPts: number, tol: number): PacingStatus {
  if (deltaPts > tol) return 'sur_servi';
  if (deltaPts < -tol) return 'sous_servi';
  return 'conforme';
}

export function computePacing(
  items: PacingItemInput[],
  tol: number = PACING_TOLERANCE_PTS,
): PacingItem[] {
  // Total réel par zone (dénominateur des parts intra-zone)
  const zoneTotal = new Map<string, number>();
  for (const it of items) {
    zoneTotal.set(it.zone_id, (zoneTotal.get(it.zone_id) ?? 0) + it.actual_imp);
  }
  return items.map((it) => {
    const total = zoneTotal.get(it.zone_id) ?? 0;
    if (total <= 0) {
      return { ...it, actual_share: 0, delta_pts: -it.expected_share * 100, status: 'en_attente' };
    }
    const actual_share = it.actual_imp / total;
    const delta_pts = (actual_share - it.expected_share) * 100;
    return { ...it, actual_share, delta_pts, status: classify(delta_pts, tol) };
  });
}

/** Libellé + couleur (token design system) par statut. */
export const PACING_STATUS_META: Record<PacingStatus, { label: string; colorVar: string }> = {
  sur_servi:  { label: 'Sur-servi',      colorVar: 'var(--warning)' },
  conforme:   { label: 'Conforme',       colorVar: 'var(--brand-teal)' },
  sous_servi: { label: 'Sous-servi',     colorVar: 'var(--danger)' },
  en_attente: { label: 'En attente',     colorVar: 'var(--text-tertiary)' },
};
