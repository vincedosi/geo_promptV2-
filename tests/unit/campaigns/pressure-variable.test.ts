import { describe, it, expect } from 'vitest';
import { pressureCurve, resolvePressureIndicators } from '@/components/campaign/wizard/steps/types';
import type { CibleZoneRef } from '@/lib/cibles/draft';

const IND = { code: 'rev_median', label: 'Revenu médian', min: 10000, max: 45000 };
const cible = (over: Partial<CibleZoneRef>): CibleZoneRef =>
  ({ id: 'z1', name: 'Z', sourceType: 'indicator_threshold', ...over });

describe('pressureCurve (domaine paramétré)', () => {
  it('sans domaine : rétro-compatible abstention (x = 20/30/45)', () => {
    expect(pressureCurve(2).map((p) => p.x)).toEqual([20, 30, 45]);
  });
  it('avec domaine : x = min+20%, min+40%, min+70% de la plage', () => {
    const xs = pressureCurve(2, undefined, { min: 10000, max: 45000 }).map((p) => p.x);
    expect(xs).toEqual([17000, 24000, 34500]);
  });
  it('y inchangés : 1/M, 1, M — et floor respecté', () => {
    expect(pressureCurve(2, undefined, { min: 0, max: 100 }).map((p) => p.y)).toEqual([0.5, 1, 2]);
    expect(pressureCurve(2, 1, { min: 0, max: 100 }).map((p) => p.y)).toEqual([1, 1, 2]);
  });
});

describe('resolvePressureIndicators', () => {
  it('extrait les indicateurs du panier, dédupliqués, ordre conservé', () => {
    const out = resolvePressureIndicators([
      cible({ id: 'a', indicator: IND }),
      cible({ id: 'b' }), // zone galerie sans indicateur
      cible({ id: 'c', indicator: IND }), // doublon
      cible({ id: 'd', indicator: { code: 'taux_chomage', label: 'Taux de chômage', min: 0, max: 40 } }),
    ]);
    expect(out.map((i) => i.code)).toEqual(['rev_median', 'taux_chomage']);
  });
  it('panier vide ou sans indicateur → []', () => {
    expect(resolvePressureIndicators([])).toEqual([]);
    expect(resolvePressureIndicators([cible({})])).toEqual([]);
  });
});
