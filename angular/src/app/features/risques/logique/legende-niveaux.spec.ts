import { CONVENTION_TRAIT, JETON_NIVEAU, JETONS_TEINTES_ZONES, niveauxLegende } from './legende-niveaux';
import { PROFIL_DEFAUT } from './profil';

describe('legende-niveaux (partagé par les deux légendes de zones)', () => {
  it('profil par défaut : trois niveaux, libellés de LIBELLE_NIVEAU, jetons --niveau-*, anneaux appliqués', () => {
    expect(niveauxLegende(PROFIL_DEFAUT)).toEqual([
      { libelle: 'Seveso seuil haut', jeton: 'niveau-haut', anneaux: [1000, 2000, 5000] },
      { libelle: 'Seveso seuil bas', jeton: 'niveau-bas', anneaux: [500, 1000] },
      { libelle: 'Autres régimes', jeton: 'niveau-autres', anneaux: [] },
    ]);
  });

  it('profil LIÉ : chaque niveau porte les anneaux du seuil haut (anneauxDuNiveau)', () => {
    const lie = niveauxLegende({ ...PROFIL_DEFAUT, lie: true, autres: [300] });
    expect(lie.map((n) => n.anneaux)).toEqual([[1000, 2000, 5000], [1000, 2000, 5000], [1000, 2000, 5000]]);
  });

  it('une seule table de jetons ; les teintes de zones y ajoutent le halo ; la convention de trait est fixe', () => {
    expect(JETON_NIVEAU).toEqual({ haut: 'niveau-haut', bas: 'niveau-bas', autres: 'niveau-autres' });
    expect(JETONS_TEINTES_ZONES).toEqual({ ...JETON_NIVEAU, halo: 'halo-carte' });
    expect(CONVENTION_TRAIT).toBe('Trait plein : périmètre publié par l’État. Tireté : rayon que nous calculons.');
  });
});
