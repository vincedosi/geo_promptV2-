import { describe, it, expect } from 'vitest';
import { computePacing, PACING_TOLERANCE_PTS, type PacingItemInput } from '@/lib/pacing/compute';

const base = (over: Partial<PacingItemInput>): PacingItemInput => ({
  zone_id: 'z1', zone_name: 'Zone 1', item_id: 'z1:a', item_name: 'A',
  item_weight: 50, expected_share: 0.5, actual_imp: 0, actual_spend: 0, cp_count: 3, ...over,
});

describe('computePacing', () => {
  it('calcule actual_share intra-zone et delta_pts', () => {
    const out = computePacing([
      base({ item_id: 'z1:a', expected_share: 0.5, actual_imp: 700 }),
      base({ item_id: 'z1:b', expected_share: 0.5, actual_imp: 300 }),
    ]);
    const a = out.find(i => i.item_id === 'z1:a')!;
    expect(a.actual_share).toBeCloseTo(0.7, 5);
    expect(a.delta_pts).toBeCloseTo(20, 5); // 70% - 50%
    expect(a.status).toBe('sur_servi');
    const b = out.find(i => i.item_id === 'z1:b')!;
    expect(b.status).toBe('sous_servi');
  });

  it('classe conforme dans la tolérance', () => {
    const out = computePacing([
      base({ item_id: 'z1:a', expected_share: 0.5, actual_imp: 520 }),
      base({ item_id: 'z1:b', expected_share: 0.5, actual_imp: 480 }),
    ]);
    expect(out.find(i => i.item_id === 'z1:a')!.status).toBe('conforme'); // +2 pts < 5
  });

  it('normalise par zone, pas globalement', () => {
    const out = computePacing([
      base({ zone_id: 'z1', item_id: 'z1:a', expected_share: 1, actual_imp: 100 }),
      base({ zone_id: 'z2', zone_name: 'Zone 2', item_id: 'z2:a', expected_share: 1, actual_imp: 900 }),
    ]);
    // chaque zone a un seul item → actual_share = 1 dans sa zone, delta 0
    expect(out.every(i => i.actual_share === 1 && i.delta_pts === 0 && i.status === 'conforme')).toBe(true);
  });

  it('zone sans délivrance → en_attente, pas sous_servi', () => {
    const out = computePacing([
      base({ item_id: 'z1:a', expected_share: 0.5, actual_imp: 0 }),
      base({ item_id: 'z1:b', expected_share: 0.5, actual_imp: 0 }),
    ]);
    expect(out.every(i => i.status === 'en_attente' && i.actual_share === 0)).toBe(true);
  });

  it('expose la tolérance = 5 pts', () => {
    expect(PACING_TOLERANCE_PTS).toBe(5);
  });
});
