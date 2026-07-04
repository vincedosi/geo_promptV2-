/**
 * Rebid correctif — logique pure. À partir du diagnostic (part attendue vs réelle),
 * calcule des poids corrigés qui repoussent la répartition vers le plan :
 * facteur = clamp(expected/actual, 1−CAP, 1+CAP), plafonné pour ne pas sur-corriger,
 * puis renormalisé à 100 PAR ZONE (les scores DSP sont relatifs intra-zone).
 */

export const REBID_CAP = 0.5;
export const REBID_EPSILON = 0.001;

export interface RebidItemInput {
  zone_id: string;
  item_id: string;
  item_weight: number;
  expected_share: number;
  actual_share: number;
}

export interface RebidItem {
  zone_id: string;
  item_id: string;
  old_weight: number;
  new_weight: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function computeRebidWeights(items: RebidItemInput[]): RebidItem[] {
  // Poids bruts corrigés
  const raw = items.map((it) => {
    const factor = clamp(it.expected_share / Math.max(it.actual_share, REBID_EPSILON), 1 - REBID_CAP, 1 + REBID_CAP);
    return { it, rawWeight: it.item_weight * factor };
  });
  // Renormalisation à 100 par zone
  const zoneSum = new Map<string, number>();
  for (const r of raw) zoneSum.set(r.it.zone_id, (zoneSum.get(r.it.zone_id) ?? 0) + r.rawWeight);
  return raw.map((r) => {
    const sum = zoneSum.get(r.it.zone_id) ?? 0;
    const new_weight = sum > 0 ? (r.rawWeight / sum) * 100 : r.it.item_weight;
    return { zone_id: r.it.zone_id, item_id: r.it.item_id, old_weight: r.it.item_weight, new_weight };
  });
}
