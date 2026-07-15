import { describe, it, expect } from 'vitest';
import {
  binScoresIntoTiers, buildPressureBiddingScript, buildPressureCsv, buildTiktokPressureSheet,
} from '@/lib/digital/bidding-export';

describe('binScoresIntoTiers', () => {
  it('vide → aucun palier', () => {
    expect(binScoresIntoTiers({})).toEqual([]);
  });

  it('≤ 5 scores distincts → un palier par score, trié décroissant', () => {
    const tiers = binScoresIntoTiers({ '59000': 2.2, '59100': 2.2, '75001': 1.0, '13001': 0.45 });
    expect(tiers.map((t) => t.score)).toEqual([2.2, 1.0, 0.45]);
    expect(tiers[0].cps).toEqual(['59000', '59100']);
    expect(tiers.map((t) => t.label)).toEqual(['Palier 1', 'Palier 2', 'Palier 3']);
  });

  it('> 5 scores distincts → au plus 5 paliers, tous les CP conservés', () => {
    const scores: Record<string, number> = {};
    for (let i = 0; i < 40; i++) scores[String(10000 + i)] = 1 + i * 0.05;
    const tiers = binScoresIntoTiers(scores);
    expect(tiers.length).toBeLessThanOrEqual(5);
    expect(tiers.flatMap((t) => t.cps)).toHaveLength(40);
  });

  it('un même score n’est jamais coupé entre deux paliers', () => {
    const scores: Record<string, number> = {};
    for (let i = 0; i < 20; i++) scores[String(20000 + i)] = 2.0; // bloc massif identique
    for (let i = 0; i < 10; i++) scores[String(30000 + i)] = 1 + i * 0.01;
    const tiers = binScoresIntoTiers(scores);
    const tierOf = new Map<number, Set<string>>();
    for (const t of tiers) {
      for (const cp of t.cps) {
        if (Number(cp) < 30000) tierOf.set(1, (tierOf.get(1) ?? new Set()).add(t.label));
      }
    }
    expect(tierOf.get(1)?.size).toBe(1);
  });
});

describe('buildPressureBiddingScript', () => {
  const tiers = [
    { label: 'Palier 1', score: 2.2, cps: ['59000', '59100'] },
    { label: 'Palier 2', score: 1, cps: ['75001'] },
  ];

  it('zones strictes : palier final à 0.0', () => {
    const s = buildPressureBiddingScript('Ma campagne', tiers, 0);
    expect(s).toContain('([country_code == "FR", zip_postal_code in ["59000", "59100"]], 2.2),');
    expect(s).toContain('([country_code == "FR", zip_postal_code in ["75001"]], 1.0),');
    expect(s).toContain('([], 0.0)');
    expect(s).toContain('return max_aggregate([');
  });

  it('national avec surpression : palier final à 1.0 + méta pression', () => {
    const s = buildPressureBiddingScript('Ma campagne', tiers, 1, { pressure: '×2,2' });
    expect(s).toContain('([], 1.0)');
    expect(s).toContain('pression ×2,2');
  });
});

describe('buildPressureCsv', () => {
  it('en-tête + lignes triées score décroissant, décimale point', () => {
    const csv = buildPressureCsv({ '75001': 1, '59000': 2.2, '13001': 0.45 });
    expect(csv.split('\n')).toEqual(['postal_code;score', '59000;2.2', '75001;1', '13001;0.45', '']);
  });
});

describe('buildTiktokPressureSheet', () => {
  it('un bloc par palier avec part de budget ∝ score × nb CP', () => {
    const sheet = buildTiktokPressureSheet('Ma campagne', [
      { label: 'Palier 1', score: 2, cps: ['59000'] },
      { label: 'Palier 2', score: 1, cps: ['75001', '75002'] },
    ], 0);
    expect(sheet).toContain('Palier 1 — score 2 · 50 % du budget');
    expect(sheet).toContain('Palier 2 — score 1 · 50 % du budget');
    expect(sheet).toContain('Zones strictes');
  });

  it('mention diffusion nationale quand le hors-zone est > 0', () => {
    const sheet = buildTiktokPressureSheet('X', [{ label: 'Palier 1', score: 2, cps: ['59000'] }], 1);
    expect(sheet).toContain('Diffusion nationale');
  });
});
