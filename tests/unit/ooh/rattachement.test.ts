import { describe, expect, it } from 'vitest';
import { lirePlan, rattacher } from '@/lib/ooh/plan/adaptateurs';
import { classeurEssai, type ValeurEssai } from './_classeur';

const jour = (j: number) => new Date(Date.UTC(2026, 8, j));
const HYP: ValeurEssai[][] = [
  [null, 'ESSAI - 20/09 - 02/10'],
  [null, 'AFFICHEURS', 'RESEAUX', "NBRE D'ECRANS", 'FORMAT', 'LOGS', 'DEPART', 'DUREE', 'RANG OPTION', 'TARIF BRUT', 'TARIF NET ESTIME', 'FRAIS ESTIMES', 'HONO NET+FRAIS', 'TOTAL TTCHI'],
  [null, 'METROPOLE'],
  [null, 'MEDIATRANSPORTS', 'DOOH GARE - 2 gares', 3, 'DOOH', 10, jour(21), '2 semaines', '2nd OPTION', 1, 1, 1, 1, 1],
  [null, 'BASIC FIT', 'DOOH SALLE - 1 clubs', 4, 'DOOH', 10, jour(20), '2 semaines', '2nd OPTION', 1, 1, 1, 1, 1],
  [null, 'DROM TOM'],
  [null, 'MEDIAOUTREMER', 'LA REUNION', 5, '12m²', null, jour(24), '7 jours', '2nd OPTION', 1, 1, 1, 1, 1],
];
const GARES: ValeurEssai[][] = [
  ['DOOH GARE IDF'],
  [],
  ['SITES', 'METRO', 'GARE', 'SOLO', 'SOLO', 'DUO', 'TRIO', 'QUATRO', 'Total général', 'Patrimoine potentiel maximal'],
  [null, null, null, '9/16ème', '16/9ème', 'compacte', 'compacte', 'compacte'],
  ['VILLE A', null, 1, 1, null, null, null, null, 1, 1],
  ['VILLE C', null, 2, 2, null, null, null, null, 2, 2],
];
const CLUBS: ValeurEssai[][] = [['CLub name'], ['Basic-Fit FR Villetest Avenue des Essais 1234 WW']];

describe('lirePlan et rattacher', () => {
  it('reconnaît la synthèse et les listes, puis rattache chaque liste à la ligne de sa régie', async () => {
    const plan = lirePlan(await classeurEssai({ HYP1: HYP, 'LISTING GARE': GARES, 'LISTING BASIC FIT': CLUBS }));
    expect(plan.adaptateurs).toEqual(['synthese-hyp', 'mediatransports-gares', 'basic-fit']);
    expect(plan.lignes.map((l) => l.regie)).toEqual(['MEDIATRANSPORTS', 'BASIC FIT', 'MEDIAOUTREMER']);
    const r = rattacher(plan.lignes, plan.emplacements);
    expect(r.get(1)?.adaptateur).toBe('mediatransports-gares');
    expect(r.get(1)?.emplacements.map((e) => e.cle)).toEqual(['VILLE A', 'VILLE C']);
    expect(r.get(2)?.adaptateur).toBe('basic-fit');
    expect(r.get(2)?.emplacements).toHaveLength(1);
    expect(r.has(3)).toBe(false);
  });

  it('un plan sans onglet de synthèse est refusé, en français', async () => {
    expect(() => lirePlan({ feuilles: new Map() })).toThrow('Aucun onglet de synthèse reconnu');
  });

  it('une liste n est rattachée qu à la première ligne de sa régie', async () => {
    const plan = lirePlan(await classeurEssai({ HYP1: [...HYP, [null, 'MEDIATRANSPORTS', 'DOOH GARE BIS', 1, 'DOOH', 1, jour(28), '7 jours', '2nd OPTION', 1, 1, 1, 1, 1]], 'LISTING GARE': GARES }));
    const r = rattacher(plan.lignes, plan.emplacements);
    expect(r.get(1)?.adaptateur).toBe('mediatransports-gares');
    expect(r.has(4)).toBe(false);
  });
});
