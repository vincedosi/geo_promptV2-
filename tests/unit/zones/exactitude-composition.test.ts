/**
 * B15 — l'exactitude PAR COMPOSITION (plan de corrections du découpage des zones, lot 2) : une zone faite d'unités
 * entières (CP d'une capture de score, IRIS ou CP d'un seuil sur territoires, liste de CP) est exacte dans la maille de
 * ces unités. `exactitude` lit `unites_constitutives`, pas le type de recette. Un groupe de CP indiscernables présent
 * en partie (`groupes_partiels`, posé par la base, sql/320) rend la maille non exacte : le groupe est acheté entier,
 * la perte se calcule, et l'ajustement est annoncé avant/après.
 */
import { describe, it, expect } from 'vitest';
import { appliquerSeuil, exactitude, resumeExact, type LigneSeuil } from '@/lib/zones/conversion';
import { avertissementsComposition, unitesConstitutives } from '@/lib/zones/exactitude-composition';
import type { Recette } from '@/lib/zones/recette';

/** 25 codes postaux ordinaires, de 75001 à 75025 (aucun groupe). */
const CODES_25 = Array.from({ length: 25 }, (_, i) => `750${String(i + 1).padStart(2, '0')}`);
/** 24 codes ordinaires + 35000, un seul des trois membres du groupe de Rennes (35000, 35200, 35700). */
const CODES_PARTIEL = [...CODES_25.slice(0, 24), '35000'];

const capture = (codes: readonly string[], groupes_partiels?: number): Recette => ({
  v: 1, type: 'capture', source_type: 'score',
  parametres: { indicateurs: [{ code: 'taux_pauvrete', poids: 1, sens: 'croissant' }], maille: 'cp', seuil_score: 60 },
  unites_constitutives: { maille: 'cp', codes, ...(groupes_partiels !== undefined ? { groupes_partiels } : {}) },
});

describe('B15 — exactitude par composition', () => {
  it('capture au CP de 25 codes : maille CP exacte, taux utile 100 %', () => {
    const r = capture(CODES_25, 0);
    expect(exactitude(r, 'cp')).toBe('exacte');
    const bilan = resumeExact(1_000_000, 120, 25, 25);
    expect(bilan.taux_utile).toBe(100);
    expect(bilan.manques).toBe(0);
    expect(bilan.hors_zone).toBe(0);
    // Exacte dans SA maille seulement : la même zone en communes ou en IRIS se calcule.
    expect(exactitude(r, 'commune')).toBe('calculee');
    expect(exactitude(r, 'iris')).toBe('calculee');
  });

  it('seuil sur territoires à l’IRIS : exact à l’IRIS, calculé au CP', () => {
    const r: Recette = {
      v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20,
      perimetre: { type: 'departement', code: '69' }, unites_constitutives: { maille: 'iris', codes: ['693830101', '693830102'] },
    };
    expect(exactitude(r, 'iris')).toBe('exacte');
    expect(exactitude(r, 'cp')).toBe('calculee');
  });

  it('seuil sur territoires au CP, sans groupe partiel : exact au CP', () => {
    const r: Recette = {
      v: 1, type: 'seuil_territoire', indicateur: 'abstention_pres_2022', operateur: '>=', seuil: 25,
      perimetre: { type: 'departement', code: '13' }, unites_constitutives: { maille: 'cp', codes: ['13001', '13002'], groupes_partiels: 0 },
    };
    expect(exactitude(r, 'cp')).toBe('exacte');
  });

  it('une capture sans liste d’unités (dessin capturé, zone d’avant B15) reste calculée', () => {
    expect(exactitude({ v: 1, type: 'capture', source_type: 'composite' }, 'cp')).toBe('calculee');
    expect(unitesConstitutives({ v: 1, type: 'capture', source_type: 'composite' })).toBeNull();
  });

  it('une liste de CP sans `groupes_partiels` connu n’est pas certifiée exacte (fermé par défaut)', () => {
    expect(exactitude(capture(CODES_25), 'cp')).toBe('calculee');
    expect(exactitude({ v: 1, type: 'codes_postaux', codes: CODES_25 }, 'cp')).toBe('calculee');
    expect(exactitude({ v: 1, type: 'codes_postaux', codes: CODES_25, unites_constitutives: { maille: 'cp', codes: CODES_25, groupes_partiels: 0 } }, 'cp'))
      .toBe('exacte');
  });

  it('un seul membre d’un groupe de 3 : non exacte, perte calculée, groupe acheté entier et annoncé', () => {
    const r = capture(CODES_PARTIEL, 1);
    expect(exactitude(r, 'cp')).toBe('calculee');
    // La couverture CP de la zone : 24 unités ordinaires et l'unité du groupe (canonique 35000, trois membres). Le
    // contour des trois codes est le MÊME (sql/228) : l'unité est entièrement dans la zone.
    const lignes: LigneSeuil[] = [
      ...CODES_25.slice(0, 24).map((): LigneSeuil => ({ pop_en_zone: 10_000, pop_totale: 10_000, part: 100, part_brute: 100, incluse: true })),
      { pop_en_zone: 90_000, pop_totale: 90_000, part: 100, part_brute: 100, incluse: true, membres: ['35000', '35200', '35700'] },
    ];
    const bilan = appliquerSeuil(lignes, 330_000, 50);
    expect(bilan.exacte).toBe(false);
    expect(bilan.n_unites).toBe(25);
    expect(bilan.n_codes).toBe(27);
    expect(avertissementsComposition(r, 'cp', bilan)).toEqual([{ code: 'groupes_cp_partiels', limite: 25, valeur: 27, n: 1 }]);
  });

  it('aucun avertissement de composition hors du CP, sans groupe partiel, ou pour une maille exacte', () => {
    const bilan = appliquerSeuil([], 0, 50);
    expect(avertissementsComposition(capture(CODES_PARTIEL, 1), 'commune', bilan)).toEqual([]);
    expect(avertissementsComposition(capture(CODES_25, 0), 'cp', bilan)).toEqual([]);
    expect(avertissementsComposition(capture(CODES_PARTIEL, 1), 'cp', resumeExact(1, 1, 25, 25))).toEqual([]);
  });
});
