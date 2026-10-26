/**
 * `GET /api/zones/jeux/[id]/extractions/[version]/fichier` (lot 7, T2, A-6 ; E5), contre la vraie base locale, sur
 * l'extraction v1 du jeu de zone de la preuve du lot 6 (« Lycées 5 km — BdR », BMW GROUP : DV360 au CP, Meta en
 * cercles, TikTok au département, TTD en polygone) et sur le jeu risque de référence (A-4). Lecture seule : rien
 * n'est écrit. Seuls l'appelant et le quota sont simulés.
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
// Pour son effet : il charge l'environnement de la base LOCALE (`.env.development.local` d'abord).
import './_client';

const appelant = vi.hoisted(() => ({ org: '' }));
vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: '00000000-0000-4000-8000-0000000007a2', role: 'super_admin', organization_id: appelant.org }),
}));
vi.mock('@/lib/api/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit')>()),
  createRateLimiter: () => async () => ({ ok: true, retrySec: 0 }),
}));

const fichier = await import('@/app/api/zones/jeux/[id]/extractions/[version]/fichier/route');
const cpExtraction = await import('@/app/api/zones/jeux/[id]/extractions/[version]/cp/route');

const JEU = '66061937-e638-4ef0-a99e-23ed91740cd1';
const ORG_JEU = 'e2de7178-fff0-417e-baa1-11588178f738';
const JEU_RISQUE = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';
const ORG_RISQUE = '00000000-0000-0000-0000-000000000001';
const LONG = 60_000;

const lire = (id: string, version: number, plateforme: string, format: string) => fichier.GET(
  new NextRequest(`http://localhost/api/zones/jeux/${id}/extractions/${version}/fichier?plateforme=${plateforme}&format=${format}`),
  { params: Promise.resolve({ id, version: String(version) }) },
);
const lignesDonnees = (texte: string) =>
  texte.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0 && !l.startsWith('#'));
const totalCp = async (id: string, plateforme: string) => ((await (await cpExtraction.GET(
  new NextRequest(`http://localhost/api/zones/jeux/${id}/extractions/1/cp?plateforme=${plateforme}`),
  { params: Promise.resolve({ id, version: '1' }) },
)).json()) as { total: number }).total;

describe('fichier par plateforme — extraction v1 du jeu de zone BdR', () => {
  it('DV360 `cp` : autant de lignes que …/cp?plateforme=dv360, nom de fichier normé', async () => {
    appelant.org = ORG_JEU;
    const r = await lire(JEU, 1, 'dv360', 'cp');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="extraction_lycees-5-km-bdr-preuve-l6-t7_v1_dv360_cp.txt"');
    const n = await totalCp(JEU, 'dv360');
    expect(n).toBeGreaterThan(0);
    expect((await r.text()).split('\n')).toHaveLength(n);
  }, LONG);

  it('DV360 `sdf` : « Geography Targeting - Include »', async () => {
    appelant.org = ORG_JEU;
    const r = await lire(JEU, 1, 'dv360', 'sdf');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Geography Targeting - Include');
  }, LONG);

  it('Meta `cercles` : 53 lignes de données (CSV à BOM), lat/lon à 6 décimales, rayon 5 km', async () => {
    appelant.org = ORG_JEU;
    const r = await lire(JEU, 1, 'meta', 'cercles');
    expect(r.status).toBe(200);
    const texte = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer());
    expect(texte.charCodeAt(0)).toBe(0xfeff);
    const [entete, ...donnees] = lignesDonnees(texte);
    expect(entete).toBe('nom;latitude;longitude;rayon_km');
    expect(donnees).toHaveLength(53);
    for (const l of donnees) expect(l).toMatch(/^[^;]+;\d+\.\d{6};\d+\.\d{6};5$/);
  }, LONG);

  it('TikTok `territoires` : 1 ligne (13)', async () => {
    appelant.org = ORG_JEU;
    const r = await lire(JEU, 1, 'tiktok', 'territoires');
    expect(r.status).toBe(200);
    const [entete, ...donnees] = lignesDonnees(await r.text());
    expect(entete).toBe('code;nom');
    expect(donnees).toHaveLength(1);
    expect(donnees[0].startsWith('13;')).toBe(true);
  }, LONG);

  it('TTD `polygone` : GeoJSON valide, une Feature multipolygone', async () => {
    appelant.org = ORG_JEU;
    const r = await lire(JEU, 1, 'ttd', 'polygone');
    expect(r.status).toBe(200);
    const gj = JSON.parse(await r.text());
    expect(gj.type).toBe('FeatureCollection');
    expect(gj.features).toHaveLength(1);
    expect(gj.features[0].geometry.type).toBe('MultiPolygon');
    expect(gj.features[0].properties.methode).toMatchObject({ plateforme: 'ttd', maille: 'polygone', version: 1 });
  }, LONG);

  it('Meta `cp` → 400 ; format inconnu → 400 ; autre espace → 404 ; version 99 → 404', async () => {
    appelant.org = ORG_JEU;
    const r = await lire(JEU, 1, 'meta', 'cp');
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('La plateforme meta n\'achète pas au code postal dans cette extraction.');
    expect((await lire(JEU, 1, 'meta', 'xlsx')).status).toBe(400);
    expect((await lire(JEU, 99, 'dv360', 'cp')).status).toBe(404);
    appelant.org = ORG_RISQUE;
    expect((await lire(JEU, 1, 'dv360', 'cp')).status).toBe(404);
  }, LONG);
});

describe('fichier par plateforme — jeu RISQUE (A-4)', () => {
  it('DV360 et TTD au CP : le plan entier ; Meta → 400', async () => {
    appelant.org = ORG_RISQUE;
    const n = await totalCp(JEU_RISQUE, 'dv360');
    expect(n).toBeGreaterThan(0);
    const dv = await lire(JEU_RISQUE, 1, 'dv360', 'cp');
    expect(dv.status).toBe(200);
    expect((await dv.text()).split('\n')).toHaveLength(n);
    const ttd = await lire(JEU_RISQUE, 1, 'ttd', 'cp');
    expect(ttd.status).toBe(200);
    expect(lignesDonnees(await ttd.text())).toHaveLength(n + 1);
    expect((await lire(JEU_RISQUE, 1, 'meta', 'cp')).status).toBe(400);
  }, LONG);
});
