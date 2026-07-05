import { describe, it, expect } from 'vitest';
import { assembleReport } from '@/lib/report/aggregate';
import type { SnapshotMeta, RawVersionPacing } from '@/lib/report/types';
import type { PacingItemInput } from '@/lib/pacing/compute';

// Deux items A/B, cible 50/50. v1 déséquilibrée (80/20), v2 (60/40), v3 convergée (51/49).
const item = (id: string, imp: number, spend: number): PacingItemInput => ({
  zone_id: 'z1', zone_name: 'Z', item_id: id, item_name: id.toUpperCase(),
  item_weight: 50, expected_share: 0.5, actual_imp: imp, actual_spend: spend, cp_count: 1,
});

const META: SnapshotMeta[] = [
  { version: 1, budget: 100000, cpm: 5, cible: 'total', dsp: 'dv360', zone_name: 'Z', period_start: '2026-01-01', period_end: '2026-01-31' },
  { version: 2, budget: 100000, cpm: 5, cible: 'total', dsp: 'dv360', zone_name: 'Z', period_start: '2026-01-31', period_end: '2026-03-02' },
  { version: 3, budget: 100000, cpm: 5, cible: 'total', dsp: 'dv360', zone_name: 'Z', period_start: '2026-03-02', period_end: '2026-04-01' },
];
const PACINGS: RawVersionPacing[] = [
  { version: 1, items: [item('a', 800, 0), item('b', 200, 0)], in_plan_imp: 1000, total_imp: 1000, spillover_imp: 0 },
  { version: 2, items: [item('a', 600, 0), item('b', 400, 0)], in_plan_imp: 1000, total_imp: 1000, spillover_imp: 0 },
  { version: 3, items: [item('a', 510, 300), item('b', 490, 290)], in_plan_imp: 1000, total_imp: 1000, spillover_imp: 0 },
];

describe('assembleReport', () => {
  it('assemble un report convergent depuis 3 versions', () => {
    const r = assembleReport('Démo', META, PACINGS)!;
    expect(r).not.toBeNull();

    // convergence : mean_delta décroissant, dernier converged
    expect(r.convergence.map((c) => c.version)).toEqual([1, 2, 3]);
    expect(r.convergence[0].mean_delta).toBe(30);
    expect(r.convergence[2].mean_delta).toBe(1);
    expect(r.convergence[2].converged).toBe(true);
    expect(r.convergence[0].converged).toBe(false);

    // zones : cible fixe, avant/après par item
    const a = r.zones.find((z) => z.item_id === 'a')!;
    expect(a.expected_share).toBe(0.5);
    expect(a.delta_first).toBe(30);
    expect(a.delta_last).toBe(1);
    expect(a.status_first).toBe('sur_servi');
    expect(a.status_last).toBe('conforme');

    // budget : planned = 3×100000 ; spent = fallback(v1,v2) + direct(v3)
    // v1 fallback = 1000×5/1000 = 5 ; v2 = 5 ; v3 direct = 300+290 = 590 → total 600
    expect(r.budget.planned_total).toBe(300000);
    expect(r.budget.spent_total).toBe(600);
    expect(r.budget.spent_last).toBe(590);
    expect(r.budget.planned_last).toBe(100000);
    expect(r.budget.spillover_pct).toBe(0);

    // kpis
    expect(r.kpis.corrections).toBe(2);
    expect(r.kpis.improvement_pts).toBe(29);
    expect(r.kpis.converged).toBe(true);
    expect(r.kpis.conforming_items_last).toBe(2);
    expect(r.kpis.total_items).toBe(2);

    // header
    expect(r.header.period_start).toBe('2026-01-01');
    expect(r.header.period_end).toBe('2026-04-01');
    expect(r.header.version_count).toBe(3);
    expect(r.header.zone_name).toBe('Z');
  });

  it('retourne null sans snapshot', () => {
    expect(assembleReport('Démo', [], [])).toBeNull();
  });
});
