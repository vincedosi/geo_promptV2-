import { describe, expect, it } from 'vitest';
import { ADAPTATEUR_GARES } from '@/lib/ooh/plan/adaptateurs/mediatransports-gares';
import { classeurEssai, type ValeurEssai } from './_classeur';

const vide = (n: number): null[] => Array.from({ length: n }, () => null);
const ENTETE: ValeurEssai[] = ['SITES', 'METRO', 'GARE', 'SOLO', 'SOLO', 'DUO', 'TRIO', 'QUATRO', 'Total général', 'Patrimoine potentiel maximal'];
const SOUS: ValeurEssai[] = [null, null, null, '9/16ème', '16/9ème', 'compacte', 'compacte', 'compacte', null, null];

/** Une liste SYNTHÉTIQUE de la forme « LISTING GARE » : deux blocs côte à côte, IDF (A-J) et province (L-U). */
const LISTE: ValeurEssai[][] = [
  ['DOOH GARE IDF', ...vide(10), 'DOOH GARE PROVINCE'],
  ['Synthèse', ...vide(10), 'Synthèse'],
  [],
  [...ENTETE, null, ...ENTETE],
  [...SOUS, null, ...SOUS],
  ['VILLE A - GARE DE VILLE A', null, 1, 1, null, null, null, null, 1, 2, null, 'VILLE B', null, 4, 1, null, null, 3, null, 4, 7],
  ['VILLE C', null, 2, 2, null, null, null, null, 2, 3, null, 'Total Région', null, 4, 1, null, null, 3, null, 4, 7],
  ['Total Paris', null, 3, 3, null, null, null, null, 3, 5],
  ['Total sites Paris : 2'],
];

describe('adaptateur mediatransports-gares', () => {
  it('reconnaît la liste par ses en-têtes SITES et GARE', async () => {
    expect(ADAPTATEUR_GARES.reconnait(await classeurEssai({ 'LISTING GARE': LISTE }))).toBe(true);
    expect(ADAPTATEUR_GARES.reconnait(await classeurEssai({ AUTRE: [['CLub name']] }))).toBe(false);
  });

  it('une gare par ligne de chaque bloc, totaux ignorés', async () => {
    const { emplacements, lignes } = ADAPTATEUR_GARES.lire(await classeurEssai({ 'LISTING GARE': LISTE }));
    expect(lignes).toEqual([]);
    expect(emplacements.map((e) => [e.nom_lieu, e.recherche])).toEqual([
      ['VILLE A - GARE DE VILLE A', { type: 'gare', nom: 'VILLE A - GARE DE VILLE A', bloc: 'idf' }],
      ['VILLE C', { type: 'gare', nom: 'VILLE C', bloc: 'idf' }],
      ['VILLE B', { type: 'gare', nom: 'VILLE B', bloc: 'province' }],
    ]);
  });

  it('écrans, formats et tout le détail de la ligne', async () => {
    const { emplacements } = ADAPTATEUR_GARES.lire(await classeurEssai({ 'LISTING GARE': LISTE }));
    const b = emplacements.find((e) => e.nom_lieu === 'VILLE B')!;
    expect(b).toMatchObject({
      adaptateur: 'mediatransports-gares', cle: 'VILLE B', type_lieu: 'gare', reseau: 'DOOH gare', numerique: true,
      nb_ecrans: 4, formats: ['solo 9/16', 'trio'], adresse: null, reference_panneau: null,
    });
    expect(b.metadata).toMatchObject({ onglet: 'LISTING GARE', bloc: 'province', ecrans_par_format: { 'solo 9/16': 1, trio: 3 }, patrimoine_max: 7 });
    expect(b.metadata.lignes).toEqual([{
      numero: 6,
      cellules: {
        SITES: 'VILLE B', METRO: null, GARE: 4, 'SOLO 9/16ème': 1, 'SOLO 16/9ème': null, 'DUO compacte': null,
        'TRIO compacte': 3, 'QUATRO compacte': null, 'Total général': 4, 'Patrimoine potentiel maximal': 7,
      },
    }]);
  });
});
