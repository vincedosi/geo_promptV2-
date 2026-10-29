import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `POST /api/zones/[id]/dupliquer` (③ finitions, T2, arbitrage A-5 ; Review Focus 3). Ce que ces tests verrouillent :
 * - l'ordre : corps validé et quota (le limiteur PARTAGÉ des routes de zone) AVANT toute lecture ;
 * - la zone source n'est jamais écrite : ni `remplacer_geometrie_zone`, ni `update` sur son id ;
 * - recette recalculable → exécutée À NEUF (sans géométrie cliente) puis `creer_zone_recette` ; forme figée → la
 *   copie se fait EN BASE (`dupliquer_zone`, sql/294) : aucune géométrie ne passe par la route ;
 * - une zone d'un autre espace → 404, comme une inconnue.
 */
type Profil = { id: string; role: string; organization_id: string | null } | null;
const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';
const NOUVELLE = '3f2504e0-4f89-11d3-9a0c-0305e82c3310';
let profil: Profil = { id: 'u1', role: 'client', organization_id: ORG };
vi.mock('@/lib/api/middleware', () => ({ requireAuth: async () => profil }));
vi.mock('@/lib/auth/getOrgSourceIds', () => ({ getOrgSourceIds: async () => ['s1'] }));
vi.mock('@/lib/auth/perimetre-donnees', () => ({ indicateursVisiblesDeLaSession: async () => ({ visibles: new Set(), propres: new Set() }) }));
let quotaOk = true;
const journal: string[] = [];
vi.mock('@/lib/api/rate-limit', () => ({
  createQuota: (o: { prefix: string }) => async (cle: string) => {
    journal.push(`quota:${o.prefix}:${cle}`);
    return quotaOk ? null : new Response(JSON.stringify({ error: 'Trop de requêtes.' }), { status: 429 });
  },
}));
const CARRE = { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]]] };
let issue: unknown = { ok: true, geometry: CARRE, surface_km2: 3, compte: 4, part_retenue: null, population: null };
const executions: { recette: unknown; ctx: unknown }[] = [];
vi.mock('@/lib/zones/executer-recette', () => ({
  executerRecette: async (_s: unknown, recette: unknown, ctx: unknown) => { journal.push('executer'); executions.push({ recette, ctx }); return issue; },
}));
const rpcs: { nom: string; args: Record<string, unknown> }[] = [];
let reponsesRpc: Record<string, { data: unknown; error: unknown }> = {};
let zoneLue: unknown = null;
const ecritures: { table: string; valeurs: unknown; filtres: [string, unknown][] }[] = [];
const lectures: { table: string; filtres: [string, unknown][] }[] = [];
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc(nom: string, args: Record<string, unknown>) { journal.push(`rpc:${nom}`); rpcs.push({ nom, args }); return Promise.resolve(reponsesRpc[nom] ?? { data: null, error: null }); },
    from(table: string) {
      const filtres: [string, unknown][] = [];
      let valeurs: unknown;
      const c = {
        select() { journal.push(`lire:${table}`); lectures.push({ table, filtres }); return c; },
        update(v: unknown) { valeurs = v; ecritures.push({ table, valeurs, filtres }); return c; },
        eq(col: string, v: unknown) { filtres.push([col, v]); return c; },
        maybeSingle() { return Promise.resolve({ data: zoneLue, error: null }); },
        then(res: (v: { error: null }) => unknown) { return Promise.resolve({ error: null }).then(res); },
      };
      return c;
    },
  }),
}));

const { POST: dupliquer } = await import('@/app/api/zones/[id]/dupliquer/route');

const appel = (corps: unknown, id = ZONE) => dupliquer(
  new Request(`http://localhost/api/zones/${id}/dupliquer`, { method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } }) as never,
  { params: Promise.resolve({ id }) },
);
const RAYON = { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 1000 };

beforeEach(() => {
  profil = { id: 'u1', role: 'client', organization_id: ORG }; quotaOk = true;
  issue = { ok: true, geometry: CARRE, surface_km2: 3, compte: 4, part_retenue: null, population: null };
  executions.length = 0; rpcs.length = 0; ecritures.length = 0; lectures.length = 0; journal.length = 0;
  reponsesRpc = { resolve_custom_geo_zone_codes: { data: { count_cp: 2, count_iris: 5 }, error: null } };
  zoneLue = null;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('POST /api/zones/[id]/dupliquer', () => {
  it('source : requireAuth(, force-dynamic, lireCorps, aucun limiteur propre (le quota partagé geo:rl:zones)', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('app/api/zones/[id]/dupliquer/route.ts', 'utf8');
    expect(s).toContain('requireAuth(');
    expect(s).toContain("dynamic = 'force-dynamic'");
    expect(s).toContain('lireCorps(');
    expect(s).not.toMatch(/request\.json\(\)|req\.json\(\)|createQuota\(|createRateLimiter\(/);
  });

  it('forme figée : copie EN BASE par dupliquer_zone, dans l’espace actif, puis résolution des codes', async () => {
    zoneLue = { id: ZONE, recette: { v: 1, type: 'dessin' } };
    reponsesRpc.dupliquer_zone = { data: { id: NOUVELLE, surface_km2: 1.2 }, error: null };
    const res = await appel({ nom: '  Ma zone (copie) ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ zone_id: NOUVELLE, count_cp: 2, count_iris: 5, surface_km2: 1.2 });
    expect(rpcs.map((r) => r.nom)).toEqual(['dupliquer_zone', 'resolve_custom_geo_zone_codes']);
    expect(rpcs[0].args).toEqual({ p_zone_id: ZONE, p_org_id: ORG, p_nom: 'Ma zone (copie)', p_cree_par: 'u1' });
    expect(rpcs[1].args).toEqual({ p_zone_id: NOUVELLE, p_caller_user_id: 'u1' });
    expect(executions).toEqual([]);
    expect(ecritures).toEqual([]);
    expect(lectures[0].filtres).toEqual([['id', ZONE], ['org_id', ORG]]);
  });

  it('zone d’avant le lot 3 (recette NULL) : copiée aussi', async () => {
    zoneLue = { id: ZONE, recette: null };
    reponsesRpc.dupliquer_zone = { data: { id: NOUVELLE, surface_km2: 1 }, error: null };
    expect((await appel({ nom: 'Copie' })).status).toBe(200);
    expect(rpcs[0].nom).toBe('dupliquer_zone');
  });

  it('recette recalculable : exécutée À NEUF sans géométrie cliente, écrite par creer_zone_recette, provenance posée sur la NOUVELLE', async () => {
    zoneLue = { id: ZONE, recette: RAYON };
    reponsesRpc.creer_zone_recette = { data: { id: NOUVELLE }, error: null };
    const res = await appel({ nom: 'Rayon (copie)', geometrie: CARRE });
    expect(res.status).toBe(400);   // corps strict : une géométrie ne voyage jamais vers cette route
    const ok = await appel({ nom: 'Rayon (copie)' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ zone_id: NOUVELLE, count_cp: 2, count_iris: 5, surface_km2: 3 });
    expect(executions).toHaveLength(1);
    expect(executions[0].recette).toEqual(RAYON);
    expect(executions[0].ctx).not.toHaveProperty('geometrie');
    expect(rpcs.map((r) => r.nom)).toEqual(['creer_zone_recette', 'resolve_custom_geo_zone_codes']);
    expect(rpcs[0].args).toMatchObject({ p_nom: 'Rayon (copie)', p_org_id: ORG, p_cree_par: 'u1', p_recette: RAYON });
    expect(ecritures).toEqual([{ table: 'custom_geo_zones', valeurs: { source_metadata: { duplique_de: ZONE } }, filtres: [['id', NOUVELLE], ['org_id', ORG]] }]);
    // Relecture 1, m-2 : un id tapé en majuscules dans l'URL est rangé en minuscules, comme dans dupliquer_zone.
    ecritures.length = 0;
    expect((await appel({ nom: 'Rayon (copie)' }, ZONE.toUpperCase())).status).toBe(200);
    expect(ecritures[0].valeurs).toEqual({ source_metadata: { duplique_de: ZONE } });
  });

  it('recalcul refusé (périmètre trop grand…) : le refus de l’exécuteur, rien d’écrit', async () => {
    zoneLue = { id: ZONE, recette: RAYON };
    issue = { ok: false, statut: 422, refus: 'perimetre_trop_grand', message: 'trop grand' };
    const res = await appel({ nom: 'Copie' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'trop grand', refus: 'perimetre_trop_grand' });
    expect(rpcs).toEqual([]);
    expect(ecritures).toEqual([]);
  });

  it('zone absente ou d’un autre espace : 404 zone_introuvable ; la copie qui la perd en route aussi', async () => {
    zoneLue = null;
    const res = await appel({ nom: 'Copie' });
    expect(res.status).toBe(404);
    expect((await res.json()).refus).toBe('zone_introuvable');
    zoneLue = { id: ZONE, recette: null };
    reponsesRpc.dupliquer_zone = { data: { refus: 'zone_introuvable' }, error: null };
    expect((await appel({ nom: 'Copie' })).status).toBe(404);
  });

  it('id illisible : 404 sans rien lire ; nom vide ou trop long : 400 sans quota ni lecture', async () => {
    expect((await appel({ nom: 'Copie' }, 'pas-un-uuid')).status).toBe(404);
    for (const nom of ['', '   ', 'x'.repeat(201)]) expect((await appel({ nom })).status, nom).toBe(400);
    expect((await appel({})).status).toBe(400);
    expect(journal).toEqual([]);
  });

  it('quota épuisé (le limiteur partagé geo:rl:zones) : 429 avant toute lecture', async () => {
    quotaOk = false;
    zoneLue = { id: ZONE, recette: RAYON };
    expect((await appel({ nom: 'Copie' })).status).toBe(429);
    expect(journal).toEqual(['quota:geo:rl:zones:u1']);
  });

  it('sans session : 401 ; sans espace actif : 403', async () => {
    profil = null;
    expect((await appel({ nom: 'Copie' })).status).toBe(401);
    profil = { id: 'u1', role: 'client', organization_id: null };
    expect((await appel({ nom: 'Copie' })).status).toBe(403);
  });

  it('échec de la copie en base : 500, jamais un 200', async () => {
    zoneLue = { id: ZONE, recette: { v: 1, type: 'dessin' } };
    reponsesRpc.dupliquer_zone = { data: null, error: { message: 'boom' } };
    expect((await appel({ nom: 'Copie' })).status).toBe(500);
  });
});
