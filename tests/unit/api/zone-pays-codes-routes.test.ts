/**
 * Une zone PAYS (sql/296) n'a pas de `custom_geo_zone_codes` : l'export par codes et le détail de
 * `/api/custom-geo/[id]` répondent 422 `zone_pays`, avec la phrase de ⑤, au lieu d'un fichier vide ou de « 0 code »
 * (④ finitions, relecture 1 du groupe A, point 2). Une autre zone garde sa réponse d'avant, sans la clé `recette`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { MESSAGE_ZONE_PAYS_PLATEFORMES } from '@/lib/zones/couverture';

const ZONE = '11111111-1111-4111-8111-111111111111';
let recette: unknown = null;
const lectures: string[] = [];

function constructeur(table: string) {
  lectures.push(table);
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'not', 'range', 'limit']) c[m] = () => c;
  let unique = false;
  c.single = () => { unique = true; return c; };
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(
    unique && table === 'custom_geo_zones'
      ? { data: { id: ZONE, name: 'Zone', org_id: 'o', feature_count_cp: 3, recette }, error: null }
      : table === 'custom_geo_zone_codes'
        ? { data: [{ code: '13001', code_type: 'cp' }], error: null }
        : { data: [], error: null },
  ).then(ok, ko);
  return c;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({ from: (t: string) => constructeur(t), rpc: async () => ({ data: null, error: null }) }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u', organization_id: 'o', role: 'client' }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/campaigns/access', () => ({ checkZoneAccess: async () => 'ok' }));

const exportZone = await import('@/app/api/custom-geo/[id]/export/route');
const detailZone = await import('@/app/api/custom-geo/[id]/route');
const ctx = { params: Promise.resolve({ id: ZONE }) };

beforeEach(() => {
  recette = null;
  lectures.length = 0;
});

describe('zone pays : export et détail refusés, en 422', () => {
  it.each(['csv_cp', 'csv_iris', 'tiktok_geo', 'dv360_cp'])('export %s → 422 `zone_pays`, sans lire un code', async (format) => {
    recette = { v: 1, type: 'pays', code: 'FR' };
    const res = await exportZone.GET(new NextRequest(`http://localhost/api/custom-geo/${ZONE}/export?format=${format}`), ctx);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: MESSAGE_ZONE_PAYS_PLATEFORMES, refus: 'zone_pays' });
    expect(lectures).not.toContain('custom_geo_zone_codes');
  });

  it('détail → 422 `zone_pays`', async () => {
    recette = { v: 1, type: 'pays', code: 'METRO' };
    const res = await detailZone.GET(new NextRequest(`http://localhost/api/custom-geo/${ZONE}`), ctx);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: MESSAGE_ZONE_PAYS_PLATEFORMES, refus: 'zone_pays' });
  });

  it('une autre zone : export servi, détail sans la clé `recette` (réponse d’avant)', async () => {
    recette = { v: 1, type: 'dessin' };
    const exp = await exportZone.GET(new NextRequest(`http://localhost/api/custom-geo/${ZONE}/export?format=csv_cp`), ctx);
    expect(exp.status).toBe(200);
    expect(await exp.text()).toContain('13001');
    const det = await detailZone.GET(new NextRequest(`http://localhost/api/custom-geo/${ZONE}`), ctx);
    expect(det.status).toBe(200);
    const corps = await det.json();
    expect(corps).not.toHaveProperty('recette');
    expect(corps.feature_count_cp).toBe(3);
  });
});
