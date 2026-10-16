import { describe, expect, it } from 'vitest';
import { ADAPTATEUR_STRIDE } from '@/lib/ooh/plan/adaptateurs/stride-campus';
import { classeurEssai } from './_classeur';

const ENTETE = ['Etablissement', 'Groupement', 'Type', 'Adresse', 'CP', 'Ville', 'Zone', 'Ecrans', 'Taille écrans', 'Contacts par semaine', 'Contacts 18-25 par semaine'];
const LISTE = [
  [],
  ENTETE,
  ['Campus Essai', '0', 'Campus', "1 rue de l'Essai", '13008', 'Villetest', 'Zone A', '1', '10', '6000', '5700'],
  ['Cinéma Essai', 'Groupe Essai', 'Cinéma', '2 avenue Test', 75001, 'Paris', 'Paris', 2, 43, 150000, 142500],
  [],
  ['Campus Essai', '0', 'Campus', "1 rue de l'Essai", '13008', 'Villetest', 'Zone A', '1', '10', '6000', '5700'],
];

describe('adaptateur stride-campus', () => {
  it('reconnaît la liste par ses en-têtes', async () => {
    expect(ADAPTATEUR_STRIDE.reconnait(await classeurEssai({ 'LISTING CAMPUS': LISTE }))).toBe(true);
  });

  it('un emplacement par établissement et code postal : écrans, taille, contacts, adresse complète', async () => {
    const { emplacements } = ADAPTATEUR_STRIDE.lire(await classeurEssai({ 'LISTING CAMPUS': LISTE }));
    expect(emplacements).toHaveLength(2);
    expect(emplacements[1]).toMatchObject({
      adaptateur: 'stride-campus', cle: 'CINEMA ESSAI|75001', nom_lieu: 'Cinéma Essai', type_lieu: 'cinéma',
      reseau: 'DOOH borne de recharge', numerique: true, nb_ecrans: 2, formats: ['43"'], adresse: '2 avenue Test',
      code_postal: '75001', ville: 'Paris', contacts_semaine: 150000, contacts_18_25_semaine: 142500,
      recherche: { type: 'adresse', adresse: '2 avenue Test', code_postal: '75001', ville: 'Paris', commune_seule: false },
    });
    expect(emplacements[1].metadata).toMatchObject({ onglet: 'LISTING CAMPUS', groupement: 'Groupe Essai', zone: 'Paris', taille_ecran_pouces: 43 });
  });

  it('deux lignes du même établissement sont réunies ; un groupement « 0 » est absent', async () => {
    const { emplacements } = ADAPTATEUR_STRIDE.lire(await classeurEssai({ 'LISTING CAMPUS': LISTE }));
    expect(emplacements[0]).toMatchObject({ cle: 'CAMPUS ESSAI|13008', type_lieu: 'campus', nb_ecrans: 2, contacts_semaine: 12000, contacts_18_25_semaine: 11400 });
    expect(emplacements[0].metadata.groupement).toBeNull();
    expect(emplacements[0].metadata.lignes.map((l) => l.numero)).toEqual([3, 6]);
  });
});
