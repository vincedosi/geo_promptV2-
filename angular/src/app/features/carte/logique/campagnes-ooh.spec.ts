import { formaterNombre } from '../../../core/format/nombre';
import { DETAIL_ESSAI, ligneEssai } from '../testing/campagnes-ooh.fixture';
import {
  collectionCarte, donneesRegie, emprise, formaterScore, libelleEcart, libelleNonPlaces, libellePeriode, montantTtc, rangsDesLignes,
} from './campagnes-ooh';

describe('campagnes OOH — logique pure', () => {
  it('rangsDesLignes : une teinte par ligne qui a des emplacements, dans l ordre, huit au plus puis on recommence', () => {
    const lignes = Array.from({ length: 9 }, (_, i) => ligneEssai(`l${i + 1}`, i + 1));
    lignes.push(ligneEssai('drom', 10, { a_des_emplacements: false }));
    const rangs = rangsDesLignes(lignes);
    expect([...rangs.values()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 1]);
    expect(rangs.has('drom')).toBe(false);
  });

  it('collectionCarte : propriétés minimales, lignes masquées retirées', () => {
    const rangs = rangsDesLignes(DETAIL_ESSAI.lignes);
    const toutes = collectionCarte(DETAIL_ESSAI, rangs, new Set());
    expect(toutes.features.map((f) => f.properties)).toEqual([
      { id: 'p1', ligne: 'l1', rang: 1, qualite: 'sure' },
      { id: 'p2', ligne: 'l1', rang: 1, qualite: 'a_verifier' },
    ]);
    expect(collectionCarte(DETAIL_ESSAI, rangs, new Set(['l1'])).features).toEqual([]);
  });

  it('emprise des emplacements, null sans emplacement', () => {
    expect(emprise(DETAIL_ESSAI.emplacements)).toEqual([2.1, 48.1, 2.3, 48.3]);
    expect(emprise([])).toBeNull();
  });

  it('période, montant, score', () => {
    expect(libellePeriode('2026-09-20', '2026-10-02')).toBe('20/09/2026 → 02/10/2026');
    expect(libellePeriode(null, null)).toBe('—');
    expect(montantTtc(48480)).toBe(`${formaterNombre(48480)} € TTC`);
    expect(montantTtc(null)).toBe('—');
    expect(formaterScore(0.456)).toBe('0,46');
    expect(formaterScore(null)).toBe('—');
  });

  it('écart entre la liste et le plan : affiché seulement s il existe, accordé', () => {
    const clubs = ligneEssai('b', 1, { nb_places: 882, nb_ecrans: 4802, details: { nb_lieux_plan: 905, unite_lieux_plan: 'clubs' } });
    expect(libelleEcart(clubs)).toBe(`${formaterNombre(882)} clubs placés · plan : ${formaterNombre(905)} clubs, ${formaterNombre(4802)} écrans`);
    const gares = ligneEssai('g', 1, { nb_places: 213, nb_ecrans: 490, details: { nb_lieux_plan: 215, unite_lieux_plan: 'gares' } });
    expect(libelleEcart(gares)).toBe(`${formaterNombre(213)} gares placées · plan : ${formaterNombre(215)} gares, ${formaterNombre(490)} écrans`);
    expect(libelleEcart(ligneEssai('x', 1, { nb_places: 215, details: { nb_lieux_plan: 215, unite_lieux_plan: 'gares' } }))).toBeNull();
    expect(libelleEcart(ligneEssai('y', 1))).toBeNull();
  });

  it('non placés : singulier et pluriel', () => {
    expect(libelleNonPlaces(1)).toBe('1 emplacement non placé');
    expect(libelleNonPlaces(3)).toBe('3 emplacements non placés');
  });

  it('données de la régie : une ligne d origine par groupe, cellules vides omises, puis ce que l import a lu', () => {
    expect(donneesRegie(DETAIL_ESSAI.emplacements[0].properties.metadata)).toEqual([
      { titre: 'LISTING CAMPUS, ligne 3', cellules: [['Etablissement', 'Lieu p1'], ['CP', '45000']] },
      { titre: 'Lu par l’import', cellules: [['groupement', 'Groupe']] },
    ]);
    expect(donneesRegie(null)).toEqual([]);
  });
});
