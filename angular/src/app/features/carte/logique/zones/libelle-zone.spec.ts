import { libelleSource } from './libelle-zone';
import { libelleRecette } from './recette';

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

// Le libellé d'une recette est `libelleRecette` (copie paritaire de `lib/zones/recette.ts`, testée côté serveur) :
// ce qui suit vérifie seulement que le catalogue Angular (`IndicateurRegistre`, avec `famille`) s'y passe tel quel.
describe('libelleRecette avec le catalogue Angular', () => {
  it('seuil sur territoires : le LIBELLÉ du catalogue et son unité, jamais l’id brut', () => {
    const r = { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20.5, perimetre: null } as const;
    expect(libelleRecette(r, CATALOGUE)).toBe('Territoires où taux de pauvreté ≥ 20,5 %');
    expect(libelleRecette({ ...r, indicateur: 'nb_menages', operateur: '<=' }, CATALOGUE)).toBe('Territoires où ménages ≤ 20,5');
    expect(libelleRecette(r, [])).toBe('Territoires où taux_pauvrete ≥ 20,5');
  });
});
