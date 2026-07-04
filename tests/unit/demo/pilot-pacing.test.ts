import { describe, it, expect } from 'vitest';
import { toPilotPacing } from '@/lib/demo/pilot-types';
import type { PacingItem } from '@/lib/pacing/compute';

const item = (over: Partial<PacingItem>): PacingItem => ({
  zone_id: 'z', zone_name: 'z', item_id: 'z:a', item_name: 'A', item_weight: 25,
  expected_share: 0.25, actual_imp: 0, actual_spend: 0, cp_count: 2,
  actual_share: 0.25, delta_pts: 0, status: 'conforme', ...over,
});

describe('toPilotPacing', () => {
  it('calcule mean_delta et converged, projette les items', () => {
    const out = toPilotPacing(2, [
      item({ item_id: 'z:a', delta_pts: -12, status: 'sous_servi', actual_share: 0.13 }),
      item({ item_id: 'z:b', delta_pts: 8, status: 'sur_servi', actual_share: 0.33 }),
    ], 2);
    expect(out.version).toBe(2);
    expect(out.mean_delta).toBeCloseTo(10, 5);      // (12+8)/2
    expect(out.converged).toBe(false);              // 10 >= 2
    expect(out.items[0]).toMatchObject({ item_id: 'z:a', status: 'sous_servi', delta_pts: -12 });
    expect(out.items[0]).not.toHaveProperty('actual_imp'); // projeté, pas le PacingItem brut
  });

  it('converged=true quand mean_delta < seuil', () => {
    const out = toPilotPacing(3, [item({ delta_pts: 1.4 }), item({ item_id: 'z:b', delta_pts: -0.8 })], 2);
    expect(out.converged).toBe(true);
  });

  it('items vides → mean_delta 0, converged true', () => {
    expect(toPilotPacing(1, [], 2)).toMatchObject({ mean_delta: 0, converged: true, items: [] });
  });
});
