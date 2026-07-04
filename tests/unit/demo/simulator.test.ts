import { describe, it, expect } from 'vitest';
import { simulateDelivery, type SimItem } from '@/lib/demo/simulator';

const cps = ['10', '20', '30', '40'];
const audience = { '10': 1000, '20': 1000, '30': 1000, '40': 1000 };
const twoItems = (wA: number, wB: number): SimItem[] => [
  { zone_id: 'z', item_id: 'z:a', expected_share: wA, cps: ['10', '20'] },
  { zone_id: 'z', item_id: 'z:b', expected_share: wB, cps: ['30', '40'] },
];

function shareOf(rows: { postal_code: string; impressions: number }[], itemCps: string[]): number {
  const total = rows.reduce((s, r) => s + r.impressions, 0) || 1;
  const inItem = rows.filter(r => itemCps.includes(r.postal_code)).reduce((s, r) => s + r.impressions, 0);
  return inItem / total;
}

describe('simulateDelivery', () => {
  it('est deterministe pour un meme seed/periode', () => {
    const a = simulateDelivery({ items: twoItems(0.5, 0.5), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    const b = simulateDelivery({ items: twoItems(0.5, 0.5), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    expect(a).toEqual(b);
  });

  it('normalise au volume total (a l\'arrondi pres)', () => {
    const rows = simulateDelivery({ items: twoItems(0.5, 0.5), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    const sum = rows.reduce((s, r) => s + r.impressions, 0);
    expect(Math.abs(sum - 10000)).toBeLessThanOrEqual(rows.length); // arrondis
  });

  it('monotonie : relever le poids d\'un item augmente sa part delivree', () => {
    const base = simulateDelivery({ items: twoItems(0.5, 0.5), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    const boosted = simulateDelivery({ items: twoItems(0.8, 0.2), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    expect(shareOf(boosted, ['10', '20'])).toBeGreaterThan(shareOf(base, ['10', '20']));
  });

  it('la resistance seedee cree un ecart initial non trivial a poids egaux', () => {
    const rows = simulateDelivery({ items: twoItems(0.5, 0.5), audienceByCp: audience, seed: 42, period: 1, totalVolume: 10000 });
    const sA = shareOf(rows, ['10', '20']);
    expect(Math.abs(sA - 0.5)).toBeGreaterThan(0.02); // pas parfaitement conforme au tour 1
  });
});
