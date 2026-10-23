import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `GET /api/zones/[id]/croisements` (lot 4, T13) — les émetteurs radio et les comptages routiers d'une zone
 * (`croisements_zone`, sql/273). Verrouille : l'ordre session → id → quota → RPC ; le quota `geo:rl:couverture`
 * PARTAGÉ avec T6 (un seul limiteur, déclaré dans `lib/zones/couverture.ts`) ; l'espace pris dans la session ; les
 * statuts communs de `repondreCouverture`.
 */
const AUTRE_ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3399';
const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';

import { ORG, etat, reinitialiser } from './_doublures-route';

vi.mock('@/lib/api/middleware', () => import('./_doublures-route'));
vi.mock('@/lib/api/rate-limit', () => import('./_doublures-route'));
vi.mock('@/lib/auth', () => import('./_doublures-route'));
const { GET } = await import('@/app/api/zones/[id]/croisements/route');
await import('@/app/api/zones/[id]/couverture/route');

const appel = (id: string, query = '', entetes: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/zones/${id}/croisements${query}`, { headers: entetes }) as never, { params: Promise.resolve({ id }) });

const CROISEMENTS = {
  radio: { n_emetteurs: 1, n_sans_rayon: 0, tronque: false, emetteurs: [{ site: '0130600060', lieu: null, stations: ['France Inter'] }] },
  trafic: { n_comptages: 0, tmja_max: null, tmja_median: null, tronque: false, comptages: [] },
};

beforeEach(() => {
  reinitialiser();
  etat.reponses.croisements_zone = { data: CROISEMENTS, error: null };
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
    expect(etat.limiteurs.filter((l) => l.prefix === 'geo:rl:couverture')).toEqual([{ max: 6, window: '60 s', prefix: 'geo:rl:couverture' }]);
    await appel(ZONE);
    expect(etat.quotas).toEqual(['geo:rl:couverture:u1']);
  });
});

describe('ordre et réponses', () => {
  it('sans profil 401, sans espace 403, id non UUID 404 : ni jeton ni RPC', async () => {
    etat.profil = null; expect((await appel(ZONE)).status).toBe(401);
    etat.profil = { id: 'u1', role: 'client', organization_id: null }; expect((await appel(ZONE)).status).toBe(403);
    etat.profil = { id: 'u1', role: 'client', organization_id: ORG }; expect((await appel('pas-un-uuid')).status).toBe(404);
    expect(etat.rpcs).toEqual([]); expect(etat.quotas).toEqual([]);
  });
  it('quota épuisé : 429, aucune RPC', async () => {
    etat.quotaOk = false;
    expect((await appel(ZONE)).status).toBe(429);
    expect(etat.rpcs).toEqual([]);
  });
  it('200 : la réponse telle quelle ; l’espace vient de la session, jamais du client', async () => {
    const r = await appel(ZONE, `?org_id=${AUTRE_ORG}`, { 'x-org-id': AUTRE_ORG });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(CROISEMENTS);
    expect(etat.rpcs).toEqual([{ nom: 'croisements_zone', args: { p_zone_id: ZONE, p_org_id: ORG } }]);
  });
  it('zone_introuvable → 404 et le message de T6', async () => {
    etat.reponses.croisements_zone = { data: { refus: 'zone_introuvable' }, error: null };
    const r = await appel(ZONE);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' });
  });
  it('erreur Postgres ou refus hors contrat : 500 sans détail', async () => {
    etat.reponses.croisements_zone = { data: null, error: { code: 'XX000', message: 'secret' } };
    const r = await appel(ZONE);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Lecture de la radio et du trafic impossible.' });
    etat.reponses.croisements_zone = { data: { refus: 'cible_inconnue' }, error: null };
    expect((await appel(ZONE)).status).toBe(500);
  });
});
