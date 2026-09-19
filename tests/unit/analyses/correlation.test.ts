/**
 * @file tests/unit/analyses/correlation.test.ts — corrélation impressions ×
 * indicateur (Tâche 13, 2026-09-13).
 *
 * Les trois premiers cas sont VERBATIM du plan
 * (`docs/superpowers/plans/2026-09-12-refonte-navigation-5-themes.md`,
 * Tâche 13 étape 1). Les suivants couvrent ce que le plan ne spécifiait pas :
 * séries trop courtes, longueurs inégales, valeurs non finies.
 *
 * Le quatrième cas du plan (`apparier`) n'a pas de test ici parce que la
 * fonction n'existe pas : l'appariement se fait en SQL — voir l'en-tête de
 * `lib/analyses/correlation.ts` pour la mesure qui a imposé ce choix.
 */
import { describe, it, expect } from 'vitest';
import { pearson } from '@/lib/analyses/correlation';

describe('correlation', () => {
  it('rend 1 sur une relation croissante parfaite', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
  });
  it('rend -1 sur une relation decroissante parfaite', () => {
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 6);
  });
  it('rend 0 quand une serie est constante, jamais NaN', () => {
    expect(pearson([1, 2, 3], [5, 5, 5])).toBe(0);
  });
  // ── Au-delà du plan ────────────────────────────────────────────────────
  it('rend 0 sur une serie de moins de deux points, jamais NaN', () => {
    // Un seul point : l'écart-type vaut 0, la formule diviserait par zéro.
    expect(pearson([1], [2])).toBe(0);
    expect(pearson([], [])).toBe(0);
  });
  it('rend 0 si les deux series n ont pas la meme longueur', () => {
    // Ne jamais corréler sur une troncature silencieuse : mieux vaut 0 explicite.
    expect(pearson([1, 2, 3], [1, 2])).toBe(0);
  });
  it('ignore les paires dont une valeur n est pas finie', () => {
    // Un NaN remonterait jusqu'au graphe et casserait l'axe (raison d'être du plan).
    expect(pearson([1, 2, 3, NaN], [2, 4, 6, 8])).toBeCloseTo(1, 6);
  });
  it('rend un coefficient borne a [-1, 1] sur des donnees reelles', () => {
    const r = pearson([12, 45, 7, 89, 33], [3, 9, 2, 15, 6]);
    expect(r).toBeGreaterThanOrEqual(-1);
    expect(r).toBeLessThanOrEqual(1);
    expect(Number.isNaN(r)).toBe(false);
  });
});

/**
 * Ajoutés après relecture (2026-09-13) : la garantie « jamais NaN », écrite
 * trois fois dans le code et invoquée par la route, était FAUSSE au-delà
 * d'environ 1e154. Inatteignable avec les données du domaine, mais une
 * garantie écrite doit tenir.
 */
describe('pearson — debordement', () => {
  it('ne rend pas NaN quand les deux variances debordent', () => {
    expect(pearson([1e200, 2e200, 3e200], [2e200, 4e200, 6e200])).toBe(0);
  });
  it('ne rend pas NaN quand une seule variance deborde', () => {
    expect(pearson([1e160, 2e160, 3e160], [1, 2, 3.5])).toBe(0);
  });
  it('reste borne sur des valeurs grandes mais finies', () => {
    const r = pearson([1e6, 2e6, 3e6], [2e6, 4e6, 6e6]);
    expect(Number.isNaN(r)).toBe(false);
    expect(r).toBeCloseTo(1, 6);
  });
});
