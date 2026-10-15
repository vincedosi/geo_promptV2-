import { libelleRecetteAffiche, libelleSource } from './libelle-zone';

const CATALOGUE = [
  { indicator_code: 'taux_pauvrete', label: 'Taux de pauvreté', famille: 'Revenus', unit: '%' },
  { indicator_code: 'nb_menages', label: 'Ménages', famille: null, unit: null },
];

describe('libelleSource (puces et ligne de source de « Mes zones »)', () => {
  it('un type `recette_*` a un libellé lisible ; les autres passent par la table verrouillée de React', () => {
    expect(libelleSource('recette_codes_postaux')).toEqual({ label: 'Codes postaux', isReadable: true });
    expect(libelleSource('recette_seuil_carreaux')).toEqual({ label: 'Seuil sur carreaux', isReadable: true });
    expect(libelleSource('recette_combinaison')).toEqual({ label: 'Combinaison', isReadable: true });
    expect(libelleSource('admin_filter')).toEqual({ label: 'Filtre territorial', isReadable: true });
    expect(libelleSource('recette_inconnue')).toEqual({ label: 'recette_inconnue', isReadable: false });
    expect(libelleSource('truc')).toEqual({ label: 'truc', isReadable: false });
  });
});

describe('libelleRecetteAffiche', () => {
  it('seuil sur territoires : le LIBELLÉ du catalogue et son unité, jamais l’id brut (report T2)', () => {
    const r = { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20.5, perimetre: null } as const;
    expect(libelleRecetteAffiche(r, CATALOGUE)).toBe('Territoires où taux de pauvreté ≥ 20,5 %');
    expect(libelleRecetteAffiche({ ...r, indicateur: 'nb_menages', operateur: '<=' }, CATALOGUE)).toBe('Territoires où ménages ≤ 20,5');
  });

  it('seuil sur territoires sans catalogue (pas encore lu, ou indicateur retiré) : le libellé de base', () => {
    const r = { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: null } as const;
    expect(libelleRecetteAffiche(r, [])).toBe('Territoires où taux_pauvrete ≥ 20');
  });

  it('les autres recettes : `libelleRecette`', () => {
    expect(libelleRecetteAffiche({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: null }, CATALOGUE))
      .toBe('Rayon de 5 km autour des POI « lycee »');
    expect(libelleRecetteAffiche({ v: 1, type: 'codes_postaux', codes: ['75001', '75002'] }, [])).toBe('2 codes postaux');
  });
});
