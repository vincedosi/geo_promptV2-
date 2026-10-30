import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `GET /api/zones/[id]/typologies` (④ finitions, T4, arbitrage A-7) — les typologies DÉJÀ calculées des POI d'une zone,
 * en lecture pour tous : la route n'exige pas le super admin (le calcul d'un modèle, lui, le reste).
 *
 * Ce que ces tests verrouillent : l'ordre session → id → quota → sources → RPC ; l'espace et les sources passés à la
 * RPC sont ceux de la SESSION ; chaque refus a son statut et sa phrase ; une erreur Postgres ne fuit pas.
 */
const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';

import { ORG, etat, reinitialiser } from './_doublures-route';

const sessionsSources: unknown[][] = [];
vi.mock('@/lib/api/middleware', () => import('./_doublures-route'));
vi.mock('@/lib/api/rate-limit', () => import('./_doublures-route'));
vi.mock('@/lib/auth', () => import('./_doublures-route'));
vi.mock('@/lib/auth/getOrgSourceIds', () => ({
  getOrgSourceIds: async (s: unknown, o: unknown) => { sessionsSources.push([s, o]); return ['s1', 's2']; },
}));
vi.mock('@/lib/auth/perimetre-donnees', () => ({ indicateursVisiblesDeLaSession: async () => ({ visibles: new Set(), propres: new Set() }) }));
const { GET } = await import('@/app/api/zones/[id]/typologies/route');

const appel = (id: string) =>
  GET(new Request(`http://localhost/api/zones/${id}/typologies`) as never, { params: Promise.resolve({ id }) });

const LECTURE = {
  motif: null, tronque: false,
  modeles: [{ duree: 60, mode: 'drive', version: 4, typologies: [{ cluster_id: 1, label: 'Jeunes', n_poi: 1, population: 1000, profil: {} }] }],
  pois: [{ poi_id: 'p1', nom: 'CIRFA', lat: 48, lng: -2, categorie: 'cirfa', duree: 60, mode: 'drive', version: 4, cluster_id: 1, cluster_label: 'Jeunes', population: 1000 }],
};

beforeEach(() => {
  reinitialiser();
  sessionsSources.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('source de la route', () => {
  it('requireAuth(, force-dynamic, quota de la couverture, jamais le super admin ni une Map locale', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('app/api/zones/[id]/typologies/route.ts', 'utf8');
    expect(s).toContain('requireAuth(');
    expect(s).toContain("dynamic = 'force-dynamic'");
    expect(s).toContain('quotaCouverture(');
    expect(s).not.toMatch(/reserverAuSuperAdmin|super_admin/);
    expect(s).not.toContain('getUser(');
    expect(s).not.toMatch(/new Map\(/);
  });
});

describe('GET /api/zones/[id]/typologies', () => {
  it('401 sans session, rien en base', async () => {
    etat.profil = null;
    expect((await appel(ZONE)).status).toBe(401);
    expect(etat.rpcs).toEqual([]);
    expect(etat.quotas).toEqual([]);
  });

  it('id illisible → 404 `zone_introuvable`, sans jeton ni lecture', async () => {
    const res = await appel('pas-un-uuid');
    expect(res.status).toBe(404);
    expect((await res.json()).refus).toBe('zone_introuvable');
    expect(etat.quotas).toEqual([]);
    expect(etat.rpcs).toEqual([]);
  });

  it('429 quand le quota geo:rl:couverture est épuisé, avant toute lecture', async () => {
    etat.quotaOk = false;
    expect((await appel(ZONE)).status).toBe(429);
    expect(etat.quotas).toEqual([`geo:rl:couverture:u1`]);
    expect(etat.rpcs).toEqual([]);
    expect(sessionsSources).toEqual([]);
  });

  it('200 : l’espace et les sources de la SESSION (vue de l’espace), un compte client suffit', async () => {
    etat.reponses.typologies_de_zone = { data: LECTURE, error: null };
    const res = await appel(ZONE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(LECTURE);
    expect(etat.rpcs).toEqual([{ nom: 'typologies_de_zone', args: { p_zone: ZONE, p_org: ORG, p_sources: ['s1', 's2'] } }]);
    expect(sessionsSources).toEqual([[{ userId: 'u1', orgId: ORG, role: 'client' }, { vueEspace: true }]]);
  });

  it('zone d’un autre espace → 404 « Zone introuvable dans cet espace. »', async () => {
    etat.reponses.typologies_de_zone = { data: { refus: 'zone_introuvable' }, error: null };
    const res = await appel(ZONE);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' });
  });

  it('aucun POI typé → 200 avec le motif, la phrase est celle de l’écran (A-7)', async () => {
    etat.reponses.typologies_de_zone = { data: { motif: 'aucun_poi_type', tronque: false, modeles: [], pois: [] }, error: null };
    const res = await appel(ZONE);
    expect(res.status).toBe(200);
    expect((await res.json()).motif).toBe('aucun_poi_type');
  });

  it('erreur Postgres → 500 sans détail', async () => {
    etat.reponses.typologies_de_zone = { data: null, error: { message: 'relation secrète' } };
    const res = await appel(ZONE);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secrète');
  });
});
