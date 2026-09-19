/**
 * @file tests/unit/analyses/score.test.ts — score composite (Tâche 12, 2026-09-13)
 *
 * Les cinq premiers cas sont VERBATIM du plan
 * (`docs/superpowers/plans/2026-09-12-refonte-navigation-5-themes.md`, Tâche 12
 * étape 1). Les suivants couvrent ce que le plan ne spécifiait pas et que
 * l'usage réel impose : valeurs manquantes partielles, poids dont la somme
 * diffère de 1, série vide.
 */
import { describe, it, expect } from 'vitest';
import { normaliser, scoreComposite } from '@/lib/analyses/score';

describe('score composite', () => {
  it('normalise sur 0-100, min et max compris', () => {
    expect(normaliser([10, 20, 30], 'croissant')).toEqual([0, 50, 100]);
  });
  it('inverse le sens quand l indicateur est defavorable', () => {
    expect(normaliser([10, 20, 30], 'decroissant')).toEqual([100, 50, 0]);
  });
  it('rend 50 partout quand toutes les valeurs sont egales', () => {
    expect(normaliser([7, 7, 7], 'croissant')).toEqual([50, 50, 50]);
  });
  it('pondere et ramene a 100', () => {
    const lignes = [{ code: '13001', valeurs: [100, 0] }];
    expect(scoreComposite(lignes, [0.75, 0.25])[0].score).toBe(75);
  });
  it('ecarte une ligne dont toutes les valeurs manquent', () => {
    const lignes = [{ code: '13002', valeurs: [null, null] }];
    expect(scoreComposite(lignes, [0.5, 0.5])).toEqual([]);
  });

  // ── Au-delà du plan ────────────────────────────────────────────────────
  it('laisse les valeurs manquantes a null sans fausser les bornes', () => {
    expect(normaliser([10, null, 30], 'croissant')).toEqual([0, null, 100]);
  });
  it('rend une serie vide sur une entree vide', () => {
    expect(normaliser([], 'croissant')).toEqual([]);
  });
  it('renormalise des poids dont la somme differe de 1', () => {
    // 3 et 1 valent 0,75 et 0,25 une fois ramenés à 1 — même score qu'au cas du plan.
    const lignes = [{ code: '13001', valeurs: [100, 0] }];
    expect(scoreComposite(lignes, [3, 1])[0].score).toBe(75);
  });
  it('score sur les seuls indicateurs presents quand il en manque un', () => {
    // Seul le second indicateur est renseigné : son poids devient le seul poids.
    const lignes = [{ code: '13003', valeurs: [null, 40] }];
    expect(scoreComposite(lignes, [0.9, 0.1])[0].score).toBe(40);
  });
  it('arrondit au dixieme, comme la RPC', () => {
    const lignes = [{ code: '13004', valeurs: [100, 0, 0] }];
    expect(scoreComposite(lignes, [1, 1, 1])[0].score).toBe(33.3);
  });
  it('ecarte une ligne dont les indicateurs presents pesent zero', () => {
    // Sans poids, aucun score n'est calculable : la ligne sort, elle ne vaut pas 0.
    const lignes = [{ code: '13005', valeurs: [50, null] }];
    expect(scoreComposite(lignes, [0, 1])).toEqual([]);
  });
});
