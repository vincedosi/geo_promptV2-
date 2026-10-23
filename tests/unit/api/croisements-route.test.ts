import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `GET /api/zones/[id]/croisements` (lot 4, T13) — les émetteurs radio et les comptages routiers d'une zone
 * (`croisements_zone`, sql/273). Verrouille : l'ordre session → id → quota → RPC ; le quota `geo:rl:couverture`
 * PARTAGÉ avec T6 (un seul limiteur, déclaré dans `lib/zones/couverture.ts`) ; l'espace pris dans la session ; les
 * statuts communs de `repondreCouverture`.
 */
type Profil = { id: string; role: string; organization_id: string | null } | null;
const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const AUTRE_ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3399';
const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';

let profil: Profil = { id: 'u1', role: 'client', organization_id: ORG };
vi.mock('@/lib/api/middleware', () => ({ requireAuth: async () => profil }));
let quotaOk = true;
const quotas: string[] = [];
const limiteurs: { prefix: string }[] = [];
vi.mock('@/lib/api/rate-limit', () => ({
  createRateLimiter: (o: { prefix: string }) => {
    limiteurs.push(o);
    return async (cle: string) => { quotas.push(`${o.prefix}:${cle}`); return quotaOk ? { ok: true, retrySec: 0 } : { ok: false, retrySec: 30 }; };
  },
  rateLimitResponse: (s: number) => new Response(JSON.stringify({ error: 'Trop de requêtes.' }), { status: 429, headers: { 'Retry-After': String(s) } }),
}));
const rpcs: { nom: string; args: Record<string, unknown> }[] = [];
let reponse: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc(nom: string, args: Record<string, unknown>) { rpcs.push({ nom, args }); return Promise.resolve(reponse); },
  }),
}));

const { GET } = await import('@/app/api/zones/[id]/croisements/route');
await import('@/app/api/zones/[id]/couverture/route');

const appel = (id: string, query = '', entetes: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/zones/${id}/croisements${query}`, { headers: entetes }) as never, { params: Promise.resolve({ id }) });

const CROISEMENTS = {
  radio: { n_emetteurs: 1, n_sans_rayon: 0, tronque: false, emetteurs: [{ site: '0130600060', commune: null, frequence_mhz: 87.5, puissance_w: null, stations: ['France Inter'] }] },
  trafic: { n_comptages: 0, tmja_max: null, tmja_median: null, tronque: false, comptages: [] },
};

beforeEach(() => {
  profil = { id: 'u1', role: 'client', organization_id: ORG }; quotaOk = true;
  rpcs.length = 0; quotas.length = 0; reponse = { data: CROISEMENTS, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('source et quota', () => {
  it('garde requireAuth(, force-dynamic, jamais getUser ni Map locale ni limiteur propre', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('app/api/zones/[id]/croisements/route.ts', 'utf8');
    expect(s).toContain('requireAuth(');
    expect(s).toContain("dynamic = 'force-dynamic'");
    expect(s).not.toContain('getUser(');
    expect(s).not.toMatch(/new Map\(|createRateLimiter\(/);
  });
  it('UN limiteur geo:rl:couverture, 6 / 60 s, pour T6 et T13 : la clé est le compte', async () => {
    expect(limiteurs.filter((l) => l.prefix === 'geo:rl:couverture')).toEqual([{ max: 6, window: '60 s', prefix: 'geo:rl:couverture' }]);
    await appel(ZONE);
    expect(quotas).toEqual(['geo:rl:couverture:u1']);
  });
});

describe('ordre et réponses', () => {
  it('sans profil 401, sans espace 403, id non UUID 400 : ni jeton ni RPC', async () => {
    profil = null; expect((await appel(ZONE)).status).toBe(401);
    profil = { id: 'u1', role: 'client', organization_id: null }; expect((await appel(ZONE)).status).toBe(403);
    profil = { id: 'u1', role: 'client', organization_id: ORG }; expect((await appel('pas-un-uuid')).status).toBe(400);
    expect(rpcs).toEqual([]); expect(quotas).toEqual([]);
  });
  it('quota épuisé : 429, aucune RPC', async () => {
    quotaOk = false;
    expect((await appel(ZONE)).status).toBe(429);
    expect(rpcs).toEqual([]);
  });
  it('200 : la réponse telle quelle ; l’espace vient de la session, jamais du client', async () => {
    const r = await appel(ZONE, `?org_id=${AUTRE_ORG}`, { 'x-org-id': AUTRE_ORG });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(CROISEMENTS);
    expect(rpcs).toEqual([{ nom: 'croisements_zone', args: { p_zone_id: ZONE, p_org_id: ORG } }]);
  });
  it('zone_introuvable → 404 et le message de T6', async () => {
    reponse = { data: { refus: 'zone_introuvable' }, error: null };
    const r = await appel(ZONE);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Cette zone n’existe pas dans cet espace.', refus: 'zone_introuvable' });
  });
  it('erreur Postgres ou refus hors contrat : 500 sans détail', async () => {
    reponse = { data: null, error: { code: 'XX000', message: 'secret' } };
    const r = await appel(ZONE);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Lecture de la radio et du trafic impossible.' });
    reponse = { data: { refus: 'cible_inconnue' }, error: null };
    expect((await appel(ZONE)).status).toBe(500);
  });
});
