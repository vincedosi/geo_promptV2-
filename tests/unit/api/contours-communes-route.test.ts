import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `POST /api/zones/communes/contours` (lot 5, T8) — les contours d'une liste de communes pour la carte de ⑤.
 * Verrouillé : session → corps (borné, strict) → quota → RPC ; un corps refusé ne lit rien ; les codes sans contour
 * sont DITS (`manquants`) ; une erreur Postgres ne fuit pas.
 */
import { etat, reinitialiser } from './_doublures-route';

vi.mock('@/lib/api/middleware', () => import('./_doublures-route'));
vi.mock('@/lib/api/rate-limit', () => import('./_doublures-route'));
vi.mock('@/lib/auth', () => import('./_doublures-route'));
const { POST } = await import('@/app/api/zones/communes/contours/route');

const poster = (corps: unknown) => POST(new Request('http://localhost/api/zones/communes/contours', {
  method: 'POST', body: typeof corps === 'string' ? corps : JSON.stringify(corps), headers: { 'content-type': 'application/json' },
}) as never);

const codes = (n: number) => Array.from({ length: n }, (_, i) => String(10000 + i));

beforeEach(() => {
  reinitialiser();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('source', () => {
  it('requireAuth(, force-dynamic, le limiteur partagé de la couverture', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('app/api/zones/communes/contours/route.ts', 'utf8');
    expect(s).toContain('requireAuth(');
    expect(s).toContain("dynamic = 'force-dynamic'");
    expect(s).toContain('quotaCouverture(');
    expect(s).not.toMatch(/createQuota\(|createRateLimiter\(/);
  });
});

describe('refus avant la base', () => {
  it('401 / 403', async () => {
    etat.profil = null; expect((await poster({ codes: ['69381'] })).status).toBe(401);
    etat.profil = { id: 'u1', role: 'client', organization_id: null }; expect((await poster({ codes: ['69381'] })).status).toBe(403);
    expect(etat.rpcs).toEqual([]);
  });
  it.each([
    ['3 001 codes', { codes: codes(3001) }],
    ['liste vide', { codes: [] }],
    ['code mal formé', { codes: ['6938'] }],
    ['clé inconnue', { codes: ['69381'], geometrie: true }],
    ['corps illisible', '{pas du json'],
  ])('400 %s — sans jeton ni RPC', async (_n, corps) => {
    const r = await poster(corps);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/[a-zé]/);
    expect(etat.quotas).toEqual([]); expect(etat.rpcs).toEqual([]);
  });
  it('3 000 codes passent ; quota épuisé : 429 sans RPC', async () => {
    etat.reponses.contours_communes = { data: [], error: null };
    expect((await poster({ codes: codes(3000) })).status).toBe(200);
    etat.quotaOk = false;
    expect((await poster({ codes: ['69381'] })).status).toBe(429);
    expect(etat.rpcs).toHaveLength(1);
  });
});

describe('contours_communes', () => {
  it('200 : les contours, les codes dédoublonnés, et les codes sans contour dits', async () => {
    const lyon1 = { code: '69381', nom: 'Lyon 1er Arrondissement', geometry: { type: 'Polygon', coordinates: [] } };
    etat.reponses.contours_communes = { data: [lyon1], error: null };
    const r = await poster({ codes: ['69381', '69381', '99999'] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ communes: [lyon1], manquants: ['99999'] });
    expect(etat.rpcs).toEqual([{ nom: 'contours_communes', args: { p_codes: ['69381', '99999'], p_max: 3000 } }]);
    expect(etat.quotas).toEqual(['geo:rl:couverture:u1']);
  });
  it('erreur Postgres ou réponse hors contrat : 500 sans détail', async () => {
    etat.reponses.contours_communes = { data: null, error: { code: 'XX000', message: 'secret' } };
    const r = await poster({ codes: ['69381'] });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('secret');
    etat.reponses.contours_communes = { data: { refus: 'trop_de_communes', plafond: 3000 }, error: null };
    expect((await poster({ codes: ['69381'] })).status).toBe(500);
  });
});
