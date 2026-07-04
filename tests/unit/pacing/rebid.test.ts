import { describe, it, expect } from 'vitest';
import { computeRebidWeights, REBID_CAP, type RebidItemInput } from '@/lib/pacing/rebid';

const it_ = (over: Partial<RebidItemInput>): RebidItemInput => ({
  zone_id: 'z1', item_id: 'z1:a', item_weight: 50, expected_share: 0.5, actual_share: 0.5, ...over,
});

describe('computeRebidWeights', () => {
  it('renforce le sous-servi, réduit le sur-servi, renormalise à 100 par zone', () => {
    const out = computeRebidWeights([
      it_({ item_id: 'z1:a', item_weight: 50, expected_share: 0.5, actual_share: 0.7 }), // sur-servi
      it_({ item_id: 'z1:b', item_weight: 50, expected_share: 0.5, actual_share: 0.3 }), // sous-servi
    ]);
    const a = out.find(i => i.item_id === 'z1:a')!;
    const b = out.find(i => i.item_id === 'z1:b')!;
    expect(b.new_weight).toBeGreaterThan(a.new_weight);
    expect(a.new_weight + b.new_weight).toBeCloseTo(100, 3);
  });

  it('plafonne la correction à REBID_CAP', () => {
    const [only] = computeRebidWeights([
      it_({ item_id: 'z1:a', item_weight: 100, expected_share: 0.5, actual_share: 0.001 }),
    ]);
    // un seul item → renormalisé à 100 quoi qu'il arrive
    expect(only.new_weight).toBeCloseTo(100, 3);
    expect(REBID_CAP).toBe(0.5);
  });

  it('plan déjà conforme → poids ~inchangés', () => {
    const out = computeRebidWeights([
      it_({ item_id: 'z1:a', item_weight: 60, expected_share: 0.6, actual_share: 0.6 }),
      it_({ item_id: 'z1:b', item_weight: 40, expected_share: 0.4, actual_share: 0.4 }),
    ]);
    expect(out.find(i => i.item_id === 'z1:a')!.new_weight).toBeCloseTo(60, 1);
    expect(out.find(i => i.item_id === 'z1:b')!.new_weight).toBeCloseTo(40, 1);
  });

  it('item sans délivrance (actual_share 0) → poussé au max plafonné', () => {
    const out = computeRebidWeights([
      it_({ item_id: 'z1:a', item_weight: 50, expected_share: 0.5, actual_share: 0 }),
      it_({ item_id: 'z1:b', item_weight: 50, expected_share: 0.5, actual_share: 1 }),
    ]);
    expect(out.find(i => i.item_id === 'z1:a')!.new_weight).toBeGreaterThan(50);
  });
});
