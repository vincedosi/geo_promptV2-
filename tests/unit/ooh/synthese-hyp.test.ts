import { describe, expect, it } from 'vitest';
import { ADAPTATEUR_SYNTHESE } from '@/lib/ooh/plan/adaptateurs/synthese-hyp';
import { classeurEssai, type ValeurEssai } from './_classeur';

const jour = (m: number, j: number) => new Date(Date.UTC(2026, m - 1, j));

/** Un onglet de synthèse SYNTHÉTIQUE, de la forme de l'onglet HYP d'un plan de régie (colonne A vide, comme le fichier). */
const HYP: ValeurEssai[][] = [
  [null, 'ESSAI CAMPAGNE TEST - 20/09 - 02/10'],
  [null, 'HYPOTHESE 1'],
  [null, 'AFFICHEURS', 'RESEAUX', "NBRE D'ECRANS", 'FORMAT', 'LOGS', 'DEPART', 'DUREE', 'RANG OPTION', 'TARIF BRUT', 'TARIF NET ESTIME', 'FRAIS ESTIMES', 'HONO NET+FRAIS', 'TOTAL TTCHI'],
  [null, 'METROPOLE'],
  [null, 'MEDIATRANSPORTS', 'DOOH GARE \nTH MATIN - 10 gares', 20, 'DOOH', 1000, jour(9, 21), '2 semaines', '2nd OPTION', 100, 60, 5, 1, 80],
  [null, 'BASIC FIT', 'DOOH SALLE DE SPORT - BASIC FIT \nTH 16-22h - 3 clubs', 9, 'DOOH', 500, jour(9, 20), '2*5 jours', '2nd OPTION', 50, 30, 2, 1, 40],
  [null, 'DROM TOM'],
  [null, 'MEDIAOUTREMER', 'LA REUNION', 12, '12m²', null, jour(9, 24), '9 jrs dont 2 offert', '2nd OPTION', 20, 10, 1, 0.5, 13.5],
  [],
  [null, "IMPRESSION JUSQU'À 5 VISUELS", null, null, null, null, null, null, null, null, null, 400, 6, 487.2],
  [null, 'TOTAL', null, 41, null, null, null, null, null, 170, 100, 408, 8.5, 620.7],
  [],
  [null, "MEDIATRANSPORTS : diffusion d'un spot de 10\" du lundi au vendredi en TH matin (7h-10h) au sein des gares. Contacts 15+ : 1 000 000 / contacts 18-24 : 200 000"],
  [null, "BASIC FIT : diffusion d'un spot de 10\" du lundi au vendredi en TH soir (16h-22h), au sein des salles. Contacts 15+ : 50 000  / contacts 18-24 : 20 000"],
];

describe('adaptateur synthese-hyp', () => {
  it('reconnaît l onglet de synthèse par son en-tête, pas par son nom', async () => {
    expect(ADAPTATEUR_SYNTHESE.reconnait(await classeurEssai({ 'NOM LIBRE': HYP }))).toBe(true);
    expect(ADAPTATEUR_SYNTHESE.reconnait(await classeurEssai({ AUTRE: [['CLub name'], ['x']] }))).toBe(false);
  });

  it('l en-tête : titre, hypothèse, période du titre, budget total, coûts annexes, notes', async () => {
    const { entete } = ADAPTATEUR_SYNTHESE.lire(await classeurEssai({ HYP1: HYP }));
    expect(entete).toEqual({
      titre: 'ESSAI CAMPAGNE TEST - 20/09 - 02/10',
      hypothese: 'HYPOTHESE 1',
      date_debut: '2026-09-20',
      date_fin: '2026-10-02',
      budget_total_ttc: 620.7,
      couts_annexes: [{ libelle: "IMPRESSION JUSQU'À 5 VISUELS", frais: 400, honoraires: 6, total_ttc: 487.2 }],
      notes: [expect.stringMatching(/^MEDIATRANSPORTS :/), expect.stringMatching(/^BASIC FIT :/)],
    });
  });

  it('une ligne de métropole : réseau, écrans, dates calculées, montants, contacts et plage horaire des notes', async () => {
    const { lignes } = ADAPTATEUR_SYNTHESE.lire(await classeurEssai({ HYP1: HYP }));
    expect(lignes).toHaveLength(3);
    expect(lignes[0]).toMatchObject({
      ordre: 1, media: 'ooh', regie: 'MEDIATRANSPORTS', reseau: 'DOOH GARE', territoire: null,
      nb_ecrans: 20, format: 'DOOH', nb_diffusions: 1000, date_debut: '2026-09-21', date_fin: '2026-10-04',
      duree_libelle: '2 semaines', rang_option: '2nd OPTION', montant_brut: 100, montant_net: 60, frais: 5, honoraires: 1, total_ttc: 80,
      contacts_15_plus: 1000000, contacts_18_24: 200000, plage_horaire: 'du lundi au vendredi en TH matin (7h-10h)',
    });
    expect(lignes[0].details).toMatchObject({ onglet: 'HYP1', ligne: 5, section: 'METROPOLE', nb_lieux_plan: 10, unite_lieux_plan: 'gares', jours_diffusion: 14 });
    expect(lignes[0].details.cellules).toMatchObject({ AFFICHEURS: 'MEDIATRANSPORTS', LOGS: 1000, DEPART: '2026-09-21' });
    expect(lignes[1]).toMatchObject({
      regie: 'BASIC FIT', reseau: 'DOOH SALLE DE SPORT - BASIC FIT', date_debut: '2026-09-20', date_fin: '2026-10-03',
      contacts_15_plus: 50000, contacts_18_24: 20000, plage_horaire: 'du lundi au vendredi en TH soir (16h-22h)',
    });
    expect(lignes[1].details).toMatchObject({ nb_lieux_plan: 3, unite_lieux_plan: 'clubs', jours_diffusion: 10 });
  });

  it('une ligne DROM : territoire au lieu du réseau, sans diffusions, sans contacts ni plage', async () => {
    const { lignes } = ADAPTATEUR_SYNTHESE.lire(await classeurEssai({ HYP1: HYP }));
    expect(lignes[2]).toMatchObject({
      ordre: 3, regie: 'MEDIAOUTREMER', reseau: null, territoire: 'LA REUNION', nb_ecrans: 12, format: '12m²',
      nb_diffusions: null, date_debut: '2026-09-24', date_fin: '2026-10-02', contacts_15_plus: null, contacts_18_24: null, plage_horaire: null,
    });
    expect(lignes[2].details.section).toBe('DROM TOM');
  });

  it('ne lit aucun emplacement', async () => {
    expect(ADAPTATEUR_SYNTHESE.lire(await classeurEssai({ HYP1: HYP })).emplacements).toEqual([]);
  });
});
