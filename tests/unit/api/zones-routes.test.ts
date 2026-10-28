import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Routes des zones à recette (spec carte-en-parcours § 16 ; Review Focus 2, 4, 5) :
 * `POST /api/zones/apercu`, `POST /api/zones`, `POST /api/zones/[id]/recalculer`.
 *
 * Ce que ces tests verrouillent, au-delà des statuts :
 * - l'ordre : corps validé et quota consommé AVANT toute lecture (`getOrgSourceIds`) ;
 * - une recette recalculable ne transmet JAMAIS de géométrie cliente à l'exécuteur (Review Focus 4) ;
 * - une zone citée par un plan est refusée AVANT tout calcul (I3, Review Focus 2) ;
 * - la zone s'écrit dans l'espace ACTIF, et un échec de résolution des codes rend 207 (Review Focus 5).
 */
type Profil = { id: string; role: string; organization_id: string | null } | null;
let profil: Profil = { id: 'u1', role: 'super_admin', organization_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' };
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => profil,
  authUnauthorized: () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
}));
const sessionsSources: unknown[] = [];
vi.mock('@/lib/auth/getOrgSourceIds', () => ({ getOrgSourceIds: async (s: unknown, o: unknown) => { sessionsSources.push([s, o]); return ['s1']; } }));
const sessionsIndicateurs: unknown[] = [];
const VISIBLES = new Set(['taux_pauvrete']);
vi.mock('@/lib/auth/perimetre-donnees', () => ({
  indicateursVisiblesDeLaSession: async (s: unknown) => { sessionsIndicateurs.push(s); return { visibles: VISIBLES, propres: new Set() }; },
}));
let quotaOk = true;
const quotas: string[] = [];
vi.mock('@/lib/api/rate-limit', () => ({
  createQuota: () => async (cle: string) => {
    quotas.push(cle);
    return quotaOk ? null : new Response(JSON.stringify({ error: 'Trop de requêtes.' }), { status: 429, headers: { 'Retry-After': '30' } });
  },
}));
const CARRE = { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]]] };
let issue: unknown = { ok: true, geometry: CARRE, surface_km2: 3, compte: 4, part_retenue: 1, population: null };
const executions: { recette: unknown; ctx: unknown }[] = [];
vi.mock('@/lib/zones/executer-recette', () => ({
  executerRecette: async (_s: unknown, recette: unknown, ctx: unknown) => { executions.push({ recette, ctx }); return issue; },
}));
const rpcs: { nom: string; args: Record<string, unknown> }[] = [];
let reponsesRpc: Record<string, { data: unknown; error: unknown }> = {};
let zoneLue: unknown = null;
const lectures: { table: string; filtres: [string, unknown][] }[] = [];
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc(nom: string, args: Record<string, unknown>) { rpcs.push({ nom, args }); return Promise.resolve(reponsesRpc[nom] ?? { data: null, error: null }); },
    from(table: string) {
      const l = { table, filtres: [] as [string, unknown][] };
      lectures.push(l);
      const c = {
        select() { return c; },
        eq(col: string, v: unknown) { l.filtres.push([col, v]); return c; },
        maybeSingle() { return Promise.resolve({ data: zoneLue, error: null }); },
      };
      return c;
    },
  }),
}));

const { POST: apercu } = await import('@/app/api/zones/apercu/route');
const { POST: ecrire } = await import('@/app/api/zones/route');
const { POST: recalculer } = await import('@/app/api/zones/[id]/recalculer/route');

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';
const req = (corps: unknown) => new Request('http://localhost/api/zones', { method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } }) as never;
const RAYON = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'departement', code: '13' } };
const POLYGONE = { type: 'Polygon', coordinates: [[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43]]] };

beforeEach(() => {
  profil = { id: 'u1', role: 'super_admin', organization_id: ORG }; quotaOk = true;
  issue = { ok: true, geometry: CARRE, surface_km2: 3, compte: 4, part_retenue: 1, population: null };
  executions.length = 0; rpcs.length = 0; reponsesRpc = {}; zoneLue = null; sessionsSources.length = 0;
  quotas.length = 0; lectures.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('garde des trois routes', () => {
  it('chaque source appelle requireAuth( — reconnu par routes-publiques.test.ts, middleware.ts intouché', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['app/api/zones/apercu/route.ts', 'app/api/zones/route.ts', 'app/api/zones/[id]/recalculer/route.ts']) {
      const source = readFileSync(f, 'utf8');
      expect(source, f).toContain('requireAuth(');
      expect(source, f).toContain("dynamic = 'force-dynamic'");
      expect(source, f).not.toMatch(/request\.json\(\)|req\.json\(\)/);
    }
  });
  it('GET /api/custom-geo/list rend la recette de chaque zone (null pour une zone d’avant le lot)', async () => {
    const { readFileSync } = await import('node:fs');
    const select = readFileSync('app/api/custom-geo/list/route.ts', 'utf8').match(/\.select\('([^']+)'\)/);
    expect(select?.[1].split(',').map((c) => c.trim())).toContain('recette');
  });
  it('UN limiteur partagé : 12 / 60 s / compte, préfixe geo:rl:zones', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('lib/zones/session-zones.ts', 'utf8');
    expect(s).toMatch(/createQuota\(\{\s*max:\s*12,\s*window:\s*'60 s',\s*prefix:\s*'geo:rl:zones'\s*\}\)/);
    expect(s.match(/createQuota\(/g)).toHaveLength(1);
    for (const f of ['app/api/zones/apercu/route.ts', 'app/api/zones/route.ts', 'app/api/zones/[id]/recalculer/route.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/createQuota\(|createRateLimiter\(/);
    }
  });
});

describe('POST /api/zones/apercu', () => {
  it('exécute la recette dans l’espace ACTIF avec ses sources (vue espace)', async () => {
    const res = await apercu(req({ recette: RAYON }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ geometry: CARRE, surface_km2: 3, compte: 4, part_retenue: 1, population: null });
    expect(executions[0].ctx).toStrictEqual({ orgId: ORG, sources: ['s1'] });
    expect(sessionsSources[0]).toEqual([{ userId: 'u1', orgId: ORG, role: 'super_admin' }, { vueEspace: true }]);
    expect(quotas).toEqual(['u1']);
  });
  it('recette recalculable + géométrie cliente : l’exécuteur ne reçoit AUCUNE géométrie (Review Focus 4)', async () => {
    await apercu(req({ recette: RAYON, geometrie: POLYGONE }));
    expect(executions[0].ctx).not.toHaveProperty('geometrie');
  });
  it('recette figée : la géométrie fournie passe à l’exécuteur — sans lire les sources, que seul le rayon POI emploie', async () => {
    await apercu(req({ recette: { v: 1, type: 'dessin' }, geometrie: POLYGONE }));
    expect(executions[0].ctx).toStrictEqual({ orgId: ORG, sources: [], geometrie: POLYGONE });
    expect(sessionsSources).toEqual([]);
  });
  it('les sources de POI ne sont lues que pour un rayon autour des POI ; les indicateurs, que pour un seuil sur territoires', async () => {
    const SEUIL = { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type: 'departement', code: '13' } };
    sessionsIndicateurs.length = 0;
    await apercu(req({ recette: SEUIL }));
    await apercu(req({ recette: { v: 1, type: 'codes_postaux', codes: ['13001'] } }));
    expect(sessionsSources).toEqual([]);
    expect(sessionsIndicateurs).toEqual([{ userId: 'u1', orgId: ORG, role: 'super_admin' }]);
    expect(executions.map((e) => e.ctx)).toStrictEqual([{ orgId: ORG, sources: [], indicateurs: VISIBLES }, { orgId: ORG, sources: [] }]);
    await apercu(req({ recette: RAYON }));
    expect(sessionsSources).toHaveLength(1);
  });
  it('une combinaison est calculée par le serveur : aucune géométrie cliente ne passe', async () => {
    const A = '3f2504e0-4f89-11d3-9a0c-0305e82c3311';
    const B = '3f2504e0-4f89-11d3-9a0c-0305e82c3312';
    await apercu(req({ recette: { v: 1, type: 'combinaison', operation: 'union', zones: [A, B] }, geometrie: POLYGONE }));
    expect(executions[0].ctx).not.toHaveProperty('geometrie');
  });
  it('sans profil : 401 ; sans espace : 403 ; recette invalide : 400 français — sans quota ni lecture', async () => {
    profil = null; expect((await apercu(req({ recette: RAYON }))).status).toBe(401);
    profil = { id: 'u1', role: 'client', organization_id: null }; expect((await apercu(req({ recette: RAYON }))).status).toBe(403);
    profil = { id: 'u1', role: 'client', organization_id: ORG };
    const r = await apercu(req({ recette: { v: 1, type: 'pluie' } }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/^Recette invalide/);
    expect(executions).toEqual([]);
    expect(quotas).toEqual([]);
    expect(sessionsSources).toEqual([]);
  });
  it('corps illisible ou clé inconnue : 400', async () => {
    const brut = new Request('http://localhost/api/zones/apercu', { method: 'POST', body: '{pas du json' }) as never;
    expect((await apercu(brut)).status).toBe(400);
    expect((await apercu(req({ recette: RAYON, intrus: 1 }))).status).toBe(400);
    expect(executions).toEqual([]);
  });
  it('un refus de l’exécuteur passe tel quel (422, message, refus)', async () => {
    issue = { ok: false, statut: 422, refus: 'trop_de_carreaux', message: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.' };
    const r = await apercu(req({ recette: RAYON }));
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.', refus: 'trop_de_carreaux' });
  });
  it('un échec sans refus (500) ne porte pas de clé refus', async () => {
    issue = { ok: false, statut: 500, refus: null, message: 'Calcul de la zone impossible.' };
    const r = await apercu(req({ recette: RAYON }));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Calcul de la zone impossible.' });
  });
  it('quota épuisé : 429, AUCUNE lecture des sources ni exécution', async () => {
    quotaOk = false;
    expect((await apercu(req({ recette: RAYON }))).status).toBe(429);
    expect(sessionsSources).toEqual([]);
    expect(executions).toEqual([]);
  });
});

describe('POST /api/zones', () => {
  it('ré-exécute la recette, écrit dans l’espace actif, puis résout les codes', async () => {
    reponsesRpc.creer_zone_recette = { data: { id: ZONE }, error: null };
    reponsesRpc.resolve_custom_geo_zone_codes = { data: { count_cp: 12, count_iris: 30 }, error: null };
    const res = await ecrire(req({ nom: 'Lycées 13', recette: RAYON, geometrie: { type: 'Polygon', coordinates: [] } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ zone_id: ZONE, count_cp: 12, count_iris: 30, surface_km2: 3 });
    expect(executions[0].ctx).not.toHaveProperty('geometrie');
    expect(rpcs[0]).toEqual({ nom: 'creer_zone_recette', args: {
      p_nom: 'Lycées 13', p_org_id: ORG, p_cree_par: 'u1', p_recette: RAYON, p_geometry_geojson: JSON.stringify(CARRE),
    } });
    expect(rpcs[1]).toEqual({ nom: 'resolve_custom_geo_zone_codes', args: { p_zone_id: ZONE, p_caller_user_id: 'u1' } });
  });
  it('la recette écrite est celle que le schéma a NORMALISÉE (UUID en minuscules)', async () => {
    reponsesRpc.creer_zone_recette = { data: { id: ZONE }, error: null };
    const recette = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'zone', code: ZONE.toUpperCase() } };
    await ecrire(req({ nom: 'Z', recette }));
    expect((rpcs[0].args.p_recette as { perimetre: { code: string } }).perimetre.code).toBe(ZONE);
  });
  it('résolution en échec (délai, accès) : 207, la zone est créée', async () => {
    reponsesRpc.creer_zone_recette = { data: { id: ZONE }, error: null };
    reponsesRpc.resolve_custom_geo_zone_codes = { data: null, error: { message: 'Access denied to zone' } };
    const res = await ecrire(req({ nom: 'Z', recette: RAYON }));
    expect(res.status).toBe(207);
    expect(await res.json()).toEqual({ zone_id: ZONE, warning: 'codes_non_resolus', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' });
  });
  it('creer_zone_recette refuse (zone citée hors espace) : 422 français, ni écriture ni résolution', async () => {
    reponsesRpc.creer_zone_recette = { data: { refus: 'perimetre_inconnu' }, error: null };
    const r = await ecrire(req({ nom: 'Z', recette: RAYON }));
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: 'Le périmètre de l’étape ① est introuvable ou n’appartient pas à cet espace.', refus: 'perimetre_inconnu' });
    expect(rpcs.map((c) => c.nom)).toEqual(['creer_zone_recette']);
  });
  it('creer_zone_recette rend une réponse hors contrat ou une erreur : 500 sans détail Postgres', async () => {
    reponsesRpc.creer_zone_recette = { data: { refus: 'inconnu_au_bataillon' }, error: null };
    expect((await ecrire(req({ nom: 'Z', recette: RAYON }))).status).toBe(500);
    reponsesRpc.creer_zone_recette = { data: null, error: { message: 'violates check constraint "custom_geo_zones_recette_check"' } };
    const r = await ecrire(req({ nom: 'Z', recette: RAYON }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('constraint');
  });
  it('un refus de l’exécuteur : rien n’est écrit', async () => {
    issue = { ok: false, statut: 422, refus: 'perimetre_trop_grand', message: 'Le périmètre est trop grand pour ce calcul : resserrez-le à l’étape ①.' };
    expect((await ecrire(req({ nom: 'Z', recette: RAYON }))).status).toBe(422);
    expect(rpcs).toEqual([]);
  });
  it('nom vide : 400, rien d’exécuté', async () => {
    expect((await ecrire(req({ nom: '', recette: RAYON }))).status).toBe(400);
    expect((await ecrire(req({ nom: '   ', recette: RAYON }))).status).toBe(400);
    expect(executions).toEqual([]);
    expect(quotas).toEqual([]);
  });
});

describe('POST /api/zones/[id]/recalculer', () => {
  const appel = (id = ZONE) => recalculer(new Request(`http://localhost/api/zones/${id}/recalculer`, { method: 'POST' }) as never, { params: Promise.resolve({ id }) });
  it('zone introuvable dans l’espace : 404 — la lecture est bornée à l’espace actif', async () => {
    zoneLue = null;
    const r = await appel();
    expect(r.status).toBe(404);
    expect((await r.json()).refus).toBe('zone_introuvable');
    expect(lectures[0]).toEqual({ table: 'custom_geo_zones', filtres: [['id', ZONE], ['org_id', ORG]] });
  });
  it('recette stockée illisible : 409 forme_figee, et l’anomalie est journalisée', async () => {
    const erreurs = vi.mocked(console.error);
    zoneLue = { id: ZONE, recette: { v: 1, type: 'rayon_poi', rayon_m: 'cinq' } };
    const r = await appel();
    expect(r.status).toBe(409);
    expect((await r.json()).refus).toBe('forme_figee');
    expect(erreurs.mock.calls.some((c) => String(c[0]).includes('[zones/recalculer]') && String(c[0]).includes('illisible'))).toBe(true);
  });
  it('forme figée (recette null, dessin ou combinaison) : 409 forme_figee, rien d’exécuté', async () => {
    const A = '3f2504e0-4f89-11d3-9a0c-0305e82c3311';
    const B = '3f2504e0-4f89-11d3-9a0c-0305e82c3312';
    for (const recette of [null, { v: 1, type: 'dessin' }, { v: 1, type: 'combinaison', operation: 'union', zones: [A, B] }]) {
      zoneLue = { id: ZONE, recette };
      const r = await appel();
      expect(r.status).toBe(409);
      expect((await r.json()).refus).toBe('forme_figee');
    }
    expect(executions).toEqual([]);
    expect(rpcs).toEqual([]);
  });
  it('zone citée par un plan : 409 AVANT tout calcul (I3) — aucune exécution, aucun remplacement', async () => {
    zoneLue = { id: ZONE, recette: RAYON };
    reponsesRpc.zone_referencee = { data: 'strategie', error: null };
    const r = await appel();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'Cette zone est utilisée par un plan, un jeu de zones ou une autre zone : elle ne peut pas être recalculée.', refus: 'zone_referencee', par: 'strategie' });
    expect(executions).toEqual([]);
    expect(sessionsSources).toEqual([]);
    expect(rpcs.map((c) => c.nom)).toEqual(['zone_referencee']);
  });
  it('citée par un composite : le message ne dit jamais « composite »', async () => {
    zoneLue = { id: ZONE, recette: RAYON };
    reponsesRpc.zone_referencee = { data: 'composite', error: null };
    const r = await appel();
    expect(r.status).toBe(409);
    expect((await r.json()).error).not.toMatch(/composite/i);
  });
  it('citée PENDANT le calcul (course) : le refus sous verrou de remplacer_geometrie_zone passe aussi en 409', async () => {
    zoneLue = { id: ZONE, recette: RAYON };
    reponsesRpc.zone_referencee = { data: null, error: null };
    reponsesRpc.remplacer_geometrie_zone = { data: { refus: 'zone_referencee', par: 'jeu_de_zones' }, error: null };
    const r = await appel();
    expect(r.status).toBe(409);
    expect((await r.json()).par).toBe('jeu_de_zones');
  });
  it('zone libre : remplacée dans l’espace actif, recalculée SANS géométrie cliente, puis résolue', async () => {
    zoneLue = { id: ZONE, recette: RAYON };
    reponsesRpc.zone_referencee = { data: null, error: null };
    reponsesRpc.remplacer_geometrie_zone = { data: { remplace: true }, error: null };
    reponsesRpc.resolve_custom_geo_zone_codes = { data: { count_cp: 3, count_iris: 9 }, error: null };
    const r = await appel();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ zone_id: ZONE, count_cp: 3, count_iris: 9, surface_km2: 3 });
    expect(executions[0].ctx).toStrictEqual({ orgId: ORG, sources: ['s1'] });
    expect(rpcs.map((c) => c.nom)).toEqual(['zone_referencee', 'remplacer_geometrie_zone', 'resolve_custom_geo_zone_codes']);
    expect(rpcs[1].args).toEqual({ p_zone_id: ZONE, p_org_id: ORG, p_geometry_geojson: JSON.stringify(CARRE) });
  });
  it('résolution en échec après un recalcul : 207 dont le message dit « recalculée », pas « créée »', async () => {
    zoneLue = { id: ZONE, recette: RAYON };
    reponsesRpc.remplacer_geometrie_zone = { data: { remplace: true }, error: null };
    reponsesRpc.resolve_custom_geo_zone_codes = { data: null, error: { message: 'canceling statement due to statement timeout' } };
    const r = await appel();
    expect(r.status).toBe(207);
    expect(await r.json()).toEqual({ zone_id: ZONE, warning: 'codes_non_resolus', message: 'Zone recalculée, mais ses codes postaux n’ont pas pu être résolus.' });
  });
  it('remplacer_geometrie_zone rend une réponse hors contrat : 500', async () => {
    zoneLue = { id: ZONE, recette: RAYON };
    reponsesRpc.remplacer_geometrie_zone = { data: 'n’importe quoi', error: null };
    expect((await appel()).status).toBe(500);
  });
  it('identifiant non UUID : 404 sans lecture ni quota', async () => {
    expect((await appel('pas-un-uuid')).status).toBe(404);
    expect(lectures).toEqual([]);
    expect(quotas).toEqual([]);
  });
  it('quota épuisé : 429 sans lecture', async () => {
    quotaOk = false;
    expect((await appel()).status).toBe(429);
    expect(lectures).toEqual([]);
  });
});
