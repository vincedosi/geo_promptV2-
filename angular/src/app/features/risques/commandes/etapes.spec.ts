import { ETAPES, LIBELLE_ETAPE, etapeRenseignee } from '../logique/etape';
import { ETAT_DEFAUT } from '../logique/etat-url';
import { etapesAffichees } from './etapes';

describe('etapesAffichees', () => {
  it("état par défaut : cinq étapes, rangs 1 à 5, libellés de LIBELLE_ETAPE, pastille = etapeRenseignee", () => {
    const e = etapesAffichees(ETAT_DEFAUT, false);
    expect(e.map((x) => x.cle)).toEqual([...ETAPES]);
    expect(e.map((x) => x.rang)).toEqual([1, 2, 3, 4, 5]);
    expect(e.map((x) => x.libelle)).toEqual(ETAPES.map((x) => LIBELLE_ETAPE[x]));
    expect(e.map((x) => x.renseignee)).toEqual(ETAPES.map((x) => etapeRenseignee(x, { ...ETAT_DEFAUT, simulation: false })));
    // ① des régimes retenus, ② des anneaux ; ni territoire, ni jeu, ni campagne.
    expect(e.map((x) => x.renseignee)).toEqual([true, true, false, false, false]);
  });

  it('territoire, jeu et simulation allument ③, ④ et ⑤ ; aucun régime éteint ①', () => {
    const e = etapesAffichees(
      { ...ETAT_DEFAUT, gravites: [], chemin: ['departement:13'], jeu: '0b7ece33-4903-4a0b-a57a-f6c54e78a729' },
      true,
    );
    expect(e.map((x) => x.renseignee)).toEqual([false, true, true, true, true]);
  });
});
