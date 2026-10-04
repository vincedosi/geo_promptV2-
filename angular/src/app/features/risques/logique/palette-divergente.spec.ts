import { trancheDivergente, trancheIndice } from './palette-divergente';

describe('trancheIndice', () => {
  it('sans indice : -1, jamais la tranche 3 « conforme » où tomberait `trancheDivergente(null)`', () => {
    expect(trancheIndice(null)).toBe(-1);
    expect(trancheIndice(undefined)).toBe(-1);
    expect(trancheDivergente(null as unknown as number)).toBe(3);
  });

  it('un indice est un écart au plan décalé de 100 : mêmes bornes que `trancheDivergente`', () => {
    const cas: [number, number][] = [[0, 0], [49.9, 0], [50, 1], [89, 2], [90, 3], [100, 3], [110, 4], [125, 5], [150, 6], [300, 6]];
    for (const [indice, tranche] of cas) {
      expect(trancheIndice(indice)).toBe(tranche);
      expect(trancheIndice(indice)).toBe(trancheDivergente(indice - 100));
    }
  });
});
