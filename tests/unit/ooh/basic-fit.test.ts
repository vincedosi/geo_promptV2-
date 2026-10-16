import { describe, expect, it } from 'vitest';
import { ADAPTATEUR_BASIC_FIT, decouperLibelleBasicFit } from '@/lib/ooh/plan/adaptateurs/basic-fit';
import { classeurEssai } from './_classeur';

describe('decouperLibelleBasicFit — les formes de libellé d une liste de lecteurs (libellés SYNTHÉTIQUES)', () => {
  it.each([
    ['Basic-Fit FR Villetest Avenue des Essais 1234 WW', { code: '1234', type: 'WW', ville: 'Villetest', rue: 'Avenue des Essais', lecteur: null }],
    ['FR Bourg-Essai 2345 DS-1', { code: '2345', type: 'DS', ville: 'Bourg-Essai', rue: null, lecteur: null }],
    ['FR - Saint-Essai - 3456 - Player 1 - Digital Signage 1', { code: '3456', type: 'DS', ville: 'Saint-Essai', rue: null, lecteur: 'Player 1 - Digital Signage 1' }],
    ['FR - Villetest - 3457 - Player 1 - Welcome Wall 1', { code: '3457', type: 'WW', ville: 'Villetest', rue: null, lecteur: 'Player 1 - Welcome Wall 1' }],
    ['FR 4567 Villetest rue du Banc NC', { code: '4567', type: 'NC', ville: 'Villetest', rue: 'rue du Banc', lecteur: null }],
    ['5678 WW Villetest Route des Bancs', { code: '5678', type: 'WW', ville: 'Villetest', rue: 'Route des Bancs', lecteur: null }],
    ['Basic-Fit FR Villetest Rue du 8 Mai 1945 6789 NC', { code: '6789', type: 'NC', ville: 'Villetest', rue: 'Rue du 8 Mai 1945', lecteur: null }],
    ['Basic-Fit FR Villetest Rue Sans Code NC', { code: null, type: 'NC', ville: 'Villetest', rue: 'Rue Sans Code', lecteur: null }],
    ['Basic-FIt FR Villetest Avenue de l’Essai EXPRESS 7890 WW', { code: '7890', type: 'WW', ville: 'Villetest', rue: "Avenue de l'Essai EXPRESS", lecteur: null }],
    ['FR Villetest 7029 DS-', { code: '7029', type: 'DS', ville: 'Villetest', rue: null, lecteur: null }],
    ['Basic-Fit FR Villetest Zone Industrielle Rue Haute 7032 W', { code: '7032', type: 'W', ville: 'Villetest', rue: 'Zone Industrielle Rue Haute', lecteur: null }],
    ['FR Villetest 7034 WW1', { code: '7034', type: 'WW', ville: 'Villetest', rue: null, lecteur: null }],
    ['Basic-Fit FR Port-Essai Rue du Quai', { code: null, type: null, ville: 'Port-Essai', rue: 'Rue du Quai', lecteur: null }],
    ['Basic-Fit FR Fréville-Essai Rue Haute 1111 NC', { code: '1111', type: 'NC', ville: 'Fréville-Essai', rue: 'Rue Haute', lecteur: null }],
  ])('%s', (libelle, attendu) => {
    expect(decouperLibelleBasicFit(libelle)).toEqual(attendu);
  });

  it('un libellé vide après les préfixes rend null', () => {
    expect(decouperLibelleBasicFit('Basic-Fit FR ')).toBeNull();
  });
});

describe('adaptateur basic-fit', () => {
  const LISTE = [
    ['CLub name'],
    ['Basic-Fit FR Villetest Avenue des Essais 1234 WW'],
    ['Basic-Fit FR Villetest Avenue des Essais 1234 NC'],
    ['FR Bourg-Essai 2345 DS-1'],
    ['Basic-Fit FR Villetest Rue Sans Code NC'],
    ['Basic-Fit FR Villetest Rue Sans Code WW'],
    [],
  ];

  it('reconnaît la liste par son en-tête « CLub name »', async () => {
    expect(ADAPTATEUR_BASIC_FIT.reconnait(await classeurEssai({ 'LISTING BASIC FIT': LISTE }))).toBe(true);
  });

  it('un emplacement par club : lecteurs comptés, types réunis, toutes les lignes gardées', async () => {
    const { emplacements } = ADAPTATEUR_BASIC_FIT.lire(await classeurEssai({ 'LISTING BASIC FIT': LISTE }));
    expect(emplacements).toHaveLength(3);
    const club = emplacements.find((e) => e.cle === '1234')!;
    expect(club).toMatchObject({
      adaptateur: 'basic-fit', nom_lieu: 'Basic-Fit Villetest Avenue des Essais', type_lieu: 'salle de sport',
      reseau: 'DOOH salle de sport', numerique: true, nb_ecrans: 2, formats: ['WW', 'NC'], adresse: 'Avenue des Essais',
      code_postal: null, ville: 'Villetest', reference_panneau: '1234',
      recherche: { type: 'adresse', adresse: 'Avenue des Essais', code_postal: null, ville: 'Villetest', commune_seule: false },
    });
    expect(club.metadata.lignes.map((l) => l.numero)).toEqual([2, 3]);
    expect(club.metadata.lignes[0].cellules).toEqual({ 'CLub name': 'Basic-Fit FR Villetest Avenue des Essais 1234 WW' });
  });

  it('sans rue : la commune seule est cherchée ; sans code : la clé est la ville et la rue', async () => {
    const { emplacements } = ADAPTATEUR_BASIC_FIT.lire(await classeurEssai({ 'LISTING BASIC FIT': LISTE }));
    expect(emplacements.find((e) => e.cle === '2345')!.recherche)
      .toEqual({ type: 'adresse', adresse: '', code_postal: null, ville: 'Bourg-Essai', commune_seule: true });
    const sansCode = emplacements.find((e) => e.cle === 'sans-code:VILLETEST|RUE SANS CODE')!;
    expect(sansCode).toMatchObject({ nb_ecrans: 2, formats: ['NC', 'WW'], reference_panneau: null });
  });
});
