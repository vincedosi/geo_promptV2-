import { badgeType, fmtK } from './constantes';

/** Recopie verbatim de l'expression React (`app/admin/sources/page.tsx:319`), pour la comparaison. */
const fmtKReact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n);

describe('Sources — constantes copiées de React (lot 6, T18)', () => {
  it('fmtK : mêmes sorties que React, paliers compris', () => {
    for (const n of [0, 7, 999, 1000, 1253, 1499, 1500, 49_448, 105_014, 286_115, 999_499, 999_999, 1_000_000, 2_324_604, 2_766_434]) {
      expect(fmtK(n), String(n)).toBe(fmtKReact(n));
    }
    expect(fmtK(2_766_434)).toBe('2.8M');
    expect(fmtK(1253)).toBe('1k');
  });

  it('badge : POI — catégorie, OOH — régie, sinon « Carreaux INSEE » ; famille de teinte', () => {
    expect(badgeType('poi', 'cirfa')).toEqual({ libelle: 'POI — cirfa', famille: 'poi' });
    expect(badgeType('poi')).toEqual({ libelle: 'POI', famille: 'poi' });
    expect(badgeType('panneaux', 'ooh', 'STRIDE')).toEqual({ libelle: 'OOH — STRIDE', famille: 'panneaux' });
    expect(badgeType('panneaux', null, null)).toEqual({ libelle: 'OOH', famille: 'panneaux' });
    expect(badgeType('carreaux', 'carreaux')).toEqual({ libelle: 'Carreaux INSEE', famille: 'carreaux' });
    expect(badgeType('autre')).toEqual({ libelle: 'Carreaux INSEE', famille: 'autre' });
  });
});
