import { describe, it, expect } from 'vitest';
import { simulateDelivery, type SimItem } from '@/lib/demo/simulator';
import { computeRebidWeights } from '@/lib/pacing/rebid';

// 4 items d'une zone, 2 CP par item. CIBLE fixe / ENCHÈRE ajustée par le rebid.
const ITEMS = [
  { item_id: 'z:a', cps: ['1', '2'] },
  { item_id: 'z:b', cps: ['3', '4'] },
  { item_id: 'z:c', cps: ['5', '6'] },
  { item_id: 'z:d', cps: ['7', '8'] },
];
const audienceByCp: Record<string, number> = Object.fromEntries(
  ['1','2','3','4','5','6','7','8'].map((cp, i) => [cp, 800 + i * 120]),
);

// CIBLE FIXE (l'intention) — ne bouge JAMAIS. Parts normalisées intra-zone.
const TARGET: Record<string, number> = { 'z:a': 0.25, 'z:b': 0.25, 'z:c': 0.25, 'z:d': 0.25 };

/** SimItem pilotés par l'ENCHÈRE (bid) normalisée — c'est l'enchère qui pilote la délivrance. */
function bidItems(bids: Record<string, number>): SimItem[] {
  const total = Object.values(bids).reduce((s, w) => s + w, 0) || 1;
  return ITEMS.map(it => ({ zone_id: 'z', item_id: it.item_id, bid_share: bids[it.item_id] / total, cps: it.cps }));
}

/** Part réelle délivrée par item, pour une enchère + une période données. */
function actualShares(bids: Record<string, number>, period: number): Record<string, number> {
  const rows = simulateDelivery({ items: bidItems(bids), audienceByCp, seed: 42, period, totalVolume: 1_000_000 });
  const impByCp = new Map(rows.map(r => [r.postal_code, r.impressions]));
  const total = rows.reduce((s, r) => s + r.impressions, 0) || 1;
  return Object.fromEntries(ITEMS.map(it => [
    it.item_id, it.cps.reduce((s, cp) => s + (impByCp.get(cp) ?? 0), 0) / total,
  ]));
}

/** Écart absolu moyen (points) entre la part réelle et la CIBLE FIXE. */
function meanAbsDeltaVsTarget(bids: Record<string, number>, period: number): number {
  const actual = actualShares(bids, period);
  return ITEMS.reduce((s, it) => s + Math.abs((actual[it.item_id] - TARGET[it.item_id]) * 100), 0) / ITEMS.length;
}

describe('convergence de la boucle (enchère → cible fixe)', () => {
  it('l’écart absolu moyen vs la cible fixe décroît en itérant le rebid', () => {
    let bids: Record<string, number> = { 'z:a': 25, 'z:b': 25, 'z:c': 25, 'z:d': 25 }; // enchère = cible au départ
    const errs: number[] = [];
    for (let period = 1; period <= 3; period++) {
      errs.push(meanAbsDeltaVsTarget(bids, period));
      const actual = actualShares(bids, period);
      // rebid : CIBLE FIXE en expected_share, ENCHÈRE courante en item_weight → nouvelle enchère
      const rebid = computeRebidWeights(ITEMS.map(it => ({
        zone_id: 'z', item_id: it.item_id,
        item_weight: bids[it.item_id],        // enchère courante
        expected_share: TARGET[it.item_id],   // CIBLE FIXE (jamais l'enchère !)
        actual_share: actual[it.item_id],
      })));
      bids = Object.fromEntries(rebid.map(r => [r.item_id, r.new_weight]));
    }
    // Déterministe (seed 42). Écart initial réel, puis convergence nette vers la cible fixe.
    expect(errs[0]).toBeGreaterThan(2);          // écart sous/sur-servi réel au tour 1
    expect(errs[2]).toBeLessThan(errs[0] * 0.8); // a convergé d'au moins 20 %
    expect(errs[1]).toBeLessThan(errs[0]);       // v2 strictement mieux que v1
    expect(errs[2]).toBeLessThan(errs[1]);       // v3 strictement mieux que v2 (pas d'oscillation)
    expect(errs[2]).toBeLessThan(errs[0]);       // strictement mieux qu'au départ
  });
});
