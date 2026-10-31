/**
 * Le plan CP d'un jeu de zone (lot 5, T8) : `planCpDeZone`, la part pure de l'extraction. Ce qu'il doit tenir :
 * classe `zone` pour un CP retenu (poids 1), `hors` sinon ; le mode de plan du jeu ; un groupe de CP indiscernables est
 * UNE unité (A2) : une ligne de couverture, une part, un multiplicateur, développée en autant de codes que de membres
 * au MÊME multiplicateur ; populations sur le seul canonique.
 * L'extraction complète (quatre plateformes, RPC, idempotence) est prouvée contre la base :
 * `tests/integration/jeu-zone-extraction.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { planCpDeZone, reglageDuPlan, sortiesPoids } from '@/lib/zones/plan-jeu-zone';
import type { LigneCouverture } from '@/lib/zones/couverture';
import type { PlateformePoids } from '@/lib/zones/plateformes';
import { CODE_HORS_ZONE, FACTEUR_HORS_ZONE_NATIONAL, NORMALISATION_PLAN } from '@/lib/zones/plan';

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
      // « même ou divisé » est un paramètre « à vérifier » du registre (`plateformes_poids.poids_groupe_cp` depuis A1).
      expect(l.multiplicateur).toBe(seul.multiplicateur);
    }
    // Populations et part sur le canonique seul : un 0 se lirait « personne ».
    expect(nantes[0]).toMatchObject({ pop_en_zone: 50_000, pop_totale: 100_000, part_en_zone: 50 });
    expect(nantes.slice(1).every((l) => l.pop_en_zone === null && l.pop_totale === null && l.part_en_zone === null)).toBe(true);
    expect(lignes.find((l) => l.code_postal === '44400')).toMatchObject({ classe: 'hors', retenu: false });
    // Attendu changé par A1 (était `> 0`) : ARB-1, seules les unités retenues entrent au plan, dans les deux modes — le
    // CP non retenu recevait la population totale × 1 en pondéré, c'était le défaut même du ticket.
    expect(lignes.find((l) => l.code_postal === '44400')!.multiplicateur).toBe(0);
    // Attendu changé par A1 : `n_codes` (codes envoyés) et le bilan de la séquence E4 s'ajoutent au résumé.
    expect(resume).toMatchObject({ n_cp: 3, n_retenus: 1, n_codes: 4, taux_utile: 50, part_plan_en_zone: 100, population_exposee: 50_000 });
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

// ── A1 : le plan par CP en multiplicateur d'enchère (ARB-1, ARB-2, séquence E4, registre des mécanismes E2, HORS_ZONE E3)

/** Une ligne de `plateformes_poids` (sql/305) ; les valeurs du seed DV360 par défaut. */
const poids = (p: Partial<PlateformePoids> & Pick<PlateformePoids, 'plateforme' | 'mecanisme'>): PlateformePoids => ({
  maille: 'cp', valeur_min: null, valeur_max: null, pas: null, nb_max_entrees: null, nb_paliers_max: null,
  poids_groupe_cp: 'meme', branche: false, parametres_a_verifier: [], note: null, releve_le: '2026-10-31', ...p,
});
const DV360_MULT = poids({
  plateforme: 'dv360', mecanisme: 'multiplicateur', valeur_min: 0.1, valeur_max: 10, parametres_a_verifier: ['valeur_min', 'valeur_max', 'poids_groupe_cp'],
});
const DV360_SCRIPT = poids({ plateforme: 'dv360', mecanisme: 'script', nb_max_entrees: 2000, parametres_a_verifier: ['nb_max_entrees'] });

const moyenne = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;

describe('A1 — le plan ne contient que les CP retenus, multiplicateur = part ÷ moyenne des parts (ARB-1)', () => {
  // Trois CP couverts à 90 %, 30 % et 12 %, de tailles différentes.
  const TROIS = [cp('75001', 9_000, 10_000, 90), cp('75002', 9_000, 30_000, 30), cp('75003', 6_000, 50_000, 12)];

  it.each(['exclusif', 'pondere'] as const)('%s, seuil 20 : 2 CP au plan, moyenne 1, le CP à 90 % pèse 3 fois celui à 30 %', (mode) => {
    const { lignes, resume } = planCpDeZone(TROIS, 20, mode, new Map());
    const auPlan = lignes.filter((l) => l.multiplicateur > 0);
    expect(auPlan.map((l) => l.code_postal)).toEqual(['75001', '75002']);
    expect(lignes.find((l) => l.code_postal === '75003')).toMatchObject({ retenu: false, multiplicateur: 0 });
    expect(moyenne(auPlan.map((l) => l.multiplicateur))).toBeCloseTo(1, 3);
    expect(auPlan[0].multiplicateur / auPlan[1].multiplicateur).toBeCloseTo(3, 6);
    expect(auPlan.map((l) => l.multiplicateur)).toEqual([1.5, 0.5]);
    expect(resume.multiplicateur).toMatchObject({
      normalisation: NORMALISATION_PLAN, moyenne_avant_ecretage: 1, moyenne_apres_ecretage: 1, n_ecretes: 0, ajustements: [],
    });
  });

  it('relever le seuil à 40 % change le plan : le CP à 30 % sort, celui à 90 % revient à 1', () => {
    const a20 = planCpDeZone(TROIS, 20, 'exclusif', new Map()).lignes;
    const a40 = planCpDeZone(TROIS, 40, 'exclusif', new Map()).lignes;
    expect(a40.filter((l) => l.multiplicateur > 0).map((l) => [l.code_postal, l.multiplicateur])).toEqual([['75001', 1]]);
    expect(a40).not.toEqual(a20);
  });

  it('la population n’entre pas dans la formule : même part, même multiplicateur, quelle que soit la taille', () => {
    const { lignes } = planCpDeZone([cp('01000', 50, 100, 50), cp('02000', 50_000, 100_000, 50), cp('03000', 900, 1_000, 90)], 0, 'exclusif', new Map());
    const m = (c: string) => lignes.find((l) => l.code_postal === c)!.multiplicateur;
    expect(m('01000')).toBe(m('02000'));
  });
});

describe('A1 — le registre des mécanismes de poids (E2)', () => {
  it('reglageDuPlan : la plage la plus étroite des mécanismes multiplicateur, et ses bornes « à vérifier » par paramètre', () => {
    const r = reglageDuPlan([DV360_MULT, DV360_SCRIPT, poids({ plateforme: 'ttd', mecanisme: 'budget_ligne' })], ['dv360', 'ttd']);
    expect(r).toEqual({ ok: true, reglage: { bornes: { min: 0.1, max: 10 }, poids_groupe_cp: 'meme', a_verifier: { min: true, max: true } } });
    // Sans aucun mécanisme multiplicateur : les bornes techniques de numeric(6,3).
    expect(reglageDuPlan([poids({ plateforme: 'meta', mecanisme: 'aucun' })], ['meta']))
      .toMatchObject({ ok: true, reglage: { bornes: { min: 0.001, max: 999.999 } } });
  });

  it('reglageDuPlan refuse en le disant : règle de groupe divergente, plateforme au CP sans mécanisme', () => {
    const divergent = reglageDuPlan([DV360_MULT, poids({ plateforme: 'ttd', mecanisme: 'budget_ligne', poids_groupe_cp: 'divise' })], ['dv360', 'ttd']);
    expect(divergent).toMatchObject({ ok: false, message: expect.stringContaining('divergente') });
    expect(reglageDuPlan([DV360_MULT], ['dv360', 'meta'])).toMatchObject({ ok: false, message: expect.stringContaining('meta') });
  });

  it('mécanisme multiplicateur, seuil 0, parts de 0,1 % à 100 % : écrêtage à 0,1 / 10, compteur, moyenne avant = 1 (E4)', () => {
    const lignes = [cp('10000', 10_000, 10_000, 100), ...Array.from({ length: 19 }, (_, i) => cp(String(10001 + i), 10, 10_000, 0.1))];
    const r = reglageDuPlan([DV360_MULT], ['dv360']);
    if (!r.ok) throw new Error(r.message);
    const { lignes: plan, resume } = planCpDeZone(lignes, 0, 'exclusif', new Map(), undefined, r.reglage);
    // Normalisé : 100 % → 19,627 (> 10), 0,1 % → 0,0196 (< 0,1) ; écrêté, sans renormalisation.
    expect(plan.find((l) => l.code_postal === '10000')!.multiplicateur).toBe(10);
    expect(plan.filter((l) => l.code_postal !== '10000').every((l) => l.multiplicateur === 0.1)).toBe(true);
    expect(resume.multiplicateur).toMatchObject({
      moyenne_avant_ecretage: 1, moyenne_apres_ecretage: 0.595, n_ecretes: 20,
      ajustements: [
        { code: 'multiplicateur_max', limite: 10, valeur: 19.627, n: 1 },
        { code: 'multiplicateur_min', limite: 0.1, valeur: 0.02, n: 19 },
      ],
    });
    // Dits chez la plateforme, « à vérifier » à côté de chaque borne.
    const { avertissements } = sortiesPoids([DV360_MULT], 'dv360', 20, resume.multiplicateur);
    expect(avertissements).toEqual([
      { code: 'multiplicateur_max', limite: 10, valeur: 19.627, n: 1, a_verifier: true },
      { code: 'multiplicateur_min', limite: 0.1, valeur: 0.02, n: 19, a_verifier: true },
    ]);
  });

  it('mécanisme script : un plan de 6 000 codes pour 2 000 entrées par envoi → 3 envois, annoncés', () => {
    const { sorties, avertissements } = sortiesPoids([DV360_MULT, DV360_SCRIPT], 'dv360', 6_000, { ajustements: [] });
    expect(sorties.map((s) => s.mecanisme)).toEqual(['multiplicateur', 'script']);
    expect(sorties[0]).toMatchObject({ valeur_min: 0.1, valeur_max: 10, n_codes: 6_000 });
    expect(sorties[1]).toMatchObject({ nb_max_entrees: 2000, n_envois: 3, n_codes: 6_000 });
    expect(avertissements).toEqual([{ code: 'nb_max_entrees', limite: 2000, valeur: 6_000, n: 3, mecanisme: 'script', a_verifier: true }]);
    // Sous la limite : un envoi, aucun avertissement.
    expect(sortiesPoids([DV360_SCRIPT], 'dv360', 1_999, { ajustements: [] }).avertissements).toEqual([]);
  });

  it('les entrées se comptent en CODES envoyés : un groupe de 3 codes compte 3 (relecture de A2)', () => {
    const SD: LigneCouverture = { ...cp('93200', 138_577, 138_577, 100), membres: ['93200', '93210', '93380'] };
    const { resume } = planCpDeZone([SD, cp('93300', 40_000, 80_000, 50)], 20, 'exclusif', new Map());
    expect(resume).toMatchObject({ n_retenus: 2, n_codes: 4 });
    expect(NORMALISATION_PLAN).toBe('non_ponderee');
    const { avertissements } = sortiesPoids(
      [poids({ plateforme: 'dv360', mecanisme: 'script', nb_max_entrees: 3 })], 'dv360', resume.n_codes, { ajustements: [] },
    );
    expect(avertissements).toMatchObject([{ code: 'nb_max_entrees', limite: 3, valeur: 4, n: 2 }]);
  });

  it('règle de groupe `divise` (registre) : chaque membre reçoit l’unité ÷ n, re-bornée et comptée en codes', () => {
    const SD: LigneCouverture = { ...cp('93200', 100, 100, 100), membres: ['93200', '93210', '93380'] };
    const { lignes, resume } = planCpDeZone([SD, cp('93300', 50, 100, 50)], 0, 'exclusif', new Map(), undefined,
      { bornes: { min: 0.5, max: 10 }, poids_groupe_cp: 'divise' });
    // Unité : 1,333 ; ÷ 3 = 0,444 < 0,5 → 0,5 pour chacun des trois codes.
    expect(lignes.filter((l) => l.code_canonique === '93200').map((l) => l.multiplicateur)).toEqual([0.5, 0.5, 0.5]);
    expect(resume.multiplicateur.poids_groupe_cp).toBe('divise');
    // Tour 1 (relecture I-1), attendu changé (était `n: 3`, en codes, avec `n_ecretes: 0`) : le bilan compte en UNITÉS CP.
    expect(resume.multiplicateur.ajustements).toEqual([{ code: 'multiplicateur_min', limite: 0.5, valeur: 0.444, n: 1 }]);
    expect(resume.multiplicateur).toMatchObject({ unite_de_compte: 'unite_cp', n_ecretes: 1, moyenne_avant_ecretage: 1 });
    // Poids effectif de l'unité écrêtée : 3 × 0,5 = 1,5 ; l'autre 0,667 → moyenne après ≈ 1,083.
    expect(resume.multiplicateur.moyenne_apres_ecretage).toBeCloseTo(1.083, 2);
    expect(resume.n_codes).toBe(4);
  });

  it('Tour 1 (I-1) — règle `meme` : un groupe de 3 codes écrêté compte UNE unité, partout dans le bilan', () => {
    const SD: LigneCouverture = { ...cp('93200', 100, 100, 100), membres: ['93200', '93210', '93380'] };
    const autres = Array.from({ length: 9 }, (_, i) => cp(String(93301 + i), 1, 100, 1));
    const { lignes, resume } = planCpDeZone([SD, ...autres], 0, 'exclusif', new Map(), undefined,
      { bornes: { min: 0.1, max: 5 }, poids_groupe_cp: 'meme' });
    // Normalisé : 1 ÷ 0,109 = 9,174 > 5 → les trois codes à 5 ; les neuf autres 0,092 → 0,1.
    expect(lignes.filter((l) => l.code_canonique === '93200').map((l) => l.multiplicateur)).toEqual([5, 5, 5]);
    const max = resume.multiplicateur.ajustements.find((a) => a.code === 'multiplicateur_max')!;
    const min = resume.multiplicateur.ajustements.find((a) => a.code === 'multiplicateur_min')!;
    expect([max.n, min.n]).toEqual([1, 9]);
    expect(resume.multiplicateur.n_ecretes).toBe(10);
    expect(resume.multiplicateur.moyenne_avant_ecretage).toBe(1);
    // Moyenne après sur les 10 UNITÉS (et non sur 12 codes) : (5 + 9 × 0,1) ÷ 10 = 0,59.
    expect(resume.multiplicateur.moyenne_apres_ecretage).toBe(0.59);
    expect(resume.n_codes).toBe(12);
  });
});

describe('Tour 1 (I-2) — l’écrêtage n’est dit que chez une plateforme dont un mécanisme multiplicateur porte la borne', () => {
  const PLAN = { ajustements: [
    { code: 'multiplicateur_max' as const, limite: 10, valeur: 14.2, n: 3 },
    { code: 'multiplicateur_min' as const, limite: 0.1, valeur: 0.02, n: 1 },
  ] };

  it('DV360 (multiplicateur 0,1-10) : les deux écrêtages, avec la borne de SON mécanisme, « à vérifier »', () => {
    expect(sortiesPoids([DV360_MULT, DV360_SCRIPT], 'dv360', 10, PLAN).avertissements).toEqual([
      { code: 'multiplicateur_max', limite: 10, valeur: 14.2, n: 3, a_verifier: true },
      { code: 'multiplicateur_min', limite: 0.1, valeur: 0.02, n: 1, a_verifier: true },
    ]);
  });

  it('TTD (budget_ligne), Meta et TikTok (aucun) : aucun multiplicateur reçu, rien sur un écrêtage', () => {
    const registre = [DV360_MULT, poids({ plateforme: 'ttd', mecanisme: 'budget_ligne' }),
      poids({ plateforme: 'meta', mecanisme: 'aucun' }), poids({ plateforme: 'tiktok', mecanisme: 'aucun' })];
    for (const p of ['ttd', 'meta', 'tiktok']) expect(sortiesPoids(registre, p, 10, PLAN).avertissements).toEqual([]);
  });

  it('un multiplicateur dont la borne n’est pas celle franchie ne s’en attribue pas l’écrêtage', () => {
    const large = poids({ plateforme: 'ttd', mecanisme: 'multiplicateur', valeur_min: 0.01, valeur_max: 20 });
    expect(sortiesPoids([large], 'ttd', 10, PLAN).avertissements).toEqual([]);
  });
});

describe('A1 — la ligne HORS_ZONE (E3) et le mode figé', () => {
  const DEUX = [cp('75001', 9_000, 10_000, 90), cp('75002', 9_000, 30_000, 30), cp('75003', 600, 50_000, 1.2)];

  it('exclusif → mode strict : HORS_ZONE à 0, hors des CP réels du plan', () => {
    const { lignes, resume } = planCpDeZone(DEUX, 20, 'exclusif', new Map());
    // Attendu changé par A8 (était `{ code, mode, multiplicateur }`) : la ligne porte sa part prévue E5 — part 1, classe 0
    // en strict, volume inconnu sans référentiel (tests) ; classe 0 → part prévue 0 quel que soit le volume.
    expect(resume.multiplicateur.hors_zone).toEqual({
      code: 'HORS_ZONE', mode: 'strict', multiplicateur: 0, part: 1, classe: 0, volume: null, part_prevue: 0,
    });
    expect(lignes.some((l) => l.code_postal === 'HORS_ZONE')).toBe(false);
  });

  it('pondéré → mode national : HORS_ZONE au plancher 0,8 × le plus petit multiplicateur du plan, sous tout CP du plan (INV9)', () => {
    const { lignes, resume } = planCpDeZone(DEUX, 20, 'pondere', new Map());
    // Attendu changé par A8 : + part 1, classe = 0,8 × le plus petit brut retenu (0,8 × 0,3 = 0,24, avant normalisation et
    // écrêtage) ; volume du référentiel non fourni → part prévue `null` (on ne l'invente pas).
    expect(resume.multiplicateur.hors_zone).toMatchObject({
      code: CODE_HORS_ZONE, mode: 'national', multiplicateur: 0.4, part: 1, volume: null, part_prevue: null,
    });
    expect(resume.multiplicateur.hors_zone.classe).toBeCloseTo(0.24, 12);
    // 0,4 = le facteur de méthode (rebid-v2 D7) × le plus petit multiplicateur du plan (0,5).
    expect(FACTEUR_HORS_ZONE_NATIONAL * 0.5).toBeCloseTo(0.4, 9);
    expect(lignes.filter((l) => l.multiplicateur > 0).every((l) => l.multiplicateur > 0.4)).toBe(true);
  });
});
