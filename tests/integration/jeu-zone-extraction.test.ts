/**
 * Les routes de conversion et d'extraction de ⑤ contre la vraie base locale (lot 5, T8) :
 * - `POST /api/zones/jeux/[id]/extractions` d'un jeu de ZONE (A-11, Review Focus 3) : DV360 au CP, Meta en cercles,
 *   TTD au polygone, TikTok à la commune → UNE extraction, plan CP dans `zone_set_extraction_cp` (classe `zone`),
 *   unités de chaque plateforme dans `zone_set_extraction_unites`, `forme` copiée, quatre résumés ; rejouée →
 *   `deja_extraite` ; des unités envoyées par le client → 400, rien d'écrit ;
 * - `GET /api/zones/[id]/cercles` : la borne de rayon LUE dans `plateformes_geo` (400), la zone d'un autre espace (404) ;
 * - `POST /api/zones/communes/contours` : deux codes → deux géométries.
 *
 * Seuls l'appelant et les quotas sont simulés (429 prouvés en unitaire). Deux espaces `[ESSAI lot5 T8]` sont créés
 * puis supprimés ; jeux, extractions et zones partent avec eux.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';

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
    expect(resumes.find((p) => p.plateforme === 'ttd')?.exacte).toBe(true);

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
    expect(de('ttd')).toEqual([{ plateforme: 'ttd', maille: 'polygone', code: null, centre: null, rayon_m: null, retenu: true }]);
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
    expect((await r.json()).extractions.map((e: { id: string }) => e.id)).toEqual([extraction]);
  });
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
