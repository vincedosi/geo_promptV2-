import { describe, it, expect } from 'vitest';
import { buildZoneSnapshotItems, type PlanItemInput } from '@/lib/pacing/snapshot';

const ZONE = 'z1';

describe('buildZoneSnapshotItems', () => {
  it('cas nominal : 2 items expansables 60/40 → expected_share 0.6 / 0.4, somme = 1', () => {
    const planItems: PlanItemInput[] = [
      { item_id: 'z1:a', item_name: 'A', weight: 60 },
      { item_id: 'z1:b', item_name: 'B', weight: 40 },
    ];
    const cpsByPoi = new Map([
      ['a', ['75001', '75002']],
      ['b', ['75003']],
    ]);
    const out = buildZoneSnapshotItems(ZONE, planItems, cpsByPoi);
    const a = out.find(i => i.item_id === 'z1:a')!;
    const b = out.find(i => i.item_id === 'z1:b')!;
    expect(a.expected_share).toBeCloseTo(0.6, 10);
    expect(b.expected_share).toBeCloseTo(0.4, 10);
    expect(a.expected_share + b.expected_share).toBeCloseTo(1, 10);
  });

  it('cas du bug : 3 items à poids égal, un non-expansable (cps: []) → absent du résultat, somme des 2 restants = 1', () => {
    const planItems: PlanItemInput[] = [
      { item_id: 'z1:a', item_name: 'A', weight: 33.33 },
      { item_id: 'z1:b', item_name: 'B', weight: 33.33 },
      { item_id: 'z1:c', item_name: 'C', weight: 33.34 },
    ];
    const cpsByPoi = new Map([
      ['a', ['75001']],
      ['b', ['75002']],
      ['c', []], // non expansable
    ]);
    const out = buildZoneSnapshotItems(ZONE, planItems, cpsByPoi);
    expect(out.map(i => i.item_id).sort()).toEqual(['z1:a', 'z1:b']);
    const sum = out.reduce((s, i) => s + i.expected_share, 0);
    expect(sum).toBeCloseTo(1, 10);
    // pas 0.66 : chaque item retenu doit être renormalisé sur le total des SEULS items retenus
    expect(out.find(i => i.item_id === 'z1:a')!.expected_share).toBeCloseTo(0.5, 10);
    expect(out.find(i => i.item_id === 'z1:b')!.expected_share).toBeCloseTo(0.5, 10);
  });

  it('aucun item expansable → tableau vide', () => {
    const planItems: PlanItemInput[] = [
      { item_id: 'z1:a', item_name: 'A', weight: 50 },
      { item_id: 'z1:b', item_name: 'B', weight: 50 },
    ];
    const cpsByPoi = new Map<string, string[]>([
      ['a', []],
      ['b', []],
    ]);
    const out = buildZoneSnapshotItems(ZONE, planItems, cpsByPoi);
    expect(out).toEqual([]);
  });

  it('poi_id manquant dans cpsByPoi → traité comme non-expansable', () => {
    const planItems: PlanItemInput[] = [
      { item_id: 'z1:a', item_name: 'A', weight: 100 },
    ];
    const out = buildZoneSnapshotItems(ZONE, planItems, new Map());
    expect(out).toEqual([]);
  });

  it('cps est bien reporté sur la ligne de sortie', () => {
    const planItems: PlanItemInput[] = [
      { item_id: 'z1:a', item_name: 'A', weight: 100 },
    ];
    const cpsByPoi = new Map([['a', ['75001', '75002']]]);
    const out = buildZoneSnapshotItems(ZONE, planItems, cpsByPoi);
    expect(out).toEqual([
      { item_id: 'z1:a', item_name: 'A', item_weight: 100, expected_share: 1, cps: ['75001', '75002'] },
    ]);
  });
});
