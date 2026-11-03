/**
 * `extraireJeuZone` (lot 5, T8, relecture round 1) contre une base simulée (`_doublures-route.ts`) : les mailles
 * EXACTES figées sans calcul (ruling du contrôleur), et les chemins d'échec — aucune unité retenue, règle disparue de
 * `plateformes_geo`, refus d'une RPC préfixé de la plateforme, groupes de CP illisibles — et la zone PAYS (⑤ finitions,
 * T2) : ses unités figées depuis `codes_pays`, une maille sans objet refusée, plus de 422 `zone_pays`. Le chemin complet
 * contre la vraie base : `tests/integration/jeu-zone-extraction.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdminClient, etat, reinitialiser, ORG } from '../api/_doublures-route';
import { extraireJeuZone } from '@/lib/zones/extraction-jeu-zone';
import type { Tables } from '@/types/database.types';

const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3304';
const JEU = {
  id: '3f2504e0-4f89-11d3-9a0c-0305e82c3302', org_id: ORG, custom_geo_zone_id: ZONE, cible: 'ind', mode_plan: 'pondere', type: 'zone',
} as Tables<'zone_sets'>;

const regle = (plateforme: string, maille: string, limites: Record<string, number> = {}) => ({
  plateforme, maille, libelle: maille, natif: true, disponible: true, limites, doc_url: null, releve_le: '2026-10-14',
  a_verifier: false, note: null, ordre: 1,
});
// A1 : `membres` ajouté aux lignes (contrat CP de sql/304) — le bilan en tire `n_codes`, que comptent les limites.
const COUVERTURE = {
  population: 10_000, surface_km2: 78.5,
  lignes: [
    { code: '69001', nom: 'Lyon 1', commune: null, n_carreaux: 5, pop_en_zone: 6_000, pop_totale: 6_500, part: 92.3, part_brute: 92.3, membres: ['69001'] },
    { code: '69002', nom: 'Lyon 2', commune: null, n_carreaux: 5, pop_en_zone: 3_000, pop_totale: 10_000, part: 30, part_brute: 30, membres: ['69002'] },
    { code: '69003', nom: 'Lyon 3', commune: null, n_carreaux: 1, pop_en_zone: 1_000, pop_totale: 50_000, part: 2, part_brute: 2, membres: ['69003'] },
  ],
};

/** Les mécanismes de poids au CP (`plateformes_poids`, sql/305, A1) : le seed du 31/10. */
const poids = (plateforme: string, mecanisme: string, p: Record<string, unknown> = {}) => ({
  plateforme, maille: 'cp', mecanisme, valeur_min: null, valeur_max: null, pas: null, nb_max_entrees: null, nb_paliers_max: null,
  poids_groupe_cp: 'meme', branche: false, parametres_a_verifier: [], note: null, releve_le: '2026-10-31', ...p,
});
const POIDS_SEED = [
  poids('dv360', 'multiplicateur', { valeur_min: 0.1, valeur_max: 10, parametres_a_verifier: ['valeur_min', 'valeur_max', 'poids_groupe_cp'] }),
  poids('dv360', 'script', { nb_max_entrees: 2000, parametres_a_verifier: ['nb_max_entrees', 'poids_groupe_cp'] }),
  poids('ttd', 'budget_ligne'), poids('meta', 'aucun'), poids('tiktok', 'aucun'),
];

/** B15 round 1 (I-2, sql/321) : `unites` est la COLONNE `custom_geo_zones.unites_constitutives`, hors du JSON recette. */
function jeuAvec(choix: object[], recette: object, regles: object[], unites: object | null = null) {
  etat.tables.plateformes_poids = { data: POIDS_SEED, error: null };
  etat.tables.zone_set_plateformes = { data: choix, error: null };
  etat.tables.custom_geo_zones = { data: { recette, unites_constitutives: unites }, error: null };
  etat.tables.plateformes_geo = { data: regles, error: null };
  etat.tables.cp_groupe = { data: [], error: null };
  etat.reponses.couverture_zone = { data: COUVERTURE, error: null };
  etat.reponses.creer_extraction_jeu_zone = { data: { ok: true, deja_extraite: false, id: 'x', version: 1 }, error: null };
  // A8 : les volumes attendus (population totale) des unités et du référentiel, lus pour la part prévue E5 ; D35 : le
  // référentiel restreint à l'univers de la zone (`volumes_attendus_cp_univers`, sql/337).
  etat.reponses.volumes_attendus_cp_univers = { data: VOLUMES, error: null };
}
/** Volumes = populations totales de la couverture ; référentiel de 1 000 000 habitants. */
const VOLUMES = { volume: 'population_totale', univers: 'METRO', total: 1_000_000, codes: { 69001: 6_500, 69002: 10_000, 69003: 50_000 } };
const extraire = () => extraireJeuZone(createAdminClient() as never, JEU, { origine: 'initiale', commentaire: '' }, 'u1');
const argsCreation = () => etat.rpcs.find((r) => r.nom === 'creer_extraction_jeu_zone')!.args as {
  p_cp: { code_postal: string; retenu: boolean }[];
  p_unites: Record<string, unknown>[];
  p_resume: { plateformes: Record<string, unknown>[] };
};

// `part_retenue` : posée par la base (sql/307) ; 1 = disque entier en France, seul cas où le cercle est exact (A3).
const POINT = { v: 1, type: 'rayon_point', lon: 4.8357, lat: 45.764, rayon_m: 5000, part_retenue: 1 };
const STRASBOURG = { v: 1, type: 'rayon_point', lon: 7.7521, lat: 48.5734, rayon_m: 20_000, part_retenue: 0.6586 };
const LISTE = { v: 1, type: 'codes_postaux', codes: ['69001', '69002', '69002'] };
// B15 : la colonne telle que la base la dérive (sql/321 : unités posées depuis `codes`, aucun groupe partiel).
const UNITES_LISTE = { maille: 'cp', codes: ['69001', '69002', '69002'], groupes_partiels: 0 };
const DESSIN = { v: 1, type: 'dessin' };

beforeEach(() => {
  reinitialiser();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('C24 round 1 (I-1) — DV360, cible 18-24 ans : le minimum par cercle se compare à la population TOTALE', () => {
  const DV360 = { ...regle('dv360', 'cercle', { rayon_min_m: 1000, pop_min_unite: 1000 }), pop_min_unite_comportement: 'refus' };
  const extraireCible = () => extraireJeuZone(createAdminClient() as never, { ...JEU, cible: 'ind_18_24' } as Tables<'zone_sets'>,
    { origine: 'initiale', commentaire: '' }, 'u1');

  it('cercle exact de 3 000 habitants (300 jeunes) : acheté, aucun refus ; la diffusion totale figée', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cercle', seuil: 30, rayon_m: 1000 }], { ...POINT, rayon_m: 1000 }, [DV360]);
    etat.reponses.couverture_zone = { data: { population: 300, population_ind: 3000, surface_km2: 3.14, lignes: [] }, error: null };
    const r = await extraireCible();
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
    expect(argsCreation().p_resume.plateformes[0]).toMatchObject({ achetee: 300, diffusion_population_totale: 3000, avertissements: [] });
  });

  it('cercles pavés : un disque de 3 000 habitants (300 jeunes) passe le contrôle par unité', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cercle', seuil: 30, rayon_m: 2000 }], POINT, [DV360]);
    etat.reponses.paver_cercles = {
      data: {
        n_candidates: 3, n_cercles: 1, population: 1_000, couverte: 300, manques: 700, hors_zone: 0, achetee: 300, taux_utile: 100,
        cercles: [{ lon: 4.8, lat: 45.7, pop_en_zone: 300, pop_totale: 300, pop_totale_ind: 3000, part: 100 }],
        ecartes_pop_min: { n_cercles: 0, population_max: null },
      }, error: null,
    };
    const r = await extraireCible();
    expect(r.status).toBe(201);
    expect(argsCreation().p_resume.plateformes[0].avertissements).toEqual([]);
  });
});

describe('C29 — catégorie d’annonces spéciale : le jeu coché relève le rayon minimal de Meta', () => {
  const META = regle('meta', 'cercle', { rayon_min_m: 1000, rayon_max_m: 80000, rayon_min_categorie_speciale: 15000 });
  const extraireCs = (cs: boolean) => extraireJeuZone(createAdminClient() as never, { ...JEU, categorie_speciale: cs } as Tables<'zone_sets'>,
    { origine: 'initiale', commentaire: '' }, 'u1');

  it('case cochée, cercles choisis à 5 km : 422, valeurs avant et après dites, rien de figé', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 5000 }], POINT, [META]);
    const r = await extraireCs(true);
    expect(r.status).toBe(422);
    expect(((await r.json()).error as string).replace(/ /g, ' '))
      .toBe('Rayon de 5 000 m hors des bornes de meta (15 000 à 80 000 m, catégorie d’annonces spéciale). Réglez à nouveau le jeu avant d’extraire.');
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });

  it('case décochée : le même jeu s’extrait (cercle exact de la recette, 5 km)', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 5000 }], POINT, [META]);
    expect((await extraireCs(false)).status).toBe(201);
  });
});

describe('mailles exactes : la géométrie de la recette, sans calcul ni seuil', () => {
  it('rayon_point en cercle au MÊME rayon : UN cercle (centre et rayon de la recette), aucun pavage, zéro perte', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 5000 }], POINT,
      [regle('meta', 'cercle', { rayon_min_m: 1000, rayon_max_m: 80000 })]);
    expect((await extraire()).status).toBe(201);
    expect(etat.rpcs.map((r) => r.nom)).not.toContain('paver_cercles');
    expect(argsCreation().p_unites).toEqual([{
      plateforme: 'meta', maille: 'cercle', lon: 4.8357, lat: 45.764, rayon_m: 5000,
      pop_en_zone: 10_000, pop_totale: 10_000, part: 100, retenu: true,
    }]);
    expect(argsCreation().p_resume.plateformes[0]).toMatchObject({
      exacte: true, n_unites: 1, population: 10_000, couverte: 10_000, achetee: 10_000, manques: 0, hors_zone: 0, taux_utile: 100,
    });
  });

  it('B13 : cercle exact de 1 km à 300 habitants sur DV360 — le refus du registre, message explicite, rien de figé', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cercle', seuil: 30, rayon_m: 1000 }], { ...POINT, rayon_m: 1000 }, [{
      ...regle('dv360', 'cercle', { rayon_min_m: 1000, pop_min_unite: 1000 }),
      pop_min_unite_comportement: 'refus', parametres_a_verifier: ['pop_min_unite_comportement'],
    }]);
    etat.reponses.couverture_zone = { data: { population: 300, surface_km2: 3.14, lignes: [] }, error: null };
    const r = await extraire();
    expect(r.status).toBe(422);
    const corps = await r.json() as { error: string; refus: string; plateforme: string; limite: number; valeur: number };
    expect(corps).toMatchObject({ refus: 'pop_min_unite', plateforme: 'dv360', limite: 1000, valeur: 300 });
    // `formaterNombre` sépare les milliers par une espace fine insécable (U+202F).
    expect(corps.error).toBe('dv360 — Le cercle compte 300 habitants, sous le minimum de 1 000 (à vérifier) par cercle de la '
      + 'plateforme : élargissez le rayon, ou choisissez une autre maille.');
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });

  it('B13 (relecture I-1) : cercle exact non carroyé (Mayotte) sur DV360 — acheté, population inconnue, minimum non vérifiable', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cercle', seuil: 30, rayon_m: 1000 }], { ...POINT, lon: 45.1662, lat: -12.7806, rayon_m: 1000 }, [{
      ...regle('dv360', 'cercle', { rayon_min_m: 1000, pop_min_unite: 1000 }), pop_min_unite_comportement: 'refus',
    }]);
    etat.reponses.couverture_zone = {
      data: { population: 0, surface_km2: 3.14, lignes: [], motif_vide: 'territoire_non_carroye', territoires_non_carroyes: [{ code: '976', nom: 'Mayotte' }] },
      error: null,
    };
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_unites[0]).toMatchObject({ maille: 'cercle', pop_en_zone: null, pop_totale: null, part: null });
    const resume = argsCreation().p_resume.plateformes[0];
    expect(resume).toMatchObject({ exacte: true, n_inconnues: 1 });
    expect(resume.avertissements).toEqual([{ code: 'pop_min_unite', limite: 1000, valeur: 0, n: 1, non_verifiable: true, plateforme: 'dv360' }]);
  });

  it('B13 : TikTok au département, groupe de 800 personnes — avertissement figé (registre), extraction faite', async () => {
    jeuAvec([{ plateforme: 'tiktok', maille: 'departement', seuil: 20, rayon_m: null }], DESSIN, [{
      ...regle('tiktok', 'departement', { max_unites: 3000, pop_min_groupe: 1000 }), pop_min_groupe_comportement: 'avertissement',
    }]);
    etat.reponses.couverture_zone = {
      data: { population: 500, surface_km2: 3, lignes: [{ code: '01', nom: 'Ain', commune: null, n_carreaux: 2, pop_en_zone: 500, pop_totale: 800, part: 62.5, part_brute: 62.5 }] },
      error: null,
    };
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_resume.plateformes[0].avertissements).toEqual([{ code: 'pop_min_groupe', limite: 1000, valeur: 800, plateforme: 'tiktok' }]);
  });

  it('B13 : Meta en cercle exact à 5 habitants — aucun minimum, aucun avertissement', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 1000 }], { ...POINT, rayon_m: 1000 },
      [regle('meta', 'cercle', { rayon_min_m: 1000, rayon_max_m: 80000 })]);
    etat.reponses.couverture_zone = { data: { population: 5, surface_km2: 3.14, lignes: [] }, error: null };
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_resume.plateformes[0].avertissements).toEqual([]);
  });

  it('B13 : DV360 pavé — les cercles écartés par le minimum sont dits (règle 5), p_pop_min lu du comportement', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cercle', seuil: 30, rayon_m: 2000 }], POINT, [{
      ...regle('dv360', 'cercle', { rayon_min_m: 1000, pop_min_unite: 1000 }), pop_min_unite_comportement: 'refus',
    }]);
    etat.reponses.paver_cercles = {
      data: {
        n_candidates: 12, n_cercles: 1, population: 10_000, couverte: 4_000, manques: 6_000, hors_zone: 500, achetee: 4_500,
        taux_utile: 88.9, cercles: [{ lon: 4.8, lat: 45.7, pop_en_zone: 4_000, pop_totale: 4_500, part: 88.9 }],
        ecartes_pop_min: { n_cercles: 2, population_max: 900 },
      },
      error: null,
    };
    expect((await extraire()).status).toBe(201);
    expect(etat.rpcs.find((x) => x.nom === 'paver_cercles')!.args).toMatchObject({ p_pop_min: 1000 });
    expect(argsCreation().p_resume.plateformes[0].avertissements).toEqual([
      { code: 'pop_min_unite', limite: 1000, valeur: 900, n: 2, ecartes: true, plateforme: 'dv360' },
    ]);
  });

  it('rayon_point en cercle à un AUTRE rayon : pavage, exacte false, n_candidates (et non n_touchees)', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 2000 }], POINT, [regle('meta', 'cercle', { rayon_min_m: 1000 })]);
    etat.reponses.paver_cercles = {
      data: {
        n_candidates: 12, n_cercles: 1, population: 10_000, couverte: 4_000, manques: 6_000, hors_zone: 500, achetee: 4_500,
        taux_utile: 88.9, cercles: [{ lon: 4.8, lat: 45.7, pop_en_zone: 4_000, pop_totale: 4_500, part: 88.9 }],
      },
      error: null,
    };
    expect((await extraire()).status).toBe(201);
    const resume = argsCreation().p_resume.plateformes[0];
    expect(resume).toMatchObject({ exacte: false, n_unites: 1, n_candidates: 12, manques: 6_000 });
    expect(resume).not.toHaveProperty('n_touchees');
  });

  it('A6 : cercles — chaque unité porte la population de son DISQUE, la somme des disques est figée à côté du bilan', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 0, rayon_m: 2000 }], POINT, [regle('meta', 'cercle', { rayon_min_m: 1000 })]);
    // Deux disques qui se chevauchent : 7 000 + 6 000 = 13 000 habitants sur les lignes, 11 000 dans l'union achetée.
    etat.reponses.paver_cercles = {
      data: {
        n_candidates: 2, n_cercles: 2, population: 10_000, couverte: 9_000, manques: 1_000, hors_zone: 2_000, achetee: 11_000,
        taux_utile: 81.8, somme_disques: 13_000, chevauchement: 2_000,
        cercles: [{ lon: 4.8, lat: 45.7, pop_en_zone: 6_000, pop_totale: 7_000, part: 85.7 },
                  { lon: 4.82, lat: 45.7, pop_en_zone: 5_000, pop_totale: 6_000, part: 83.3 }],
      },
      error: null,
    };
    expect((await extraire()).status).toBe(201);
    const { p_unites, p_resume } = argsCreation();
    expect(p_unites.map((u) => u.pop_totale)).toEqual([7_000, 6_000]);
    const r = p_resume.plateformes[0] as { couverte: number; hors_zone: number; achetee: number };
    expect(r).toMatchObject({ achetee: 11_000, hors_zone: 2_000, couverte: 9_000, somme_disques: 13_000 });
    expect(r.couverte + r.hors_zone).toBe(r.achetee);
  });

  it('A3 : disque partiellement hors de France (Strasbourg 20 km) au MÊME rayon : pavage, perte calculée, avertissement figé', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 20_000 }], STRASBOURG,
      [regle('meta', 'cercle', { rayon_min_m: 1000, rayon_max_m: 80000 })]);
    etat.reponses.paver_cercles = {
      data: {
        n_candidates: 4, n_cercles: 3, population: 568_007, couverte: 549_968, manques: 18_040, hors_zone: 203_272, achetee: 753_240,
        taux_utile: 73, cercles: [{ lon: 7.75, lat: 48.57, pop_en_zone: 400_000, pop_totale: 500_000, part: 80 }],
      },
      error: null,
    };
    expect((await extraire()).status).toBe(201);
    expect(etat.rpcs.map((r) => r.nom)).toContain('paver_cercles');
    const resume = argsCreation().p_resume.plateformes[0];
    expect(resume).toMatchObject({ exacte: false, n_unites: 3, manques: 18_040, hors_zone: 203_272 });
    expect(resume.avertissements).toEqual([{ code: 'disque_hors_france', limite: 100, valeur: 65.9 }]);
  });

  it('codes_postaux au CP : la liste de la recette (dédoublonnée), seuil ignoré ; plan CP sur la liste', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 95, rayon_m: null }], LISTE, [regle('dv360', 'cp')], UNITES_LISTE);
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_unites).toEqual([
      { plateforme: 'dv360', maille: 'cp', code: '69001', retenu: true },
      { plateforme: 'dv360', maille: 'cp', code: '69002', retenu: true },
    ]);
    expect(argsCreation().p_cp.filter((l) => l.retenu).map((l) => l.code_postal)).toEqual(['69001', '69002']);
    // Attendu complété par A1 : les codes de la liste et ce que la plateforme reçoit par mécanisme de poids.
    expect(argsCreation().p_resume.plateformes[0]).toMatchObject({ exacte: true, n_unites: 2, n_codes: 2, manques: 0 });
    expect(argsCreation().p_resume.plateformes[0].poids).toEqual([
      { mecanisme: 'multiplicateur', branche: false, poids_groupe_cp: 'meme', parametres_a_verifier: ['valeur_min', 'valeur_max', 'poids_groupe_cp'], n_codes: 2, valeur_min: 0.1, valeur_max: 10 },
      { mecanisme: 'script', branche: false, poids_groupe_cp: 'meme', parametres_a_verifier: ['nb_max_entrees', 'poids_groupe_cp'], n_codes: 2, nb_max_entrees: 2000, n_envois: 1 },
    ]);
  });

  it('A1 : CP calculé — seuls les CP retenus au plan, moyenne 1, bilan E4 et ligne HORS_ZONE figés dans le résumé', async () => {
    // Parts 92,3 / 30 / 2 %, seuil 20 % : deux CP au plan ; 92,3 ÷ 61,15 = 1,509, 30 ÷ 61,15 = 0,491 ; 69003 à 0.
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], DESSIN, [regle('dv360', 'cp')]);
    expect((await extraire()).status).toBe(201);
    const mult = Object.fromEntries((argsCreation().p_cp as unknown as { code_postal: string; multiplicateur: number }[])
      .map((l) => [l.code_postal, l.multiplicateur]));
    expect(mult).toEqual({ 69001: 1.509, 69002: 0.491, 69003: 0 });
    const resume = argsCreation().p_resume as unknown as Record<string, unknown>;
    expect(resume).toMatchObject({
      n_cp: 3, n_retenus: 2, n_codes: 2, part_plan_en_zone: 100,
      multiplicateur: {
        normalisation: 'non_ponderee', bornes: { min: 0.1, max: 10 }, moyenne_avant_ecretage: 1, moyenne_apres_ecretage: 1,
        n_ecretes: 0, ajustements: [], poids_groupe_cp: 'meme',
        // Le jeu est pondéré → mode national : plancher 0,8 × 0,491.
        hors_zone: { code: 'HORS_ZONE', mode: 'national', multiplicateur: 0.393 },
      },
    });
    expect(argsCreation().p_resume.plateformes[0]).toMatchObject({ n_unites: 2, n_codes: 2, avertissements: [] });
  });

  it('A8 : part prévue E5 par code et ligne HORS_ZONE (volume = référentiel − retenus) envoyées à la RPC', async () => {
    // Pondéré → national. Poids : 69001 = 6 000, 69002 = 3 000 ; HORS_ZONE = 0,8 × 0,3 × (1 000 000 − 16 500).
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], DESSIN, [regle('dv360', 'cp')]);
    expect((await extraire()).status).toBe(201);
    // D35 : Lyon ne touche aucun DROM → le volume HORS_ZONE est lu sur la métropole.
    expect(etat.rpcs.find((r) => r.nom === 'volumes_attendus_cp_univers')!.args).toEqual({ p_codes: ['69001', '69002', '69003'], p_univers: 'METRO' });
    const hz = 0.24 * 983_500;
    const somme = 6_000 + 3_000 + hz;
    const p = Object.fromEntries((argsCreation().p_cp as unknown as { code_postal: string; part_prevue: number | null }[])
      .map((l) => [l.code_postal, l.part_prevue]));
    expect(p['69001']).toBeCloseTo(6_000 / somme, 12);
    expect(p['69002']).toBeCloseTo(3_000 / somme, 12);
    expect(p['69003']).toBeNull();
    const resume = argsCreation().p_resume as unknown as { multiplicateur: { hors_zone: Record<string, number> }; part_prevue: Record<string, unknown> };
    expect(resume.multiplicateur.hors_zone).toMatchObject({ mode: 'national', part: 1, volume: 983_500, univers: 'METRO' });
    expect(resume.multiplicateur.hors_zone.part_prevue).toBeCloseTo(hz / somme, 12);
    expect(resume.part_prevue).toMatchObject({ volume_attendu: 'population_totale', unite_de_somme: 'unite_cp', unites_sans_part: 0 });
  });

  it('A8 : volumes attendus illisibles → 500 neutre, rien n’est figé', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], DESSIN, [regle('dv360', 'cp')]);
    etat.reponses.volumes_attendus_cp_univers = { data: null, error: { message: 'panne' } };
    expect((await extraire()).status).toBe(500);
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });

  it('Tour 1 (I-2) : DV360 + TTD au CP, plan écrêté au minimum de DV360 — dit chez DV360 seulement', async () => {
    // Seuil 0 : 69003 (2 %) normalisé à 0,048 < 0,1, ramené à 0,1.
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 0, rayon_m: null }, { plateforme: 'ttd', maille: 'cp', seuil: 0, rayon_m: null }],
      DESSIN, [regle('dv360', 'cp'), regle('ttd', 'cp')]);
    expect((await extraire()).status).toBe(201);
    const [dv360, ttd] = ['dv360', 'ttd'].map((p) => argsCreation().p_resume.plateformes.find((r) => r.plateforme === p)!);
    expect(dv360.avertissements).toEqual([{ code: 'multiplicateur_min', limite: 0.1, valeur: 0.048, n: 1, a_verifier: true }]);
    expect(ttd.avertissements).toEqual([]);
  });

  it('B12 : DV360 à 20 %, TTD à 10 % → deux plans figés ; celui de DV360 ne contient que les CP retenus à 20 %', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }, { plateforme: 'ttd', maille: 'cp', seuil: 10, rayon_m: null }],
      DESSIN, [regle('dv360', 'cp'), regle('ttd', 'cp')]);
    // 69003 à 15 % : retenu à 10 % (TTD), pas à 20 % (DV360).
    etat.reponses.couverture_zone = {
      data: { ...COUVERTURE, lignes: COUVERTURE.lignes.map((l) => (l.code === '69003' ? { ...l, pop_en_zone: 7_500, part: 15, part_brute: 15 } : l)) },
      error: null,
    };
    expect((await extraire()).status).toBe(201);
    const { p_cp, p_resume } = argsCreation() as unknown as {
      p_cp: { code_postal: string; retenu: boolean }[];
      p_resume: {
        plans_plateformes: { plateforme: string; seuil: number; lignes: { code_postal: string; retenu: boolean; multiplicateur: number }[] }[];
        plateformes: { plateforme: string; plan_cp?: Record<string, unknown> }[];
      };
    };
    const plans = Object.fromEntries(p_resume.plans_plateformes.map((p) => [p.plateforme, p]));
    expect(Object.keys(plans)).toEqual(['dv360', 'ttd']);
    expect(plans.dv360.seuil).toBe(20);
    expect(plans.dv360.lignes.map((l) => l.code_postal)).toEqual(['69001', '69002']);
    expect(plans.dv360.lignes.every((l) => l.retenu && l.multiplicateur > 0)).toBe(true);
    expect(plans.ttd.lignes.map((l) => l.code_postal)).toEqual(['69001', '69002', '69003']);
    // Le plan commun (rétrocompatibilité ⑥/⑦) reste celui du seuil le plus bas.
    expect(p_cp.filter((l) => l.retenu).map((l) => l.code_postal)).toEqual(['69001', '69002', '69003']);
    // Le bilan de CHAQUE plan est figé avec sa plateforme.
    const resumeDe = (p: string) => p_resume.plateformes.find((r) => r.plateforme === p)!.plan_cp;
    expect(resumeDe('dv360')).toMatchObject({ seuil: 20, n_retenus: 2, n_codes: 2 });
    expect(resumeDe('ttd')).toMatchObject({ seuil: 10, n_retenus: 3, n_codes: 3 });
  });

  it('B12 tour 1 (I-1) : DV360 20 % / TTD 10 % — l’écrêtage du plan COMMUN (celui que ⑥/⑦ poussent) reste dit chez DV360', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }, { plateforme: 'ttd', maille: 'cp', seuil: 10, rayon_m: null }],
      DESSIN, [regle('dv360', 'cp'), regle('ttd', 'cp')]);
    // Règle `divise` chez les deux (elle doit concorder) ; 69003 à 10,5 %, groupe de 3 codes : retenu à 10 % seulement.
    etat.tables.plateformes_poids = {
      data: [{ ...POIDS_SEED[0], poids_groupe_cp: 'divise' }, poids('ttd', 'budget_ligne', { poids_groupe_cp: 'divise' })], error: null,
    };
    etat.reponses.couverture_zone = {
      data: { ...COUVERTURE, lignes: COUVERTURE.lignes.map((l) => (l.code === '69003'
        ? { ...l, pop_en_zone: 5_250, part: 10.5, part_brute: 10.5, membres: ['69003', '69004', '69005'] } : l)) },
      error: null,
    };
    expect((await extraire()).status).toBe(201);
    const plateformes = argsCreation().p_resume.plateformes as {
      plateforme: string; avertissements: unknown[]; plan_cp: { avertissements: unknown[]; poids: unknown[] };
    }[];
    const dv360 = plateformes.find((r) => r.plateforme === 'dv360')!;
    // Commun : moyenne des parts 92,3 / 30 / 10,5 = 44,27 ; 10,5 ÷ 44,27 ÷ 3 = 0,079 < 0,1 → écrêté, et c'est ce plan qui part.
    expect(dv360.avertissements).toEqual([{ code: 'multiplicateur_min', limite: 0.1, valeur: 0.079, n: 1, a_verifier: true }]);
    // Son plan propre (92,3 et 30 seulement) n'écrête rien : dit à part, dans `plan_cp`.
    expect(dv360.plan_cp.avertissements).toEqual([]);
    expect(dv360.plan_cp.poids).toMatchObject([{ mecanisme: 'multiplicateur', n_codes: 2 }]);
  });

  it('A1 : une règle de groupe divergente entre plateformes au CP refuse l’extraction en le disant (422)', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }, { plateforme: 'ttd', maille: 'cp', seuil: 20, rayon_m: null }],
      DESSIN, [regle('dv360', 'cp'), regle('ttd', 'cp')]);
    etat.tables.plateformes_poids = { data: [POIDS_SEED[0], poids('ttd', 'budget_ligne', { poids_groupe_cp: 'divise' })], error: null };
    const r = await extraire();
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/divergente.*dv360 \(multiplicateur\) : le même multiplicateur ; ttd \(budget_ligne\) : le multiplicateur divisé/);
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });

  it('A1 : registre des mécanismes illisible : 500 neutre, rien d’écrit', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], DESSIN, [regle('dv360', 'cp')]);
    etat.tables.plateformes_poids = { data: null, error: { message: 'secret' } };
    const r = await extraire();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('secret');
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });

  it('polygone : la population de la zone dans le résumé (exacte, aucune perte, chiffré)', async () => {
    jeuAvec([{ plateforme: 'ttd', maille: 'polygone', seuil: 0, rayon_m: null }], DESSIN, [regle('ttd', 'polygone')]);
    // A7 : la forme est mesurée avant d'être figée ; rien de simplifié ici.
    etat.reponses.simplification_polygone_plateforme = { data: {
      tolerance_m: 50, simplifiee: false, sommets_avant: 33, morceaux_avant: 1, sommets: 33, morceaux: 1, carreaux_bande: 0,
      perdue: 0, gagnee: 0, min_menages: 0, seuil_perte_affichee: 0.1,
    }, error: null };
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_resume.plateformes[0])
      .toMatchObject({ exacte: true, n_unites: 1, population: 10_000, couverte: 10_000, surface_km2: 78.5 });
    expect(etat.rpcs.find((r) => r.nom === 'couverture_zone')!.args).toMatchObject({ p_decoupage: 'forme', p_org_id: ORG });
  });
});

describe('A7 — polygone : simplifié, sommets et morceaux contrôlés contre le registre, perte figée', () => {
  /** La ligne TTD au polygone du seed de sql/312 : 20 000 sommets, 2 000 morceaux, toutes deux « à vérifier ». */
  const ttdPolygone = {
    ...regle('ttd', 'polygone'), a_verifier: true, polygone_sommets_max: 20_000, polygone_morceaux_max: 2_000,
    parametres_a_verifier: ['polygone_morceaux_max', 'polygone_sommets_max'],
  };
  const POI_2000 = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 500, perimetre: { type: 'departement', code: '31' } };
  const simplification = (p: Record<string, unknown> = {}) => ({
    data: {
      tolerance_m: 50, simplifiee: true, sommets_avant: 66_000, morceaux_avant: 2_000, sommets: 18_000, morceaux: 2_000,
      carreaux_bande: 900, perdue: 400, gagnee: 30, min_menages: 0, seuil_perte_affichee: 0.1, ...p,
    },
    error: null,
  });

  it('zone POI à 2 000 disques : simplifiée sous la borne — bilan NON exact (perdue = manques, gagnée = hors zone), mesure et perte figées', async () => {
    jeuAvec([{ plateforme: 'ttd', maille: 'polygone', seuil: 0, rayon_m: null }], POI_2000, [ttdPolygone]);
    etat.reponses.simplification_polygone_plateforme = simplification();
    expect((await extraire()).status).toBe(201);
    expect(etat.rpcs.find((r) => r.nom === 'simplification_polygone_plateforme')!.args).toEqual({ p_zone_id: ZONE, p_org_id: ORG, p_cible: 'ind', p_plateforme: 'ttd' });
    const r = argsCreation().p_resume.plateformes[0];
    // Tour 1 (M-1) : la forme envoyée n'est plus la zone — 10 000 − 400 couverts, + 30 hors zone achetés.
    expect(r).toMatchObject({
      exacte: false, n_unites: 1, population: 10_000, couverte: 9_600, achetee: 9_630, manques: 400, hors_zone: 30, taux_utile: 99.7,
    });
    expect(Number(r.couverte) + Number(r.manques)).toBe(r.population);
    expect(argsCreation().p_unites).toEqual([{ plateforme: 'ttd', maille: 'polygone', retenu: true, pop_en_zone: 9_600, pop_totale: 9_630, part: 99.7 }]);
    expect(r.simplification).toEqual({
      tolerance_m: 50, sommets_avant: 66_000, morceaux_avant: 2_000, sommets: 18_000, morceaux: 2_000, perdue: 400, gagnee: 30,
    });
    expect(r.avertissements).toEqual([{ code: 'perte_simplification', limite: 0.1, valeur: 4, n: 400 }]);
  });

  it('zone importée à 500 sommets, déjà sous les bornes : AUCUNE simplification (tolérance 0), bilan exact, aucun avertissement', async () => {
    jeuAvec([{ plateforme: 'ttd', maille: 'polygone', seuil: 0, rayon_m: null }], { v: 1, type: 'import' }, [ttdPolygone]);
    etat.reponses.simplification_polygone_plateforme = simplification({
      tolerance_m: 0, simplifiee: false, sous_bornes: true, sommets_avant: 500, morceaux_avant: 1, sommets: 500, morceaux: 1,
      carreaux_bande: 0, perdue: 0, gagnee: 0,
    });
    expect((await extraire()).status).toBe(201);
    const r = argsCreation().p_resume.plateformes[0];
    expect(r).toMatchObject({ exacte: true, couverte: 10_000, manques: 0, hors_zone: 0 });
    expect(r.simplification).toMatchObject({ tolerance_m: 0, sommets_avant: 500, sommets: 500, perdue: 0 });
    expect(r.avertissements).toEqual([]);
  });

  it('au-dessus de la borne APRÈS simplification : 422 chiffré (obtenu, admis, à vérifier), rien d’écrit', async () => {
    jeuAvec([{ plateforme: 'ttd', maille: 'polygone', seuil: 0, rayon_m: null }], POI_2000, [ttdPolygone]);
    etat.reponses.simplification_polygone_plateforme = simplification({ sommets: 34_000, morceaux: 2_400 });
    const r = await extraire();
    expect(r.status).toBe(422);
    const corps = await r.json();
    expect(corps).toMatchObject({
      refus: 'polygone_trop_lourd', plateforme: 'ttd', tolerance_m: 50,
      sommets_avant: 66_000, sommets: 34_000, sommets_max: 20_000, morceaux: 2_400, morceaux_max: 2_000,
    });
    // `formaterNombre` sépare les milliers par une espace insécable fine : comparée ici comme une espace.
    expect(corps.error.replace(/\s/g, ' ')).toBe('ttd — Même simplifié à 50 m, le polygone compte 34 000 sommets pour 20 000 admis par la plateforme '
      + '(à vérifier) et 2 400 morceaux pour 2 000 admis (à vérifier) : réduisez la zone, ou choisissez une autre maille.');
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });

  it('un refus de la RPC (zone introuvable) : préfixé de la plateforme, même statut, rien d’écrit', async () => {
    jeuAvec([{ plateforme: 'ttd', maille: 'polygone', seuil: 0, rayon_m: null }], POI_2000, [ttdPolygone]);
    etat.reponses.simplification_polygone_plateforme = { data: { refus: 'zone_introuvable' }, error: null };
    const r = await extraire();
    expect(r.status).toBe(404);
    expect((await r.json()).error).toMatch(/^ttd — /);
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });
});

describe('chemins d’échec', () => {
  it('aucune unité retenue au seuil : 422 nommé, rien d’écrit', async () => {
    jeuAvec([{ plateforme: 'tiktok', maille: 'commune', seuil: 95, rayon_m: null }], DESSIN, [regle('tiktok', 'commune')]);
    const r = await extraire();
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/^tiktok — aucune unité retenue au seuil de 95 %/);
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });

  it('règle disparue de plateformes_geo depuis l’enregistrement : 422, aucun calcul', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], DESSIN, []);
    const r = await extraire();
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe('dv360 n’achète pas à la maille cp. Réglez à nouveau le jeu avant d’extraire.');
    expect(etat.rpcs).toEqual([]);
  });

  it('refus de paver_cercles : même statut, message préfixé de la plateforme, chiffres gardés', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 1000 }], DESSIN, [regle('meta', 'cercle', { max_unites: 200 })]);
    etat.reponses.paver_cercles = { data: { refus: 'trop_de_cercles', n_cercles: 481, plafond: 200 }, error: null };
    const r = await extraire();
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      error: 'meta — Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.',
      refus: 'trop_de_cercles', n_cercles: 481, plafond: 200, plateforme: 'meta',
    });
  });

  it('groupes de CP illisibles : 500 neutre, rien d’écrit', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], DESSIN, [regle('dv360', 'cp')]);
    etat.tables.cp_groupe = { data: null, error: { message: 'secret' } };
    const r = await extraire();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('secret');
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });
});

describe('zone pays (⑤ finitions, T2) : le ciblage pays des plateformes, sans carreau lu', () => {
  const CODES = { METRO: ['FR'], FR: ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'] };
  const reglePays = (plateforme: string) => ({ ...regle(plateforme, 'pays'), codes_pays: CODES, pays_a_verifier: ['FR'] });
  const QUATRE = ['dv360', 'meta', 'tiktok', 'ttd'];
  const METRO = { v: 1, type: 'pays', code: 'METRO' };
  const FRANCE = { v: 1, type: 'pays', code: 'FR' };
  const POP_FR = 63_711_780;
  /** La couverture d'une zone pays : la forme (dénominateurs nationaux), les départements (deux DROM peuplés), les CP. */
  function couverturePays(population: number) {
    etat.reponses.couverture_zone = (args) => {
      const d = args.p_decoupage;
      if (d === 'forme') return { data: { population, surface_km2: 547_779, lignes: [] }, error: null };
      if (d === 'departement') {
        return {
          data: {
            population, surface_km2: 547_779,
            lignes: [
              { code: '13', nom: 'Bouches-du-Rhône', commune: null, n_carreaux: 9, pop_en_zone: 2_000_000, pop_totale: 2_000_000, part: 100, part_brute: 100 },
              { code: '972', nom: 'Martinique', commune: null, n_carreaux: 9, pop_en_zone: 306_745, pop_totale: 306_745, part: 100, part_brute: 100 },
              { code: '974', nom: 'La Reunion', commune: null, n_carreaux: 9, pop_en_zone: 884_165, pop_totale: 884_165, part: 100, part_brute: 100 },
            ],
          },
          error: null,
        };
      }
      return { data: { ...COUVERTURE, population }, error: null };
    };
  }
  const decoupagesLus = () => etat.rpcs.filter((r) => r.nom === 'couverture_zone').map((r) => r.args.p_decoupage);

  it('METRO, quatre plateformes au pays : une unité FR par plateforme, UNE lecture (forme), aucun pavage', async () => {
    jeuAvec(QUATRE.map((p) => ({ plateforme: p, maille: 'pays', seuil: 0, rayon_m: null })), METRO, QUATRE.map(reglePays));
    couverturePays(62_528_975);
    expect((await extraire()).status).toBe(201);
    expect(decoupagesLus()).toEqual(['forme']);
    expect(etat.rpcs.map((r) => r.nom)).not.toContain('paver_cercles');
    expect(argsCreation().p_cp).toEqual([]);
    expect(argsCreation().p_unites).toEqual(QUATRE.map((p) => ({
      plateforme: p, maille: 'pays', code: 'FR', nom: 'France', retenu: true,
      pop_en_zone: 62_528_975, pop_totale: 62_528_975, part: 100,
    })));
    expect(argsCreation().p_resume.plateformes[0]).toMatchObject({
      exacte: true, n_unites: 1, population: 62_528_975, couverte: 62_528_975, manques: 0, hors_zone: 0, taux_utile: 100,
      avertissements: [],
    });
    expect(argsCreation().p_resume.plateformes.every((r) => !('pays_a_verifier' in r))).toBe(true);
  });

  it('France entière : FR = métropole, chaque DROM par son département, NULL (jamais 0) si non carroyé (E10)', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'pays', seuil: 0, rayon_m: null }, { plateforme: 'tiktok', maille: 'pays', seuil: 0, rayon_m: null }],
      FRANCE, [reglePays('meta'), reglePays('tiktok')]);
    couverturePays(POP_FR);
    expect((await extraire()).status).toBe(201);
    // Deux lectures en tout, pour deux plateformes : la forme, les départements.
    expect(decoupagesLus()).toEqual(['forme', 'departement']);
    const meta = argsCreation().p_unites.filter((u) => u.plateforme === 'meta');
    expect(meta.map((u) => [u.code, u.nom, u.pop_en_zone, u.part])).toEqual([
      ['FR', 'France', POP_FR - 306_745 - 884_165, 100],
      ['GP', 'Guadeloupe', null, null],
      ['MQ', 'Martinique', 306_745, 100],
      ['GF', 'Guyane', null, null],
      ['RE', 'La Réunion', 884_165, 100],
      ['YT', 'Mayotte', null, null],
    ]);
    expect(argsCreation().p_resume.plateformes[0]).toMatchObject({ exacte: true, n_unites: 6, population: POP_FR });
    // Relecture 1 : France entière n'est confirmée chez aucune plateforme — le résumé le porte, sans changer le choix.
    expect(argsCreation().p_resume.plateformes.map((r) => r.pays_a_verifier)).toEqual([true, true]);
  });

  it('DV360 au CP sur une zone pays : le plan CP, comme pour toute zone (choix de l’utilisateur, § 16.1)', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }, { plateforme: 'meta', maille: 'pays', seuil: 0, rayon_m: null }],
      METRO, [regle('dv360', 'cp'), reglePays('meta')]);
    couverturePays(62_528_975);
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_cp.map((l) => l.code_postal).sort()).toEqual(['69001', '69002', '69003']);
    expect(argsCreation().p_unites.filter((u) => u.maille === 'pays')).toHaveLength(1);
  });

  it('un choix sans objet (Meta en cercles, enregistré avant la règle) : 422 avec sa phrase, rien calculé', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 10000 }], METRO, [regle('meta', 'cercle')]);
    const r = await extraire();
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      error: 'meta — Sur toute la France, le ciblage par cercles n’a pas de sens : choisissez le pays. Réglez à nouveau le jeu avant d’extraire.',
      refus: 'maille_sans_objet', plateforme: 'meta',
    });
    expect(etat.rpcs).toEqual([]);
  });

  it('la maille pays sur une zone qui n’est pas nationale : 422, rien calculé', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'pays', seuil: 0, rayon_m: null }], DESSIN, [reglePays('meta')]);
    const r = await extraire();
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe('meta — La maille pays ne s’achète que pour une zone nationale. Réglez à nouveau le jeu avant d’extraire.');
    expect(etat.rpcs).toEqual([]);
  });

  it('plus aucun 422 `zone_pays` : une zone pays au département s’extrait comme une autre zone', async () => {
    jeuAvec([{ plateforme: 'tiktok', maille: 'departement', seuil: 20, rayon_m: null }], METRO, [regle('tiktok', 'departement')]);
    couverturePays(62_528_975);
    const r = await extraire();
    expect(r.status).toBe(201);
    expect(JSON.stringify(await r.json())).not.toContain('zone_pays');
  });
});

describe('décision du 02/11 : un rayon sous 250 m ne s’active jamais (gardé pour l’analyse)', () => {
  const POI = (rayon_m: number) => ({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m, perimetre: { type: 'departement', code: '69' } });

  it('rayon_poi 100 m : 422 avec la valeur, avant toute règle, couverture ou écriture — aucune remontée au minimum', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], POI(100), [regle('dv360', 'cp')]);
    const r = await extraire();
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      error: 'Rayon de 100 m : trop fin pour être activé (minimum 250 m). Gardé pour l’analyse uniquement.',
      refus: 'rayon_non_activable',
    });
    expect(etat.rpcs).toEqual([]);
    expect(etat.lectures.map((l) => l.table)).not.toContain('plateformes_geo');
  });

  it('rayon_point 200 m en cercle : refusé de même, jamais relevé au minimum de la plateforme', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 1000 }],
      { v: 1, type: 'rayon_point', lon: 4.8357, lat: 45.764, rayon_m: 200, part_retenue: 1 },
      [regle('meta', 'cercle', { rayon_min_m: 1000, rayon_max_m: 80000 })]);
    const r = await extraire();
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe('Rayon de 200 m : trop fin pour être activé (minimum 250 m). Gardé pour l’analyse uniquement.');
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('paver_cercles');
  });

  it('rayon_poi 250 m : s’active (comportement B8 inchangé)', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], POI(250), [regle('dv360', 'cp')]);
    expect((await extraire()).status).toBe(201);
  });
});

describe('tour 3 (N-2) : une combinaison dont une zone source est sous 250 m ne s’extrait pas', () => {
  const SOURCE_FINE = '3f2504e0-4f89-11d3-9a0c-0305e82c33f1';
  const SOURCE_LARGE = '3f2504e0-4f89-11d3-9a0c-0305e82c33f2';
  it.each(['union', 'intersection', 'difference'])('%s : 422 qui nomme la zone et son rayon, sources lues en UNE requête, aucune RPC', async (operation) => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }],
      { v: 1, type: 'combinaison', operation, zones: [SOURCE_LARGE, SOURCE_FINE] }, [regle('dv360', 'cp')]);
    const recette = { v: 1, type: 'combinaison', operation, zones: [SOURCE_LARGE, SOURCE_FINE] };
    // La zone du jeu (lecture `.eq('id')`), puis ses sources (lecture `.in('id')`).
    etat.tables.custom_geo_zones = (filtres) => (filtres.some((f) => f[0] === 'in')
      ? { data: [
        { id: SOURCE_LARGE, name: 'Lycées 5 km', recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'departement', code: '69' } } },
        { id: SOURCE_FINE, name: 'Lycées 100 m', recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 100, perimetre: { type: 'departement', code: '69' } } },
      ], error: null }
      : { data: { recette }, error: null });
    const r = await extraire();
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      error: 'La zone « Lycées 100 m » (rayon de 100 m) est trop fine pour être activée (minimum 250 m) : '
        + 'cette combinaison est gardée pour l’analyse uniquement.',
      refus: 'rayon_non_activable',
    });
    expect(etat.lectures.filter((l) => l.table === 'custom_geo_zones' && l.filtres.some((f) => f[0] === 'in'))).toHaveLength(1);
    expect(etat.rpcs).toEqual([]);
  });
});

describe('B14 (ARB-6 = A) : au-delà de la limite d’unités, découpage en blocs', () => {
  /** `n` communes à parts décroissantes (la première la plus forte), toutes retenues au seuil de 0,01 %. */
  const communes = (n: number) => Array.from({ length: n }, (_, i) => ({
    code: String(10000 + i), nom: `Commune ${i}`, commune: null, n_carreaux: 1,
    pop_en_zone: 100, pop_totale: 200, part: Math.round(((n - i) / n) * 1000) / 10, part_brute: ((n - i) / n) * 100,
  }));

  it('3 500 communes sur TikTok : 2 blocs (3 000 puis 500), triés par part décroissante, bilan par bloc, annoncé', async () => {
    jeuAvec([{ plateforme: 'tiktok', maille: 'commune', seuil: 0.01, rayon_m: null }], DESSIN,
      [regle('tiktok', 'commune', { max_unites: 3000, pop_min_groupe: 1000 })]);
    etat.reponses.couverture_zone = { data: { population: 350_000, surface_km2: 9_000, lignes: communes(3500) }, error: null };
    expect((await extraire()).status).toBe(201);
    const unites = argsCreation().p_unites;
    expect(unites.filter((u) => u.bloc === 1)).toHaveLength(3000);
    expect(unites.filter((u) => u.bloc === 2)).toHaveLength(500);
    // Les 3 000 plus fortes parts au bloc 1.
    expect(unites.slice(0, 3000).every((u) => u.bloc === 1)).toBe(true);
    const resume = argsCreation().p_resume.plateformes[0];
    expect(resume.decoupage).toEqual({
      limite: 3000,
      blocs: [
        expect.objectContaining({ numero: 1, n_unites: 3000, couverte: 300_000, achetee: 600_000, hors_zone: 300_000, taux_utile: 50 }),
        expect.objectContaining({ numero: 2, n_unites: 500, couverte: 50_000, achetee: 100_000 }),
      ],
    });
    expect(resume.avertissements).toEqual([{ code: 'max_unites', limite: 3000, valeur: 3500, n: 2 }]);
  });

  // Round 1 (I-1) : 3 003 communes — 3 000 à 200 personnes, puis 3 rurales à 150 (les plus faibles parts) : le bloc 2
  // compte 450 personnes, sous le minimum de groupe de 1 000, alors que la maille entière le dépasse largement.
  const rurales = () => communes(3003).map((l, i) => (i >= 3000 ? { ...l, pop_totale: 150 } : l));

  it('round 1 (I-1) : 3 003 communes TikTok — bloc 2 à 450 personnes, avertissement qui nomme le bloc', async () => {
    jeuAvec([{ plateforme: 'tiktok', maille: 'commune', seuil: 0.01, rayon_m: null }], DESSIN,
      [{ ...regle('tiktok', 'commune', { max_unites: 3000, pop_min_groupe: 1000 }), pop_min_groupe_comportement: 'avertissement' }]);
    etat.reponses.couverture_zone = { data: { population: 300_300, surface_km2: 9_000, lignes: rurales() }, error: null };
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_resume.plateformes[0].avertissements).toEqual([
      { code: 'max_unites', limite: 3000, valeur: 3003, n: 2 },
      { code: 'pop_min_groupe', limite: 1000, valeur: 450, bloc: 2, plateforme: 'tiktok' },
    ]);
  });

  it('round 1 (I-1) : même cas, registre en refus — le bloc 2 est refusé, nommé, rien de figé', async () => {
    jeuAvec([{ plateforme: 'tiktok', maille: 'commune', seuil: 0.01, rayon_m: null }], DESSIN,
      [{ ...regle('tiktok', 'commune', { max_unites: 3000, pop_min_groupe: 1000 }), pop_min_groupe_comportement: 'refus' }]);
    etat.reponses.couverture_zone = { data: { population: 300_300, surface_km2: 9_000, lignes: rurales() }, error: null };
    const r = await extraire();
    expect(r.status).toBe(422);
    const corps = await r.json() as { error: string; refus: string; bloc: number; valeur: number };
    expect(corps).toMatchObject({ refus: 'pop_min_groupe', bloc: 2, valeur: 450, limite: 1000 });
    expect(corps.error.replace(/\s/g, ' ')).toBe('tiktok — Le bloc 2 compte 450 personnes, sous le minimum de 1 000 par groupe de la '
      + 'plateforme : élargissez la zone, relevez le seuil, ou choisissez une autre maille.');
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });

  it('sous la limite : aucun bloc, aucun découpage figé', async () => {
    jeuAvec([{ plateforme: 'tiktok', maille: 'commune', seuil: 0.01, rayon_m: null }], DESSIN,
      [regle('tiktok', 'commune', { max_unites: 3000 })]);
    etat.reponses.couverture_zone = { data: { population: 3_000, surface_km2: 90, lignes: communes(30) }, error: null };
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_unites.some((u) => 'bloc' in u)).toBe(false);
    expect(argsCreation().p_resume.plateformes[0]).not.toHaveProperty('decoupage');
  });
});

describe('B15 : exactitude par composition — la recette garde ses unités constitutives', () => {
  const SCORE = { indicateurs: [{ code: 'taux_pauvrete', poids: 1, sens: 'croissant' }], maille: 'cp', seuil_score: 60 };

  it('capture de score au CP, sans groupe partiel : exacte, les codes de la capture, seuil ignoré, aucune couverture CP calculée', async () => {
    const capture = { v: 1, type: 'capture', source_type: 'score', parametres: SCORE };
    jeuAvec([{ plateforme: 'meta', maille: 'cp', seuil: 95, rayon_m: null }], capture, [regle('meta', 'cp')], { maille: 'cp', codes: ['69001', '69002'], groupes_partiels: 0 });
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_unites).toEqual([
      { plateforme: 'meta', maille: 'cp', code: '69001', retenu: true },
      { plateforme: 'meta', maille: 'cp', code: '69002', retenu: true },
    ]);
    expect(argsCreation().p_resume.plateformes[0]).toMatchObject({ exacte: true, n_unites: 2, n_codes: 2, manques: 0, hors_zone: 0, taux_utile: 100 });
  });

  it('seuil sur territoires à l’IRIS en maille IRIS : exact, une unité par IRIS, aucune mesure de polygone', async () => {
    const seuil = {
      v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type: 'departement', code: '69' },
    };
    jeuAvec([{ plateforme: 'tiktok', maille: 'iris', seuil: 50, rayon_m: null }], seuil, [regle('tiktok', 'iris')], { maille: 'iris', codes: ['693830101', '693830102'] });
    expect((await extraire()).status).toBe(201);
    expect(etat.rpcs.map((r) => r.nom)).not.toContain('simplification_polygone_plateforme');
    expect(argsCreation().p_unites).toEqual([
      { plateforme: 'tiktok', maille: 'iris', code: '693830101', retenu: true },
      { plateforme: 'tiktok', maille: 'iris', code: '693830102', retenu: true },
    ]);
    expect(argsCreation().p_resume.plateformes[0]).toMatchObject({ exacte: true, n_unites: 2, taux_utile: 100 });
  });

  it('un groupe de CP présent en partie : non exacte, perte calculée par la couverture, ajustement figé avant/après', async () => {
    // 69001 seul d'un groupe { 69001, 69009 } : la couverture rend l'unité du groupe, achetée entière (deux codes).
    const capture = { v: 1, type: 'capture', source_type: 'score', parametres: SCORE };
    jeuAvec([{ plateforme: 'meta', maille: 'cp', seuil: 20, rayon_m: null }], capture, [regle('meta', 'cp')], { maille: 'cp', codes: ['69001', '69002'], groupes_partiels: 1 });
    etat.reponses.couverture_zone = {
      data: { ...COUVERTURE, lignes: COUVERTURE.lignes.map((l) => (l.code === '69001' ? { ...l, membres: ['69001', '69009'] } : l)) }, error: null,
    };
    expect((await extraire()).status).toBe(201);
    expect(etat.rpcs.map((r) => r.nom)).toContain('couverture_zone');
    const resume = argsCreation().p_resume.plateformes[0];
    expect(resume).toMatchObject({ exacte: false, n_unites: 2, n_codes: 3 });
    expect(resume.avertissements).toEqual([{ code: 'groupes_cp_partiels', limite: 2, valeur: 3, n: 1 }]);
  });
});
