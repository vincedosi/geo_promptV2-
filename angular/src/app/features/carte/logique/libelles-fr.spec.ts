import { franciserLibelles, patchLabelFrValeur } from './libelles-fr';

describe('libellés du fond en français (useMapInit.ts:16-33)', () => {
  it("remplace `get name_en` / `get name:en` par coalesce(name:fr, name), à toute profondeur", () => {
    expect(patchLabelFrValeur(['get', 'name_en'])).toEqual(['coalesce', ['get', 'name:fr'], ['get', 'name']]);
    expect(patchLabelFrValeur(['case', ['has', 'x'], ['get', 'name:en'], ['get', 'ref']])).toEqual(
      ['case', ['has', 'x'], ['coalesce', ['get', 'name:fr'], ['get', 'name']], ['get', 'ref']],
    );
  });

  it('réécrit les jetons de chaîne {name_en} et {name:en} en {name}', () => {
    expect(patchLabelFrValeur('{name_en}\n{name:en}')).toBe('{name}\n{name}');
  });

  it("laisse intact ce qui ne nomme pas l'anglais, valeurs vides comprises", () => {
    expect(patchLabelFrValeur(['get', 'name'])).toEqual(['get', 'name']);
    expect(patchLabelFrValeur({ stops: [[1, '{name_en}']] })).toEqual({ stops: [[1, '{name}']] });
    expect(patchLabelFrValeur(null)).toBeNull();
    expect(patchLabelFrValeur(3)).toBe(3);
  });

  it("n'écrit que les couches SYMBOLE qui portent un text-field, et tolère une couche hors vue", () => {
    const ecritures: [string, unknown][] = [];
    franciserLibelles({
      getStyle: () => ({
        layers: [
          { id: 'eau', type: 'fill' },
          { id: 'ville', type: 'symbol', layout: { 'text-field': ['get', 'name_en'] } },
          { id: 'icone', type: 'symbol', layout: {} },
          { id: 'casse', type: 'symbol', layout: { 'text-field': '{name:en}' } },
        ],
      }),
      setLayoutProperty: (c, _p, v) => {
        if (c === 'casse') throw new Error('hors vue');
        ecritures.push([c, v]);
      },
    });
    expect(ecritures).toEqual([['ville', ['coalesce', ['get', 'name:fr'], ['get', 'name']]]]);
  });
});
