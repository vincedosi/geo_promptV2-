/**
 * B13 — les minimums de population par UNITÉ et par GROUPE, chacun avec son comportement lu dans le registre
 * (`plateformes_geo`, sql/318). Les lignes ci-dessous recopient le relevé en base : DV360 cercle 1 000 par cercle en
 * `refus` (comportement « à vérifier » : non défini pour un cercle exact unique), TikTok département 1 000 par groupe
 * en `avertissement`, Meta sans minimum. Aucune valeur n'est écrite dans le code testé : elles sont toutes ici.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resumeExact, appliquerSeuil } from '@/lib/zones/conversion';
import {
  avertissementsEcartes, controlerPopulation, minimumPopulation, popMinPavage, populationDeForme,
} from '@/lib/zones/conversion-population';
import { PlateformeGeoSchema, type PlateformeGeo } from '@/lib/zones/plateformes';

const ligne = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: 'x', natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-11-02', a_verifier: false,
  note: null, ordre: 0, ...p,
});

const DV360_CERCLE = ligne({
  plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 1000, pop_min_unite: 1000 },
  pop_min_unite_comportement: 'refus', parametres_a_verifier: ['pop_min_unite_comportement'],
});
const TIKTOK_DEP = ligne({
  plateforme: 'tiktok', maille: 'departement', limites: { max_unites: 3000, pop_min_groupe: 1000 },
  pop_min_groupe_comportement: 'avertissement',
});
const META_CERCLE = ligne({ plateforme: 'meta', maille: 'cercle', limites: { max_unites: 200, rayon_min_m: 1000, rayon_max_m: 80000 } });

describe('B13 — le cercle exact unique passe par le même contrôle que les autres unités', () => {
  it('cercle exact de 1 km à 300 habitants sur DV360 : refus du registre, chiffré, « à vérifier » sur le comportement', () => {
    const bilan = resumeExact(300, 3.14);
    expect(controlerPopulation(bilan, [300], DV360_CERCLE)).toEqual({
      refus: { code: 'pop_min_unite', limite: 1000, valeur: 300, n: 1, plateforme: 'dv360', a_verifier: true, refus: true },
      avertissements: [],
    });
  });
  it('le même cercle à 1 000 habitants passe (la borne est admise)', () => {
    expect(controlerPopulation(resumeExact(1000, 3.14), [1000], DV360_CERCLE)).toEqual({ refus: null, avertissements: [] });
  });
  it('le comportement vient du registre : la même ligne en `avertissement` achète et le dit', () => {
    const r = controlerPopulation(resumeExact(300, 3.14), [300], { ...DV360_CERCLE, pop_min_unite_comportement: 'avertissement' });
    expect(r.refus).toBeNull();
    expect(r.avertissements).toEqual([{ code: 'pop_min_unite', limite: 1000, valeur: 300, n: 1, plateforme: 'dv360', a_verifier: true }]);
  });
  it('plusieurs unités sous le minimum : dites en une fois, la moins peuplée en valeur ; une population inconnue est dite à part', () => {
    const r = controlerPopulation({ achetee: 5_000 }, [4_000, 800, null, 300], { ...DV360_CERCLE, pop_min_unite_comportement: 'avertissement' });
    expect(r.avertissements).toEqual([
      { code: 'pop_min_unite', limite: 1000, valeur: 300, n: 2, plateforme: 'dv360', a_verifier: true },
      { code: 'pop_min_unite', limite: 1000, valeur: 0, n: 1, non_verifiable: true, plateforme: 'dv360', a_verifier: true },
    ]);
  });
});

describe('B13 — minimum par groupe', () => {
  it('TikTok : un groupe de 800 personnes avertit (registre : avertissement), sans refus', () => {
    const bilan = appliquerSeuil([{ pop_en_zone: 500, pop_totale: 800, part: 62.5, part_brute: 62.5 }], 500, 20);
    expect(controlerPopulation(bilan, [800], TIKTOK_DEP)).toEqual({
      refus: null, avertissements: [{ code: 'pop_min_groupe', limite: 1000, valeur: 800, plateforme: 'tiktok' }],
    });
  });
  it('TikTok : un groupe de 1 000 personnes passe', () => {
    expect(controlerPopulation({ achetee: 1000 }, [1000], TIKTOK_DEP)).toEqual({ refus: null, avertissements: [] });
  });
  it('un groupe en `refus` au registre refuse', () => {
    expect(controlerPopulation({ achetee: 800 }, [800], { ...TIKTOK_DEP, pop_min_groupe_comportement: 'refus' }).refus)
      .toEqual({ code: 'pop_min_groupe', limite: 1000, valeur: 800, plateforme: 'tiktok', refus: true });
  });
  it('A4 (M-1) : une diffusion entièrement inconnue — minimum non vérifiable, jamais « 0 personne achetée » ni refus', () => {
    expect(controlerPopulation({ achetee: 0, n_inconnues: 2 }, [null, null], { ...TIKTOK_DEP, pop_min_groupe_comportement: 'refus' })).toEqual({
      refus: null,
      avertissements: [{ code: 'pop_min_groupe', limite: 1000, valeur: 0, n: 2, non_verifiable: true, plateforme: 'tiktok' }],
    });
  });
  it('relecture I-2 : 500 connus + 1 unité inconnue — avertissement « non vérifiable », même en refus au registre', () => {
    for (const comportement of ['avertissement', 'refus'] as const) {
      expect(controlerPopulation({ achetee: 500, n_inconnues: 1 }, [500, null], { ...TIKTOK_DEP, pop_min_groupe_comportement: comportement }))
        .toEqual({ refus: null, avertissements: [{ code: 'pop_min_groupe', limite: 1000, valeur: 500, n: 1, non_verifiable: true, plateforme: 'tiktok' }] });
    }
  });
  it('relecture I-2 : la part connue atteint déjà le minimum — validé, malgré l’unité inconnue', () => {
    expect(controlerPopulation({ achetee: 1500, n_inconnues: 1 }, [1500, null], TIKTOK_DEP)).toEqual({ refus: null, avertissements: [] });
  });
});

describe('relecture B13, I-1 — cercle exact en territoire non carroyé : population inconnue, pas nulle', () => {
  it('populationDeForme : null dès qu’un territoire non carroyé est touché, la population sinon', () => {
    expect(populationDeForme({ population: 0, motif_vide: 'territoire_non_carroye', territoires_non_carroyes: [{ code: '976' }] })).toBeNull();
    expect(populationDeForme({ population: 800, motif_vide: null, territoires_non_carroyes: [{ code: '971' }] })).toBeNull();
    expect(populationDeForme({ population: 300, motif_vide: null, territoires_non_carroyes: [] })).toBe(300);
    expect(populationDeForme({ population: 300 })).toBe(300);
  });
  it('DV360 (refus) : le cercle à population inconnue n’est pas refusé, le minimum est dit non vérifiable', () => {
    expect(controlerPopulation({ achetee: 0, n_inconnues: 1 }, [null], DV360_CERCLE)).toEqual({
      refus: null,
      avertissements: [{ code: 'pop_min_unite', limite: 1000, valeur: 0, n: 1, non_verifiable: true, plateforme: 'dv360', a_verifier: true }],
    });
  });
});

describe('B13 — Meta : aucun minimum', () => {
  it('cinq habitants, ni refus ni avertissement', () => {
    expect(controlerPopulation(resumeExact(5, 3.14), [5], META_CERCLE)).toEqual({ refus: null, avertissements: [] });
    expect(minimumPopulation(META_CERCLE, 'unite')).toBeNull();
    expect(minimumPopulation(META_CERCLE, 'groupe')).toBeNull();
    expect(popMinPavage(META_CERCLE)).toBeUndefined();
  });
});

describe('B13 — le pavage lit le comportement', () => {
  it('`refus` : le minimum part en `p_pop_min` (filtre dur) ; `avertissement` : rien n’est filtré', () => {
    expect(popMinPavage(DV360_CERCLE)).toBe(1000);
    expect(popMinPavage({ ...DV360_CERCLE, pop_min_unite_comportement: 'avertissement' })).toBeUndefined();
  });
  it('un comportement absent (ligne d’avant sql/318) n’est jamais un refus', () => {
    expect(minimumPopulation({ ...DV360_CERCLE, pop_min_unite_comportement: undefined }, 'unite')?.comportement).toBe('avertissement');
  });
  it('règle 5 : les cercles écartés par le minimum sont dits, avant/après', () => {
    expect(avertissementsEcartes({ n_cercles: 3, population_max: 850 }, DV360_CERCLE)).toEqual([
      { code: 'pop_min_unite', limite: 1000, valeur: 850, n: 3, ecartes: true, plateforme: 'dv360', a_verifier: true },
    ]);
    expect(avertissementsEcartes({ n_cercles: 0, population_max: null }, DV360_CERCLE)).toEqual([]);
    expect(avertissementsEcartes(undefined, DV360_CERCLE)).toEqual([]);
  });
});

describe('B13 — le registre porte les comportements', () => {
  it('Zod lit les deux colonnes et refuse un comportement inconnu', () => {
    const brut = { ...DV360_CERCLE, codes_pays: null, pays_a_verifier: null, poids_groupe_cp: null };
    expect(PlateformeGeoSchema.parse(brut).pop_min_unite_comportement).toBe('refus');
    expect(PlateformeGeoSchema.safeParse({ ...brut, pop_min_unite_comportement: 'filtre' }).success).toBe(false);
  });
  it('aucun minimum ni comportement écrit dans le module', () => {
    const code = readFileSync('lib/zones/conversion-population.ts', 'utf8');
    expect(code).not.toMatch(/\b1[ _]?000\b/);
    expect(code).not.toMatch(/(dv360|tiktok|meta|ttd)/);
  });
});
