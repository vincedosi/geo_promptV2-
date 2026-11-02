/**
 * B8, tour 3 (N-1) : `GET /api/custom-geo/[id]/export` ne sort AUCUN fichier DSP (DV360, script bidding, TikTok) pour
 * une zone de rayon sous 250 m, ni pour une combinaison qui en contient une (N-2) : 422 `rayon_non_activable`, avec le
 * message et la valeur, avant toute lecture de codes ou d'items — sinon le disque serait élargi en silence aux codes
 * postaux qu'il touche. Les exports d'analyse (CSV, GeoJSON) restent servis.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const ZONE = '11111111-1111-4111-8111-111111111111';
const FINE = '22222222-2222-4222-8222-222222222222';
const PER = { type: 'departement', code: '35' };
let recette: unknown = null;
const lectures: string[] = [];
const rpcs: string[] = [];

function constructeur(table: string) {
  lectures.push(table);
  const c: Record<string, unknown> = {};
  let unique = false;
  let parIds = false;
  for (const m of ['select', 'eq', 'order', 'not', 'range', 'limit']) c[m] = () => c;
  c.in = () => { parIds = true; return c; };
  c.single = () => { unique = true; return c; };
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(
    table === 'custom_geo_zones' && unique
      ? { data: { id: ZONE, name: 'Zone', org_id: 'o', recette }, error: null }
      : table === 'custom_geo_zones' && parIds
        ? { data: [{ id: FINE, name: 'Lycées 100 m', recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 100, perimetre: PER } }], error: null }
        : table === 'custom_geo_zone_codes'
          ? { data: [{ code: '35000', code_type: 'cp' }], error: null }
          : { data: [], error: null },
  ).then(ok, ko);
  return c;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({ from: (t: string) => constructeur(t), rpc: async (n: string) => { rpcs.push(n); return { data: null, error: null }; } }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u', organization_id: 'o', role: 'client' }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/campaigns/access', () => ({ checkZoneAccess: async () => 'ok' }));

const { GET } = await import('@/app/api/custom-geo/[id]/export/route');
const ctx = { params: Promise.resolve({ id: ZONE }) };
const exporter = (format: string, suite = '') => GET(new NextRequest(`http://localhost/api/custom-geo/${ZONE}/export?format=${format}${suite}`), ctx);
const DSP = ['dv360_cp', 'dv360_sdf', 'bidding_script', 'tiktok_geo'];

beforeEach(() => {
  recette = null;
  lectures.length = 0;
  rpcs.length = 0;
});

describe('export DSP d’une zone trop fine : refusé, jamais élargi au code postal', () => {
  it.each(DSP)('rayon POI de 100 m, %s → 422 avec la valeur, aucun code ni item lu', async (format) => {
    recette = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 100, perimetre: PER };
    const r = await exporter(format, format === 'tiktok_geo' || format === 'bidding_script' ? '&weights=%7B%22p%22%3A100%7D' : '');
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      error: 'Rayon de 100 m : trop fin pour être activé (minimum 250 m). Gardé pour l’analyse uniquement.', refus: 'rayon_non_activable',
    });
    expect(lectures).not.toContain('custom_geo_zone_codes');
    expect(rpcs).toEqual([]);
  });

  it.each(DSP)('combinaison qui contient une zone de 100 m, %s → 422 qui la nomme', async (format) => {
    recette = { v: 1, type: 'combinaison', operation: 'intersection', zones: [FINE, ZONE] };
    const r = await exporter(format);
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe('La zone « Lycées 100 m » (rayon de 100 m) est trop fine pour être activée (minimum 250 m) : '
      + 'cette combinaison est gardée pour l’analyse uniquement.');
  });

  it.each(['csv_cp', 'csv_iris'])('export d’analyse %s : servi (la zone reste à l’analyse)', async (format) => {
    recette = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 100, perimetre: PER };
    expect((await exporter(format)).status).toBe(200);
  });

  it('rayon POI de 250 m : dv360_cp servi', async () => {
    recette = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 250, perimetre: PER };
    expect((await exporter('dv360_cp')).status).toBe(200);
  });
});
