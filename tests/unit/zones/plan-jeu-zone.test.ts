/**
 * Le plan CP d'un jeu de zone (lot 5, T8) : `planCpDeZone`, la part pure de l'extraction. Ce qu'il doit tenir :
 * classe `zone` pour un CP retenu (poids 1), `hors` sinon ; le mode de plan du jeu ; un groupe de CP indiscernables est
 * UNE unité (A2) : une ligne de couverture, une part, un multiplicateur, développée en autant de codes que de membres
 * au MÊME multiplicateur ; populations sur le seul canonique.
 * L'extraction complète (quatre plateformes, RPC, idempotence) est prouvée contre la base :
 * `tests/integration/jeu-zone-extraction.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { planCpDeZone } from '@/lib/zones/plan-jeu-zone';
import type { LigneCouverture } from '@/lib/zones/couverture';

const cp = (code: string, pop_en_zone: number, pop_totale: number | null, part: number | null): LigneCouverture =>
  ({ code, nom: null, commune: null, n_carreaux: 1, pop_en_zone, pop_totale, part, part_brute: part });

const LIGNES = [cp('44000', 50_000, 100_000, 50), cp('44400', 1_000, 10_000, 10), cp('44500', 30, null, null)];
// Nantes : quatre codes postaux, une géométrie (cp_groupe) — le canonique compris.
const GROUPES = new Map([['44000', ['44000', '44100', '44200', '44300']]]);

describe('planCpDeZone', () => {
  it('pondéré : retenu au seuil → classe zone ; le groupe de Nantes en quatre lignes au MÊME multiplicateur', () => {
    const { lignes, resume } = planCpDeZone(LIGNES, 20, 'pondere', GROUPES);
    const nantes = lignes.filter((l) => l.code_canonique === '44000');
    expect(nantes.map((l) => l.code_postal)).toEqual(['44000', '44100', '44200', '44300']);
    const seul = planCpDeZone(LIGNES, 20, 'pondere', new Map()).lignes.find((l) => l.code_postal === '44000')!;
    for (const l of nantes) {
      expect(l.classe).toBe('zone');
      expect(l.retenu).toBe(true);
      // Attendu changé par A2 (était `seul.multiplicateur / 4`) : une unité, un multiplicateur, répété sur chaque membre ;
      // « même ou divisé » est un paramètre « à vérifier » du registre (`plateformes_geo.poids_groupe_cp`).
      expect(l.multiplicateur).toBe(seul.multiplicateur);
    }
    // Populations et part sur le canonique seul : un 0 se lirait « personne ».
    expect(nantes[0]).toMatchObject({ pop_en_zone: 50_000, pop_totale: 100_000, part_en_zone: 50 });
    expect(nantes.slice(1).every((l) => l.pop_en_zone === null && l.pop_totale === null && l.part_en_zone === null)).toBe(true);
    expect(lignes.find((l) => l.code_postal === '44400')).toMatchObject({ classe: 'hors', retenu: false });
    expect(lignes.find((l) => l.code_postal === '44400')!.multiplicateur).toBeGreaterThan(0);
    expect(resume).toEqual({ n_cp: 3, n_retenus: 1, taux_utile: 50, part_plan_en_zone: expect.any(Number), population_exposee: 50_000 });
  });

  it('exclusif : un CP non retenu reçoit zéro ; une part NULL n’est jamais retenue, même à seuil nul', () => {
    const { lignes } = planCpDeZone(LIGNES, 0, 'exclusif', new Map());
    expect(lignes.find((l) => l.code_postal === '44500')).toMatchObject({ retenu: false, multiplicateur: 0, classe: 'hors' });
    const strict = planCpDeZone(LIGNES, 20, 'exclusif', new Map()).lignes;
    expect(strict.find((l) => l.code_postal === '44400')!.multiplicateur).toBe(0);
    expect(strict.find((l) => l.code_postal === '44000')!.multiplicateur).toBeGreaterThan(0);
  });
});

describe('planCpDeZone — liste exacte (recette codes_postaux au CP)', () => {
  it('chaque code de la liste, ramené à son canonique, est retenu quel que soit le seuil ; hors liste : hors', () => {
    const lignes = [cp('44000', 50_000, 100_000, 50), cp('44400', 9_000, 10_000, 90), cp('44700', 40, 5_000, 0.8)];
    const { lignes: plan, resume } = planCpDeZone(lignes, 99, 'pondere', GROUPES, ['44200', '44700', '44800']);
    // 44200 → canonique 44000 : tout le groupe de Nantes est acheté ; 44700 retenu à 0,8 % (seuil ignoré).
    expect(plan.filter((l) => l.retenu).map((l) => l.code_postal).sort())
      .toEqual(['44000', '44100', '44200', '44300', '44700', '44800']);
    expect(plan.find((l) => l.code_postal === '44400')).toMatchObject({ retenu: false, classe: 'hors' });
    // 44800 n'a aucun carreau : au plan à population nulle plutôt qu'oublié.
    expect(plan.find((l) => l.code_postal === '44800')).toMatchObject({ retenu: true, pop_en_zone: 0, pop_totale: null });
    expect(resume.n_retenus).toBe(3);
  });
});

describe('planCpDeZone — le groupe de CP est l’unité (A2)', () => {
  // Saint-Denis : trois codes, un contour (sql/228). La couverture rend UNE ligne, qui nomme ses membres (sql/304).
  const SAINT_DENIS: LigneCouverture = { ...cp('93200', 138_577, 138_577, 100), membres: ['93200', '93210', '93380'] };
  const VOISIN = cp('93300', 2_000, 80_000, 2.5);
  const ZONE = [SAINT_DENIS, VOISIN];

  it('une zone couvrant un groupe de 3 codes : une ligne, une part ; le plan rend 3 codes au même multiplicateur', () => {
    // Aucune carte de groupes passée : la ligne de couverture suffit à dire l'unité.
    const { lignes, resume } = planCpDeZone(ZONE, 20, 'exclusif', new Map());
    const groupe = lignes.filter((l) => l.code_canonique === '93200');
    expect(groupe.map((l) => l.code_postal)).toEqual(['93200', '93210', '93380']);
    expect(new Set(groupe.map((l) => l.multiplicateur)).size).toBe(1);
    expect(groupe[0].multiplicateur).toBeGreaterThan(0);
    expect(groupe.every((l) => l.retenu && l.classe === 'zone')).toBe(true);
    // Les unités sont comptées une fois : 2 unités touchées, 1 retenue (le groupe).
    expect(resume).toMatchObject({ n_cp: 2, n_retenus: 1, population_exposee: 138_577 });
  });

  it('la population n’est portée qu’une fois : somme des lignes du plan = somme des lignes de couverture = population de la zone', () => {
    const population = ZONE.reduce((t, l) => t + l.pop_en_zone, 0);
    const { lignes } = planCpDeZone(ZONE, 0, 'pondere', new Map());
    expect(lignes.reduce((t, l) => t + (l.pop_en_zone ?? 0), 0)).toBe(population);
    expect(lignes.filter((l) => l.code_canonique === '93200' && l.code_postal !== '93200')
      .every((l) => l.pop_en_zone === null && l.pop_totale === null && l.part_en_zone === null)).toBe(true);
  });

  it('les membres déclarés par la ligne font foi ; une liste exacte qui nomme un membre achète toute l’unité', () => {
    const { lignes } = planCpDeZone(ZONE, 99, 'pondere', new Map(), ['93380']);
    expect(lignes.filter((l) => l.retenu).map((l) => l.code_postal)).toEqual(['93200', '93210', '93380']);
  });
});
