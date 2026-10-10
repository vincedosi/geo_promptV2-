/**
 * Lectures de TABLE qui se croyaient protégées par un `.limit(5000)` ou un
 * `.limit(100000)` « parce que PostgREST tronque à 5 000 ». Il tronque à
 * `db-max-rows` = 1 000 (`supabase/config.toml`), et aucun `.limit()` client
 * ne le lève. Mesuré le 2026-10-10 sur la base locale :
 *
 * - `custom_geo_zone_codes` : une zone porte 1 641 codes postaux, une autre
 *   9 834 IRIS. L'export CSV, l'export DV360 et les deux push DV360 n'en
 *   lisaient que 1 000 — un ciblage amputé poussé chez le DSP, sans erreur.
 * - `panneaux_affichage` : 1 434 lignes, `/api/admin/transport-stats` en
 *   comptait 1 000.
 *
 * Le faux client reproduit le plafond : chaque requête de table rend au plus
 * 1 000 lignes, quoi qu'on demande, en respectant `.range()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const MAX_ROWS = 1000;
let codesZone: string[] = [];
let panneaux: Record<string, unknown>[] = [];
const poussesGeo: number[][] = [];

function constructeur(table: string) {
  let de = 0;
  let a = Number.POSITIVE_INFINITY;
  let tete = false;
  let unique = false;
  const c: Record<string, unknown> = {};
  c.select = (_cols?: string, opts?: { head?: boolean }) => { tete = !!opts?.head; return c; };
  for (const m of ['eq', 'in', 'order', 'gte', 'lte']) c[m] = () => c;
  c.limit = (n: number) => { a = Math.min(a, de + n - 1); return c; };
  c.range = (x: number, y: number) => { de = x; a = y; return c; };
  c.single = () => { unique = true; return c; };
  c.maybeSingle = c.single;
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    let reponse: unknown;
    if (tete) reponse = { count: 0, data: null, error: null };
    else if (unique && table === 'custom_geo_zones') reponse = { data: { id: 'z', name: 'Zone', org_id: 'o' }, error: null };
    else if (unique && table === 'dsp_connections') reponse = { data: { auth_method: 'oauth' }, error: null };
    else {
      const source: unknown[] = table === 'custom_geo_zone_codes'
        ? codesZone.map((code) => ({ code }))
        : table === 'panneaux_affichage' ? panneaux : [];
      const fin = Math.min(a + 1, de + MAX_ROWS, source.length);
      reponse = { data: source.slice(de, Math.max(de, fin)), error: null };
    }
    return Promise.resolve(reponse).then(ok, ko);
  };
  return c;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from: (table: string) => constructeur(table),
    rpc: async () => ({ data: null, error: null }),
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u', organization_id: 'o' }),
  requireAdmin: async () => ({ id: 'u', organization_id: 'o' }),
  requireDspAccess: async () => ({ id: 'u', organization_id: 'o' }),
  authUnauthorized: () => new Response(null, { status: 401 }),
  adminUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/campaigns/access', () => ({ checkZoneAccess: async () => 'ok' }));
// Un geo ID par code postal : le test porte sur la lecture, pas sur le référentiel Google.
vi.mock('@/lib/digital/dv360-geo', () => ({
  GEO_POSTAL_FR_VERSION: 'test',
  mapPostalCodesToGeoIds: (codes: string[]) => ({
    mapped: codes.map((c, i) => ({ code_postal: c, geo_id: i + 1 })),
    unmapped: [],
    sdfString: codes.map((_, i) => i + 1).join(';'),
  }),
}));
vi.mock('@/lib/dsp/dv360/client', () => ({
  resolveAccessToken: async () => 'jeton',
  bulkAssignGeoRegions: async (_t: string, _a: string, _l: string, ids: number[]) => {
    poussesGeo.push(ids);
    return { updatedLineItemIds: ['1'], failedLineItemIds: [] };
  },
  createLocationList: async () => ({ locationListId: 'L1' }),
  bulkAddAssignedLocations: async (_t: string, _a: string, _l: string, ids: number[]) => {
    poussesGeo.push(ids);
    return { assignedCount: ids.length };
  },
}));
vi.mock('@/lib/dsp/logger', () => ({ logDspEvent: async () => undefined }));

const exportZone = await import('@/app/api/custom-geo/[id]/export/route');
const pushCiblage = await import('@/app/api/admin/dsp/dv360/targeting/push/route');
const pushListe = await import('@/app/api/admin/dsp/dv360/zones/push/route');

const cps = (n: number) => Array.from({ length: n }, (_, i) => String(10000 + i));
const ZONE = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  codesZone = [];
  panneaux = [];
  poussesGeo.length = 0;
});

describe('GET /api/custom-geo/[id]/export', () => {
  const appel = (format: string) => exportZone.GET(
    new NextRequest(`http://localhost/api/custom-geo/${ZONE}/export?format=${format}`),
    { params: Promise.resolve({ id: ZONE }) },
  );

  it('csv_cp : les 1 641 codes postaux de la zone, pas 1 000', async () => {
    codesZone = cps(1641);
    const lignes = (await (await appel('csv_cp')).text()).split('\n');
    expect(lignes[0]).toBe('code_postal');
    expect(lignes).toHaveLength(1642);
  });

  it('csv_iris : les 9 834 IRIS de la zone, pas 1 000', async () => {
    codesZone = cps(9834);
    const lignes = (await (await appel('csv_iris')).text()).split('\n');
    expect(lignes).toHaveLength(9835);
  });

  it('dv360_cp : un code postal par ligne, tous', async () => {
    codesZone = cps(1641);
    expect((await (await appel('dv360_cp')).text()).split('\n')).toHaveLength(1641);
  });
});

describe('POST /api/admin/dsp/dv360/*/push', () => {
  const corps = (extra: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ zone_id: ZONE, advertiser_id: '123', ...extra }),
  });

  it('targeting/push : pousse les 1 641 geo IDs, pas 1 000', async () => {
    codesZone = cps(1641);
    const res = await pushCiblage.POST(new NextRequest('http://localhost/x', corps({ line_item_id: '456' })));
    expect((await res.json()).pushed_geo_ids).toBe(1641);
    expect(poussesGeo[0]).toHaveLength(1641);
  });

  it('zones/push : la location list porte les 1 641 geo IDs, pas 1 000', async () => {
    codesZone = cps(1641);
    const res = await pushListe.POST(new NextRequest('http://localhost/x', corps({})));
    expect((await res.json()).assigned_count).toBe(1641);
  });
});
