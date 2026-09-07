/**
 * Contrat de l'expression `circle-radius` des bulles de la carte de pilotage
 * (`app/custom-bidding/[strategyId]/_lib/circle-radius.ts`).
 *
 * MapLibre exige des entrees strictement croissantes dans un `interpolate`.
 * Si une seule borne repete la precedente, la bibliotheque rejette
 * l'expression ENTIERE sans lever d'erreur JS : le rayon reste a sa valeur
 * initiale et les bulles deviennent invisibles. Le symptome (carte vide) ne
 * ressemble pas a sa cause, d'ou ces tests qui fixent la propriete elle-meme
 * plutot que des valeurs particulieres.
 */
import { describe, expect, it } from 'vitest';
import { buildCircleRadiusExpression } from '@/app/custom-bidding/[strategyId]/_lib/circle-radius';

/** Extrait les couples [entree, sortie] d'une expression `interpolate`. */
function stopsOf(expr: unknown[]): Array<[number, number]> {
  const tail = expr.slice(3) as number[];
  const stops: Array<[number, number]> = [];
  for (let i = 0; i < tail.length; i += 2) stops.push([tail[i], tail[i + 1]]);
  return stops;
}

describe('buildCircleRadiusExpression', () => {
  it('produit une expression interpolate lineaire sur impressions', () => {
    const expr = buildCircleRadiusExpression(1000, 32);
    expect(expr[0]).toBe('interpolate');
    expect(expr[1]).toEqual(['linear']);
    expect(expr[2]).toEqual(['get', 'impressions']);
  });

  it('part de zero impression avec un rayon nul', () => {
    expect(stopsOf(buildCircleRadiusExpression(1000, 32))[0]).toEqual([0, 0]);
  });

  it('atteint exactement maxRadius au volume maximal', () => {
    const stops = stopsOf(buildCircleRadiusExpression(4200, 42));
    expect(stops[stops.length - 1]).toEqual([4200, 42]);
  });

  // Le coeur du bug : a faible volume, les anciennes bornes Math.max(1, m * k)
  // retombaient toutes sur 1.
  it.each([1, 2, 3, 3.33, 4, 10, 1_000, 12_345_678])(
    'garde des bornes strictement croissantes a maxImpressions = %s',
    (maxImpressions) => {
      const stops = stopsOf(buildCircleRadiusExpression(maxImpressions, 18));
      for (let i = 1; i < stops.length; i++) {
        expect(stops[i][0]).toBeGreaterThan(stops[i - 1][0]);
      }
    },
  );

  it('garde des bornes strictement croissantes meme sans donnees (0)', () => {
    const stops = stopsOf(buildCircleRadiusExpression(0, 18));
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i][0]).toBeGreaterThan(stops[i - 1][0]);
    }
  });

  it('garde des rayons croissants, entiers et bornes par maxRadius', () => {
    const stops = stopsOf(buildCircleRadiusExpression(1, 18));
    for (const [, radius] of stops) {
      expect(Number.isInteger(radius)).toBe(true);
      expect(radius).toBeLessThanOrEqual(18);
    }
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i][1]).toBeGreaterThan(stops[i - 1][1]);
    }
  });
});
