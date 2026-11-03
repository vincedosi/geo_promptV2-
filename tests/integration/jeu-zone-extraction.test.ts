/**
 * Les routes de conversion et d'extraction de ⑤ contre la vraie base locale (lot 5, T8) :
 * - `POST /api/zones/jeux/[id]/extractions` d'un jeu de ZONE (A-11, Review Focus 3) : DV360 au CP, Meta en cercles,
 *   TTD au polygone, TikTok à la commune → UNE extraction, plan CP dans `zone_set_extraction_cp` (classe `zone`),
 *   unités de chaque plateforme dans `zone_set_extraction_unites`, `forme` copiée, quatre résumés ; rejouée →
 *   `deja_extraite` ; des unités envoyées par le client → 400, rien d'écrit ;
 * - `GET /api/zones/[id]/cercles` : la borne de rayon LUE dans `plateformes_geo` (400), la zone d'un autre espace (404) ;
 * - `POST /api/zones/communes/contours` : deux codes → deux géométries ;
 * - ⑤ finitions, T2 : une zone « France entière » achetée au PAYS par les quatre plateformes → unités figées depuis
 *   `plateformes_geo.codes_pays` (population `null` pour un DROM non carroyé, E10), relues à l'identique après une
 *   `update` de la table (Review Focus 3) ; une zone « France métropolitaine » avec DV360 au CP → plan CP de 5 956
 *   codes (sous `PLAFOND_CP_PLAN`).
 *
 * Seuls l'appelant et les quotas sont simulés (429 prouvés en unitaire). Deux espaces `[ESSAI lot5 T8]` sont créés
 * puis supprimés ; jeux, extractions et zones partent avec eux.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { compterSommets } from '@/lib/zones/executer-recette';

const sb = creerClientTest();
const LONG = 120_000;
const appelant = vi.hoisted(() => ({ org: '' }));
const AUTEUR = '00000000-0000-4000-8000-0000000008a1';

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: AUTEUR, role: 'client', organization_id: appelant.org }),
}));
vi.mock('@/lib/api/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit')>()),
  createRateLimiter: () => async () => ({ ok: true, retrySec: 0 }),
  createQuota: () => async () => null,
}));

const extractions = await import('@/app/api/zones/jeux/[id]/extractions/route');
const fichier = await import('@/app/api/zones/jeux/[id]/extractions/[version]/fichier/route');
const cercles = await import('@/app/api/zones/[id]/cercles/route');
const contours = await import('@/app/api/zones/communes/contours/route');

let org = '';
let autreOrg = '';
let zone = '';
let zoneAutre = '';
let jeu = '';

const json = (corps: unknown) => ({ method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } });
const extraire = (corps: unknown = {}) =>
  extractions.POST(new NextRequest(`http://localhost/api/zones/jeux/${jeu}/extractions`, json(corps)), { params: Promise.resolve({ id: jeu }) });
const paver = (id: string, q: string) =>
  cercles.GET(new NextRequest(`http://localhost/api/zones/${id}/cercles${q}`), { params: Promise.resolve({ id }) });

/** Une zone pays (sql/296) : la forme calculée par le serveur, comme `executerRecette`. */
async function creerZonePays(code: 'METRO' | 'FR', orgId: string): Promise<string> {
  const { data: forme, error: e1 } = await sb.rpc('zone_pays_geometrie', { p_code: code });
  if (e1) throw new Error(e1.message);
  const { data, error } = await sb.rpc('creer_zone_recette', {
    p_nom: `France ${code}`, p_org_id: orgId, p_cree_par: null, p_recette: { v: 1, type: 'pays', code },
    p_geometry_geojson: JSON.stringify((forme as { geometry: unknown }).geometry),
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

async function jeuSur(zoneId: string, nom: string, choix: { plateforme: string; maille: string; seuil: number }[]): Promise<string> {
  const { data, error } = await sb.from('zone_sets').insert({
    org_id: org, nom, type: 'zone', custom_geo_zone_id: zoneId, cible: 'ind', mode_plan: 'pondere', brouillon: false, version: 1,
  }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  const lignes = await sb.from('zone_set_plateformes').insert(choix.map((c) => ({ zone_set_id: data.id, rayon_m: null, ...c })));
  if (lignes.error) throw new Error(lignes.error.message);
  return data.id as string;
}

const extraireJeu = (id: string) =>
  extractions.POST(new NextRequest(`http://localhost/api/zones/jeux/${id}/extractions`, json({})), { params: Promise.resolve({ id }) });

async function nouvelleOrg(nom: string): Promise<string> {
  const { data, error } = await sb.from('organizations')
    .insert({ name: `[ESSAI lot5 T8] ${nom}`, slug: `essai-lot5-t8-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

/** Un rayon de 5 km autour de Lyon : dense, assez de CP, de communes et de cercles de 2 km pour chaque maille. */
async function creerZone(nom: string, orgId: string): Promise<string> {
  const recette = { v: 1, type: 'rayon_point', lon: 4.8357, lat: 45.764, rayon_m: 5000 };
  const { data: rayon, error: e1 } = await sb.rpc('zone_rayon', { p_lon: recette.lon, p_lat: recette.lat, p_rayon_m: 5000 });
  if (e1) throw new Error(e1.message);
  const { data, error } = await sb.rpc('creer_zone_recette', {
    p_nom: nom, p_org_id: orgId, p_cree_par: null, p_recette: recette,
    p_geometry_geojson: JSON.stringify((rayon as { geometry: unknown }).geometry),
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

const compter = async (table: 'zone_set_extractions', col: string, val: string) => {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true }).eq(col, val);
  if (error) throw new Error(error.message);
  return count ?? 0;
};

beforeAll(async () => {
  org = await nouvelleOrg('a');
  autreOrg = await nouvelleOrg('b');
  appelant.org = org;
  zone = await creerZone('Lyon 5 km', org);
  zoneAutre = await creerZone('Lyon 5 km (autre espace)', autreOrg);
  const { data, error } = await sb.from('zone_sets').insert({
    org_id: org, nom: 'Lyon quatre plateformes', type: 'zone', custom_geo_zone_id: zone, cible: 'ind',
    mode_plan: 'pondere', brouillon: false, version: 1,
  }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  jeu = data.id as string;
  const choix = await sb.from('zone_set_plateformes').insert([
    { zone_set_id: jeu, plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null },
    { zone_set_id: jeu, plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 2000 },
    { zone_set_id: jeu, plateforme: 'ttd', maille: 'polygone', seuil: 0, rayon_m: null },
    { zone_set_id: jeu, plateforme: 'tiktok', maille: 'commune', seuil: 20, rayon_m: null },
  ]);
  if (choix.error) throw new Error(choix.error.message);
}, LONG);

afterAll(async () => {
  for (const o of [org, autreOrg]) {
    if (!o) continue;
    // Les jeux d'abord (clé étrangère vers la zone `on delete restrict`) ; leurs extractions partent en cascade.
    const jeux = await sb.from('zone_sets').delete().eq('org_id', o);
    if (jeux.error) throw new Error(`nettoyage des jeux : ${jeux.error.message}`);
    const { error } = await sb.from('organizations').delete().eq('id', o);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('POST /api/zones/jeux/[id]/extractions — jeu de zone', () => {
  let extraction = '';

  it('des unités envoyées par le client : 400 (corps strict), aucune extraction écrite', async () => {
    const r = await extraire({ unites: [{ plateforme: 'meta', maille: 'cercle', lon: 0, lat: 0, retenu: true }] });
    expect(r.status).toBe(400);
    expect(await compter('zone_set_extractions', 'zone_set_id', jeu)).toBe(0);
  }, LONG);

  it('201 : une extraction, plan CP de classe zone, unités des quatre plateformes, forme copiée, quatre résumés', async () => {
    const r = await extraire({ commentaire: 'essai T8' });
    expect(r.status).toBe(201);
    const corps = await r.json() as { id: string; version: number; deja_extraite: boolean };
    expect(corps).toMatchObject({ ok: true, deja_extraite: false, version: 1 });
    extraction = corps.id;

    const { data: x, error } = await sb.from('zone_set_extractions')
      .select('plateformes, forme, commentaire, seuil_couverture_cp, n_cp, n_retenus').eq('id', extraction).single();
    if (error) throw new Error(error.message);
    expect(x.forme).not.toBeNull();
    expect(x.commentaire).toBe('essai T8');
    expect(Number(x.seuil_couverture_cp)).toBe(20);
    const resumes = x.plateformes as { plateforme: string; maille: string; exacte: boolean; n_unites: number }[];
    expect(resumes.map((p) => `${p.plateforme}:${p.maille}`)).toEqual(['dv360:cp', 'meta:cercle', 'tiktok:commune', 'ttd:polygone']);
    expect(resumes.every((p) => p.n_unites > 0)).toBe(true);
    // TTD au polygone : exact, chiffré par la population de la zone. Meta à 2 km ≠ 5 km de la recette : calculé.
    const ttd = resumes.find((p) => p.plateforme === 'ttd') as unknown as { exacte: boolean; population: number; couverte: number; manques: number };
    expect(ttd.exacte).toBe(true);
    expect(ttd.population).toBeGreaterThan(0);
    expect(ttd.couverte).toBe(ttd.population);
    expect(ttd.manques).toBe(0);
    expect(resumes.find((p) => p.plateforme === 'meta')?.exacte).toBe(false);
    // A7 (sql/312) : la forme figée est la forme SIMPLIFIÉE, celle dont l'extraction a compté les sommets.
    const simplification = (ttd as unknown as { simplification: { sommets: number; sommets_avant: number; morceaux: number } }).simplification;
    expect(simplification.sommets).toBeLessThanOrEqual(simplification.sommets_avant);
    expect(compterSommets(x.forme)).toBe(simplification.sommets);

    const { data: cps } = await sb.from('zone_set_extraction_cp').select('code_postal, classe, retenu, multiplicateur')
      .eq('extraction_id', extraction);
    expect(cps!.length).toBe(x.n_cp);
    expect(cps!.filter((c) => c.classe === 'zone').length).toBe(x.n_retenus);
    expect(cps!.every((c) => (c.classe === 'zone') === c.retenu)).toBe(true);

    const { data: unites } = await sb.from('zone_set_extraction_unites')
      .select('plateforme, maille, code, centre, rayon_m, retenu').eq('extraction_id', extraction);
    const de = (p: string) => unites!.filter((u) => u.plateforme === p);
    expect(de('meta').length).toBe(resumes.find((p) => p.plateforme === 'meta')!.n_unites);
    expect(de('meta').every((u) => u.maille === 'cercle' && u.centre !== null && u.rayon_m === 2000 && u.retenu)).toBe(true);
    expect(de('tiktok').every((u) => u.maille === 'commune' && u.code !== null)).toBe(true);
    expect(de('tiktok').filter((u) => u.retenu).length).toBe(resumes.find((p) => p.plateforme === 'tiktok')!.n_unites);
    // Les CP de DV360 sont SES unités (sql/278) : autant de retenus que le plan, au même seuil (le seul au CP).
    expect(de('dv360').filter((u) => u.retenu).length).toBe(x.n_retenus);
    expect(de('ttd').map(({ plateforme, maille, code, centre, rayon_m, retenu }) => ({ plateforme, maille, code, centre, rayon_m, retenu })))
      .toEqual([{ plateforme: 'ttd', maille: 'polygone', code: null, centre: null, rayon_m: null, retenu: true }]);
  }, LONG);

  it('rejouée : 200 deja_extraite, même version, rien d’écrit en plus', async () => {
    const r = await extraire();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, deja_extraite: true, id: extraction, version: 1 });
    expect(await compter('zone_set_extractions', 'zone_set_id', jeu)).toBe(1);
  }, LONG);

  it('GET de la liste : la version figée', async () => {
    const r = await extractions.GET(new NextRequest(`http://localhost/api/zones/jeux/${jeu}/extractions`), { params: Promise.resolve({ id: jeu }) });
    expect(r.status).toBe(200);
    const liste = (await r.json()).extractions as Array<{ id: string; plateformes: Array<{ plateforme: string; maille: string }> | null }>;
    expect(liste.map((e) => e.id)).toEqual([extraction]);
    // T12 du lot 5 : la liste porte le résumé figé par plateforme (l'écran le montre par version).
    expect(Array.isArray(liste[0].plateformes) && liste[0].plateformes.every((x) => typeof x.plateforme === 'string' && typeof x.maille === 'string')).toBe(true);
  });
});

describe('B12 : un plan par plateforme au CP, au seuil de la plateforme (sql/317)', () => {
  it('DV360 à 20 %, TTD à 10 % : deux plans figés ; celui de DV360 ne contient que les CP retenus à 20 %', async () => {
    const deux = await jeuSur(zone, 'Lyon DV360 20 / TTD 10', [
      { plateforme: 'dv360', maille: 'cp', seuil: 20 }, { plateforme: 'ttd', maille: 'cp', seuil: 10 },
    ]);
    const r = await extraireJeu(deux);
    expect(r.status).toBe(201);
    const { id } = await r.json() as { id: string };
    const { data: plans, error } = await sb.from('zone_set_extraction_cp_plateforme')
      .select('plateforme, code_postal, retenu, multiplicateur').eq('extraction_id', id);
    if (error) throw new Error(error.message);
    const de = (p: string) => new Set(plans!.filter((l) => l.plateforme === p).map((l) => l.code_postal));
    const { data: unites } = await sb.from('zone_set_extraction_unites')
      .select('plateforme, code, part, retenu').eq('extraction_id', id).eq('maille', 'cp');
    // Ce que chaque plateforme retient à SON seuil (sql/278) : ses unités retenues — le plan de DV360 n'en a pas d'autre.
    const retenusUnites = (p: string) => unites!.filter((u) => u.plateforme === p && u.retenu);
    expect(retenusUnites('dv360').every((u) => Number(u.part) >= 20)).toBe(true);
    for (const u of retenusUnites('dv360')) expect(de('dv360').has(u.code!)).toBe(true);
    expect(plans!.every((l) => l.retenu && Number(l.multiplicateur) > 0)).toBe(true);
    // TTD retient plus (10 %) ; tout CP du plan de DV360 est dans celui de TTD, l'inverse non.
    expect(de('ttd').size).toBeGreaterThan(de('dv360').size);
    for (const c of de('dv360')) expect(de('ttd').has(c)).toBe(true);
    // Un CP retenu à 10 % mais pas à 20 % n'est PAS dans le plan de DV360.
    const entre = unites!.filter((u) => u.plateforme === 'ttd' && u.retenu && Number(u.part) < 20).map((u) => u.code!);
    expect(entre.length).toBeGreaterThan(0);
    for (const c of entre) expect(de('dv360').has(c)).toBe(false);
    // Le plan commun (⑥/⑦, rétrocompatibilité) reste celui du seuil le plus bas ; chaque bilan est figé avec sa plateforme.
    const { data: x } = await sb.from('zone_set_extractions').select('seuil_couverture_cp, plateformes').eq('id', id).single();
    expect(Number(x!.seuil_couverture_cp)).toBe(10);
    const bilan = (p: string) => (x!.plateformes as { plateforme: string; plan_cp: { seuil: number; n_codes: number } }[])
      .find((q) => q.plateforme === p)!.plan_cp;
    expect(bilan('dv360')).toMatchObject({ seuil: 20, n_codes: de('dv360').size });
    expect(bilan('ttd')).toMatchObject({ seuil: 10, n_codes: de('ttd').size });
    // Rejouée : même contenu, même version.
    expect((await extraireJeu(deux)).status).toBe(200);
  }, LONG);
});

describe('maille exacte : Meta au rayon de la recette (5 km autour de Lyon)', () => {
  it('201 : exacte, UNE unité cercle au centre et au rayon de la recette, zéro perte', async () => {
    const { data, error } = await sb.from('zone_sets').insert({
      org_id: org, nom: 'Lyon Meta exact', type: 'zone', custom_geo_zone_id: zone, cible: 'ind',
      mode_plan: 'pondere', brouillon: false, version: 1,
    }).select('id').single();
    if (error || !data) throw new Error(error?.message);
    const exact = data.id as string;
    const choix = await sb.from('zone_set_plateformes').insert({ zone_set_id: exact, plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 5000 });
    if (choix.error) throw new Error(choix.error.message);

    const r = await extractions.POST(new NextRequest(`http://localhost/api/zones/jeux/${exact}/extractions`, json({})), { params: Promise.resolve({ id: exact }) });
    expect(r.status).toBe(201);
    const { id } = await r.json() as { id: string };
    const { data: x } = await sb.from('zone_set_extractions').select('plateformes').eq('id', id).single();
    expect((x!.plateformes as Record<string, unknown>[])[0]).toMatchObject({ plateforme: 'meta', exacte: true, n_unites: 1, manques: 0, hors_zone: 0, taux_utile: 100 });
    const { data: u, error: e2 } = await sb.from('zone_set_extraction_unites')
      .select('maille, rayon_m, retenu, part').eq('extraction_id', id);
    if (e2) throw new Error(e2.message);
    // Le centre est celui de la recette (vérifié en unitaire : `tests/unit/zones/extraction-jeu-zone.test.ts`).
    expect(u).toEqual([{ maille: 'cercle', rayon_m: 5000, retenu: true, part: 100 }]);
  }, LONG);
});

describe('GET /api/zones/[id]/cercles', () => {
  it('400 : rayon de 500 m sous le rayon_min_m de Meta, lu en base', async () => {
    const r = await paver(zone, '?cible=ind&rayon=500&seuil=20&plateforme=meta');
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/^Rayon de 500 m hors des bornes de meta/);
  });
  it('404 : la zone d’un autre espace', async () => {
    expect((await paver(zoneAutre, '?cible=ind&rayon=2000&seuil=20&plateforme=meta')).status).toBe(404);
  }, LONG);
  it('200 : des cercles retenus et une perte qui boucle', async () => {
    const r = await paver(zone, '?cible=ind&rayon=2000&seuil=30&plateforme=meta');
    expect(r.status).toBe(200);
    const p = await r.json() as { n_cercles: number; population: number; couverte: number; manques: number };
    expect(p.n_cercles).toBeGreaterThan(0);
    expect(Math.abs(p.couverte + p.manques - p.population)).toBeLessThanOrEqual(1);
  }, LONG);
});

describe('POST /api/zones/communes/contours', () => {
  it('deux codes : deux géométries GeoJSON', async () => {
    const r = await contours.POST(new NextRequest('http://localhost/api/zones/communes/contours', json({ codes: ['69381', '69382'] })));
    expect(r.status).toBe(200);
    const { communes, manquants } = await r.json() as { communes: { code: string; geometry: { type: string } }[]; manquants: string[] };
    expect(communes.map((c) => c.code)).toEqual(['69381', '69382']);
    expect(communes.every((c) => /Polygon$/.test(c.geometry.type))).toBe(true);
    expect(manquants).toEqual([]);
  });
});

describe('zone pays (⑤ finitions, T2) : achetée au pays, unités figées', () => {
  const QUATRE = ['dv360', 'meta', 'tiktok', 'ttd'];

  it('France entière, quatre plateformes au pays : FR + 5 DROM, figés ; une update de codes_pays ne change rien après coup', async () => {
    const zoneFr = await creerZonePays('FR', org);
    const id = await jeuSur(zoneFr, 'France entière au pays', QUATRE.map((p) => ({ plateforme: p, maille: 'pays', seuil: 0 })));
    const r = await extraireJeu(id);
    expect(r.status).toBe(201);
    const { id: x } = await r.json() as { id: string };

    const lire = async () => {
      const { data, error } = await sb.from('zone_set_extraction_unites')
        .select('plateforme, maille, code, nom, pop_en_zone, retenu').eq('extraction_id', x).order('plateforme').order('ordinal');
      if (error) throw new Error(error.message);
      return data!;
    };
    const avant = await lire();

    // ⑦ (T3, A-7) : le fichier « pays » de Meta ; le format CP refusé sur cette extraction, avec la phrase existante.
    const telecharger = (plateforme: string, format: string) => fichier.GET(
      new NextRequest(`http://localhost/api/zones/jeux/${id}/extractions/1/fichier?plateforme=${plateforme}&format=${format}`),
      { params: Promise.resolve({ id, version: '1' }) },
    );
    const f = await telecharger('meta', 'pays');
    expect(f.status).toBe(200);
    expect((await f.text()).replace(/^\uFEFF/, '').split('\n').filter((l) => !l.startsWith('#')))
      .toEqual(['code_pays;nom', 'FR;France', 'GP;Guadeloupe', 'MQ;Martinique', 'GF;Guyane', 'RE;La Réunion', 'YT;Mayotte']);
    const cp = await telecharger('dv360', 'cp');
    expect(cp.status).toBe(400);
    expect((await cp.json()).error).toBe('La plateforme dv360 n\'achète pas au code postal dans cette extraction.');
    const meta = avant.filter((u) => u.plateforme === 'meta');
    expect(meta.map((u) => u.code)).toEqual(['FR', 'GP', 'MQ', 'GF', 'RE', 'YT']);
    expect(meta.every((u) => u.maille === 'pays' && u.retenu)).toBe(true);
    // E10 : Guadeloupe, Guyane et Mayotte ne sont pas carroyées (Filosofi 2021) — population inconnue, jamais 0.
    expect(meta.filter((u) => u.pop_en_zone === null).map((u) => u.code)).toEqual(['GP', 'GF', 'YT']);
    expect(Number(meta.find((u) => u.code === 'FR')!.pop_en_zone)).toBeGreaterThan(60_000_000);
    expect(new Set(avant.map((u) => u.plateforme))).toEqual(new Set(QUATRE));

    const { data: ligne, error: e1 } = await sb.from('plateformes_geo').select('codes_pays').eq('plateforme', 'meta').eq('maille', 'pays').single();
    if (e1) throw new Error(e1.message);
    try {
      const maj = await sb.from('plateformes_geo').update({ codes_pays: { METRO: ['FR'], FR: ['FR'] } }).eq('plateforme', 'meta').eq('maille', 'pays');
      if (maj.error) throw new Error(maj.error.message);
      expect(await lire()).toEqual(avant);
    } finally {
      const retour = await sb.from('plateformes_geo').update({ codes_pays: ligne!.codes_pays }).eq('plateforme', 'meta').eq('maille', 'pays');
      if (retour.error) throw new Error(`codes_pays de Meta NON rétablis : ${retour.error.message}`);
    }
  }, LONG);

  it('France métropolitaine, DV360 au CP et Meta au pays : plan CP des 5 957 codes, Meta au pays (FR)', async () => {
    const zoneMetro = await creerZonePays('METRO', org);
    const id = await jeuSur(zoneMetro, 'Métropole CP et pays', [
      { plateforme: 'dv360', maille: 'cp', seuil: 20 }, { plateforme: 'meta', maille: 'pays', seuil: 0 },
    ]);
    const r = await extraireJeu(id);
    expect(r.status).toBe(201);
    const { id: x } = await r.json() as { id: string };
    const { data: e, error } = await sb.from('zone_set_extractions').select('n_cp').eq('id', x).single();
    if (error) throw new Error(error.message);
    expect(e!.n_cp).toBe(5957);  // C25 (E7) : 5 956 avant (29259 reçoit son premier carreau)
    const { data: u } = await sb.from('zone_set_extraction_unites').select('code').eq('extraction_id', x).eq('maille', 'pays');
    expect(u).toEqual([{ code: 'FR' }]);
    // A2 : le groupe de Saint-Denis (une unité, un multiplicateur) développé en ses trois codes, au MÊME multiplicateur ;
    // la population sur le seul canonique.
    const { data: sd, error: e2 } = await sb.from('zone_set_extraction_cp')
      .select('code_postal, multiplicateur, pop_en_zone').eq('extraction_id', x).eq('code_canonique', '93200').order('code_postal');
    if (e2) throw new Error(e2.message);
    expect(sd!.map((l) => l.code_postal)).toEqual(['93200', '93210', '93380']);
    expect(new Set(sd!.map((l) => Number(l.multiplicateur))).size).toBe(1);
    expect(Number(sd![0].multiplicateur)).toBeGreaterThan(0);
    expect(sd!.map((l) => l.pop_en_zone === null)).toEqual([false, true, true]);
  }, LONG);
});
