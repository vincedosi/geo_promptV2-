import {
  apercuCodesPostaux, messageErreurSource, messageZoneCodesPostaux, messageZoneDessin, messageZoneRayon, nomCodesPostauxFichier,
} from './creation-zone';

const n = (v: number) => v.toLocaleString('fr-FR');

describe('creation-zone — les textes de création de React (CreerZone*.tsx)', () => {
  it('codes postaux : retenus, inconnus du référentiel et rejetés dits SÉPARÉMENT', () => {
    expect(messageZoneCodesPostaux({ n_codes: 2, n_inconnus: 1, n_rejetes: 1 }, 2))
      .toBe('Zone créée : 2 codes postaux · 1 inconnu du référentiel, 1 rejeté');
    expect(messageZoneCodesPostaux({ n_codes: 1500, n_inconnus: 3, n_rejetes: 0 }, undefined))
      .toBe(`Zone créée : ${n(1500)} codes postaux · 3 inconnus du référentiel`);
    expect(messageZoneCodesPostaux({ n_codes: 4, n_inconnus: 0, n_rejetes: 0 }, 4)).toBe('Zone créée : 4 codes postaux');
  });

  it('aperçu local de la saisie : codes reconnus, rejetés (8 premiers), plafond 2 000', () => {
    const a = apercuCodesPostaux('13001, 13002, 99999, abc');
    expect(a).toMatchObject({ reconnus: '3 codes reconnus', rejetes: '1 rejeté', listeRejetes: 'abc', trop: false, nCodes: 3 });
    expect(apercuCodesPostaux('')).toBeNull();
    const beaucoup = Array.from({ length: 2001 }, (_, i) => String(10000 + i)).join(' ');
    expect(apercuCodesPostaux(beaucoup)!.trop).toBe(true);
    const neufRejets = 'a b c d e f g h i';
    expect(apercuCodesPostaux(neufRejets)!.listeRejetes).toBe('a, b, c, d, e, f, g, h…');
  });

  it('nom proposé par un fichier déposé : « Codes postaux — <nom sans extension> »', () => {
    expect(nomCodesPostauxFichier('clients.2026.csv')).toBe('Codes postaux — clients.2026');
  });

  it('rayon : surface, codes postaux, et la part retenue dès qu’elle passe sous 98 %', () => {
    expect(messageZoneRayon({ surface_km2: 760.4, part_retenue: 0.605 }, 120))
      .toBe(`Zone créée : ${n(760.4)} km² · 120 codes postaux · 61 % du cercle retenus (le reste est hors territoire)`);
    expect(messageZoneRayon({ surface_km2: 314.16, part_retenue: 0.99 }, 30)).toBe(`Zone créée : ${n(314.16)} km² · 30 codes postaux`);
  });

  it('dessin : tracé réparé et part retenue, séparés par « · »', () => {
    expect(messageZoneDessin({ surface_km2: 163.24, corrige: true, part_retenue: 0.5 }, 12))
      .toBe(`Zone créée : ${n(163.24)} km² · 12 codes postaux · tracé réparé (il se croisait lui-même) · 50 % retenus, le reste est hors territoire`);
    expect(messageZoneDessin({ surface_km2: 10, corrige: false, part_retenue: 1 }, undefined)).toBe('Zone créée : 10 km² · 0 codes postaux');
  });

  it('erreur d’une route source : `message`, puis `error`, puis « Erreur <statut> »', () => {
    expect(messageErreurSource({ status: 409, error: { error: 'rayon_vide', message: 'Ce rayon ne recouvre…' } })).toBe('Ce rayon ne recouvre…');
    expect(messageErreurSource({ status: 400, error: { error: 'Aucun code postal valide dans la saisie.' } })).toBe('Aucun code postal valide dans la saisie.');
    expect(messageErreurSource({ status: 502, error: null })).toBe('Erreur 502');
    expect(messageErreurSource({ status: 0, error: null })).toBe('Erreur réseau');
  });
});
