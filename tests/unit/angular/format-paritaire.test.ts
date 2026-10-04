/**
 * Les formateurs de nombres du projet Angular (`angular/src/app/core/format/nombre.ts`) sont ceux de
 * `lib/format/nombre.ts`, à la sortie près. Rien dans `angular/` n'importe hors d'`angular/`, d'où une
 * copie : ce test est ce qui l'empêche de dériver (même patron que `jetons-paritaires.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import * as react from '@/lib/format/nombre';
import * as angular from '../../../angular/src/app/core/format/nombre';

const VALEURS: unknown[] = [
  null, undefined, NaN, Infinity, -Infinity, 0, -0, 1, 950, 999, 1000, 12300, 12345.678, 999999, 1e6,
  13841288, 1.2e9, -5, -1234.5, 0.5, 0.05, 1234.56, 9999.6, 10000, -25000, 83977, 2.5e5, '12',
];

describe('formateurs de nombres : Angular = React', () => {
  const communs = Object.keys(angular).filter((k) => typeof (angular as Record<string, unknown>)[k] === 'function');

  it('chaque fonction exportée côté Angular existe côté React', () => {
    expect(communs.length).toBeGreaterThan(0);
    for (const nom of communs) expect(typeof (react as Record<string, unknown>)[nom], nom).toBe('function');
  });

  for (const nom of ['formaterNombre', 'formaterNombreAbrege', 'formaterDecimal', 'formaterNombreCourt']) {
    it(`${nom} rend la même chose sur la table de valeurs`, () => {
      const r = (react as Record<string, (...a: unknown[]) => unknown>)[nom];
      const a = (angular as Record<string, (...a: unknown[]) => unknown>)[nom];
      for (const v of VALEURS) expect(a(v), `${nom}(${String(v)})`).toBe(r(v));
    });
  }

  it('formaterDecimal : mêmes sorties pour 0, 1, 2 et 3 décimales', () => {
    for (const d of [0, 1, 2, 3]) {
      for (const v of VALEURS) expect(angular.formaterDecimal(v as number, d), `${String(v)} / ${d}`).toBe(react.formaterDecimal(v as number, d));
    }
  });
});
