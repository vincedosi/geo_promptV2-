/**
 * `couverture_rayon_poi` (sql/272, lot 4, T11) — la courbe de couverture par rayon du module risque, autour de
 * n'importe quel type de POI, sans pré-calcul, bornée au département (arbitrages A-11, A-12, Q-I).
 *
 * Ce que ce fichier prouve :
 *   - la PARITÉ : sur les sites Seveso du département 13, chaque courbe égale, palier par palier, celle que le module
 *     risque lit dans son pré-calcul (`lire_couverture_rayon`, épinglée sur `REFERENCES_13` par
 *     `couverture-caracterisation.test.ts`) — la courbe `*` et une courbe par gravité — sauf au dernier palier, où le
 *     pré-calcul perd des carreaux (cause mesurée et écrite sur le test) ;
 *   - un autre type de POI (lycées), une commune saisie par son NOM et un CP non canonique de `cp_groupe` (A-11) ;
 *   - le profil d'anneaux : chaque carreau du périmètre est classé une fois et une seule (A-12) ;
 *   - les refus, rendus avant tout calcul.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const LONG = 60_000;

interface Point { r: number; p: number; i: number }
interface Courbe { cle: string; total: number; carreaux: number; points: Point[] }
interface Resultat {
  refus?: string; plafond?: number;
  calculable: boolean; cible: string; rayon_max_m: number; n_poi: number; population_perimetre: number;
  courbes: Courbe[]; classes?: { valeur: string; anneau_m: number; population: number }[]; hors_classes?: number;
}

let sourcesLycees: string[] = [];
let org = '';

beforeAll(async () => {
  const { data, error } = await admin.from('poi_france').select('data_source_id').eq('categorie', 'lycee').limit(1);
  if (error || !data?.[0]?.data_source_id) throw new Error(`source des lycées : ${error?.message ?? 'absente'}`);
  sourcesLycees = [data[0].data_source_id as string];
  const o = await admin.from('organizations')
    .insert({ name: '[ESSAI lot4 T11]', slug: `essai-lot4-t11-${Date.now()}` }).select('id').single();
  if (o.error || !o.data) throw new Error(o.error?.message);
  org = o.data.id as string;
});

afterAll(async () => {
  if (!org) return;
  const { error } = await admin.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

async function couverture(args: Record<string, unknown>): Promise<Resultat> {
  const { data, error } = await admin.rpc('couverture_rayon_poi', {
    p_categorie: 'lycee', p_perimetre_type: 'departement', p_perimetre_code: '13', p_org_id: org,
    p_sources: sourcesLycees, p_rayon_max_m: 5000, ...args,
  });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as Resultat;
}

/** Les sites Seveso du 13 à 10 km : l'appel que le module risque pré-calcule. Les sites ICPE n'ont pas de source. */
const seveso13 = (args: Record<string, unknown> = {}) => couverture({
  p_categorie: 'risque_industriel', p_sources: [], p_rayon_max_m: 10000,
  p_champ: 'sous_categorie', p_valeurs: ['seveso_haut', 'seveso_bas'], ...args,
});

async function courbeRisque(gravites: string[] | null): Promise<Courbe> {
  const { data, error } = await admin.rpc('lire_couverture_rayon', {
    p_cible: 'ind', p_gravites: gravites, p_natures: null, p_perim_niveau: 'departement', p_perim_codes: ['13'],
  });
  expect(error).toBeNull();
  return (data as { courbes: Courbe[] }).courbes.find((c) => c.cle === '*')!;
}

describe('couverture_rayon_poi — parité avec le module risque (département 13, Seveso, 10 km)', () => {
  /**
   * Égalité EXACTE sur les 99 premiers paliers (100 à 9 900 m), incréments compris. Le dernier (10 000 m) diffère, et la
   * cause est mesurée : le pré-calcul (`construire_couverture_rayon`, sql/200) cherche les carreaux dans un tampon
   * `quad_segs=4` du site — un polygone de 16 côtés INSCRIT dans le cercle, dont le rayon intérieur vaut
   * 10 000 · cos(π/16) = 9 808 m. Un carreau entre ≈ 9 670 m (9 808 moins sa demi-diagonale) et 10 km peut donc lui
   * échapper ; ici 43 carreaux, tous entre 9 932 et 9 999 m (1 554 habitants sur `*`, 3 055 sur seveso_haut, 2 267 sur
   * seveso_bas, mesurés le 2026-10-23 contre `carreau_risque_distance`). La fonction générique les compte : c'est elle
   * qui a raison. Ce que ce test interdit : tout écart avant 9 700 m, et tout écart où la générique compterait MOINS.
   */
  it('chaque courbe égale le pré-calcul palier par palier, le bord du tampon à 16 côtés excepté', async () => {
    const r = await seveso13();
    expect(r.calculable).toBe(true);
    expect(r.rayon_max_m).toBe(10000);
    expect(r.courbes.map((c) => c.cle)).toEqual(['*', 'seveso_bas', 'seveso_haut']);
    for (const [cle, gravites] of [['*', null], ['seveso_haut', ['seveso_haut']], ['seveso_bas', ['seveso_bas']]] as const) {
      const attendue = await courbeRisque(gravites as string[] | null);
      const obtenue = r.courbes.find((c) => c.cle === cle)!;
      expect(obtenue.points.length, cle).toBe(100);
      expect(obtenue.points.slice(0, 99), cle).toEqual(attendue.points.slice(0, 99));
      const ecart = obtenue.points[99].p - attendue.points[99].p;
      expect(ecart, cle).toBeGreaterThan(0);
      expect(ecart, cle).toBeLessThanOrEqual(attendue.total * 0.003);
      expect(obtenue.total - attendue.total, cle).toBe(ecart);
      expect(obtenue.carreaux, cle).toBeGreaterThan(attendue.carreaux);
    }
  }, LONG);

  it('profil d’anneaux : chaque carreau du périmètre classé une fois (∑ classes + hors classes = population)', async () => {
    const r = await seveso13({ p_profil: { seveso_haut: [500, 1000, 2000], seveso_bas: [500] } });
    // Ordre du profil = ordre de `p_valeurs` (jsonb ne garde pas l'ordre des clés) : seveso_haut prime.
    expect(r.classes!.map((c) => `${c.valeur}:${c.anneau_m}`))
      .toEqual(['seveso_haut:500', 'seveso_haut:1000', 'seveso_haut:2000', 'seveso_bas:500']);
    const somme = r.classes!.reduce((s, c) => s + c.population, 0) + r.hors_classes!;
    // Arrondis : 0,5 par terme au plus (même tolérance que la partition de `couverture_geometrie`).
    expect(Math.abs(somme - r.population_perimetre)).toBeLessThanOrEqual(0.5 * (r.classes!.length + 2));
    // Le cumul à 2 km de la courbe seveso_haut ne peut pas être sous la somme de ses trois anneaux.
    const haut2000 = r.courbes.find((c) => c.cle === 'seveso_haut')!.points.find((p) => p.r === 2000)!.p;
    const classesHaut = r.classes!.filter((c) => c.valeur === 'seveso_haut').reduce((s, c) => s + c.population, 0);
    expect(Math.abs(haut2000 - classesHaut)).toBeLessThanOrEqual(2);
  }, LONG);
});

describe('couverture_rayon_poi — autres POI, autres périmètres', () => {
  it('lycées des Bouches-du-Rhône à 5 km : une seule courbe de valeur, égale à la courbe *', async () => {
    const r = await couverture({ p_champ: 'sous_categorie' });
    expect(r.n_poi).toBeGreaterThan(50);
    expect(r.courbes).toHaveLength(2);
    const [tout, valeur] = r.courbes;
    expect(tout.cle).toBe('*');
    expect(tout.total).toBeGreaterThan(0);
    expect(tout.total).toBeLessThanOrEqual(r.population_perimetre);
    expect(tout.points).toHaveLength(50);
    expect(valeur.points).toEqual(tout.points);
  }, LONG);

  it.each([
    ['commune saisie par son nom', 'commune', 'aix-en-provence'],
    ['CP non canonique de cp_groupe (13090 → 13080)', 'cp', '13090'],
  ])('%s : les carreaux sont lus par géométrie (A-11)', async (_n, type, code) => {
    const r = await couverture({ p_perimetre_type: type, p_perimetre_code: code });
    expect(r.refus).toBeUndefined();
    expect(r.population_perimetre).toBeGreaterThan(0);
    expect(r.courbes[0].total).toBeGreaterThan(0);
  }, LONG);
});

describe('couverture_rayon_poi — refus, sans calcul', () => {
  it('région : non admise (resoudre_perimetre refuse avant toute mesure)', async () => {
    expect(await couverture({ p_perimetre_type: 'region', p_perimetre_code: '84' })).toEqual({ refus: 'perimetre_non_admis' });
  });

  it('zone de plus de 12 000 km² : perimetre_trop_grand', async () => {
    const { data, error } = await admin.rpc('creer_zone_recette', {
      p_nom: 'Rectangle de 25 000 km²', p_org_id: org, p_cree_par: null, p_recette: { v: 1, type: 'dessin' },
      p_geometry_geojson: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 46], [2, 46], [2, 47.5], [0, 47.5], [0, 46]]] }),
    });
    if (error) throw new Error(error.message);
    const zone = (data as { id: string }).id;
    expect(await couverture({ p_perimetre_type: 'zone', p_perimetre_code: zone })).toEqual({ refus: 'perimetre_trop_grand' });
  });

  it.each([
    ['plus de POI que le plafond', { p_max_poi: 10 }, { refus: 'trop_de_poi', plafond: 10 }],
    ['champ hors de la liste fermée', { p_champ: 'nom' }, { refus: 'champ_non_admis' }],
    ['plus de 8 valeurs', { p_champ: 'sous_categorie', p_valeurs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] },
      { refus: 'trop_de_valeurs' }],
    ['cible inconnue', { p_cible: 'inconnue' }, { refus: 'cible_inconnue' }],
  ])('%s', async (_n, args, attendu) => {
    expect(await couverture(args)).toEqual(attendu);
  });

  it('rayon hors de [100, 10 000] : 22023', async () => {
    for (const p_rayon_max_m of [50, 10_100]) {
      const { error } = await admin.rpc('couverture_rayon_poi', {
        p_categorie: 'lycee', p_perimetre_type: 'departement', p_perimetre_code: '13', p_org_id: null,
        p_sources: sourcesLycees, p_rayon_max_m,
      });
      expect(error?.code).toBe('22023');
    }
  });
});
