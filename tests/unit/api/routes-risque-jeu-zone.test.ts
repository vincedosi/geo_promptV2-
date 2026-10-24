import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

/**
 * Les routes du module risque devant un jeu de ZONE (lot 5, T6, arbitrage A-3).
 *
 * Depuis sql/277, `zone_sets` porte deux types. Les routes ci-dessous lisent `zone_set_cp`, le profil d'anneaux ou
 * les simulations : sur un jeu de zone, elles planteraient (profil NULL) ou rendraient un jeu vide comme s'il était
 * juste. Elles passent toutes par UN chargeur, `chargerJeu(…, { type: 'risque' })`, qui rend un 409 explicite — et
 * aucune autre lecture n'a lieu (le client factice lève sur toute table inattendue, et sur toute RPC).
 *
 * Exceptions : les extractions (`GET` et `POST …/extractions`) servent les deux types (lot 5, T8 ; l'extraction d'un
 * jeu de zone est prouvée contre la base, `tests/integration/jeu-zone-extraction.test.ts`), et `GET` / `PATCH [id]`
 * servent un jeu de zone par leur propre branche (T7, `tests/unit/api/zones-jeux-zone.test.ts`).
 */
const h = vi.hoisted(() => ({
  ORG: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  JEU: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
  CAMPAGNE: '3f2504e0-4f89-11d3-9a0c-0305e82c3303',
  jeu: null as Record<string, unknown> | null,
  /** `table:filtre=valeur` de chaque lecture. */
  lectures: [] as string[],
  /** Rang (1, 2…) de la lecture de `zone_sets` qui échoue ; 0 = aucune. */
  lectureEnEchec: 0,
  nLectures: 0,
}));

/** Une requête supabase-js : chaque filtre se journalise, la fin rend la ligne prévue pour la table. */
function requete(table: string, fin: () => unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'range', 'update']) q[m] = () => q;
  q.eq = (col: string, val: unknown) => { h.lectures.push(`${table}:${col}=${String(val)}`); return q; };
  q.maybeSingle = async () => {
    h.nLectures += 1;
    return h.nLectures === h.lectureEnEchec ? { data: null, error: { message: 'panne' } } : { data: fin(), error: null };
  };
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: fin(), error: null }).then(ok);
  return q;
}

vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u1', role: 'client', organization_id: h.ORG }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/api/rate-limit', () => ({
  createRateLimiter: () => async () => ({ ok: true, retrySec: 0 }),
  createQuota: () => async () => null,
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('@/lib/campaigns/access', () => ({ checkCampaignAccess: async () => 'ok' }));
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === 'zone_sets') return requete(table, () => h.jeu);
      if (table === 'bidding_strategies') {
        return requete(table, () => ({ in_zone_weights: { mode: 'zone_set', zone_set_id: h.JEU, zone_set_nom: 'J' } }));
      }
      if (table === 'zone_set_extractions' || table === 'zone_set_cp') return requete(table, () => []);
      throw new Error(`lecture inattendue : ${table}`);
    },
    rpc(nom: string) { throw new Error(`RPC inattendue : ${nom}`); },
  }),
}));

const jeuDe = (type: string) => ({
  id: h.JEU, org_id: h.ORG, type, nom: 'J', version: 1, brouillon: false, construit_le: '2026-10-24T00:00:00Z',
  profil: type === 'risque' ? {} : null, profil_hash: type === 'risque' ? 'h' : null,
  custom_geo_zone_id: type === 'zone' ? '3f2504e0-4f89-11d3-9a0c-0305e82c3304' : null,
  cible: 'ind', gravites: [], natures: [], modes: [], territoire: null, mode_plan: 'pondere',
  seuil_couverture_cp: 20, poids: {},
});

const URL_JEU = `http://localhost/api/zones/jeux/${h.JEU}`;
const enJson = (corps: unknown) => ({ method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } });
const params = { params: Promise.resolve({ id: h.JEU }) };

type Appel = () => Promise<Response>;
// NextRequest et non Request : certaines routes lisent `request.nextUrl`.
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(url, init);

const R = {
  jeu: await import('@/app/api/zones/jeux/[id]/route'),
  cpGeo: await import('@/app/api/zones/jeux/[id]/cp-geo/route'),
  exporter: await import('@/app/api/zones/jeux/[id]/export/route'),
  extractions: await import('@/app/api/zones/jeux/[id]/extractions/route'),
  exportVersion: await import('@/app/api/zones/jeux/[id]/extractions/[version]/export/route'),
  grappes: await import('@/app/api/zones/jeux/[id]/grappes/route'),
  rattacher: await import('@/app/api/zones/jeux/[id]/rattacher/route'),
  simulation: await import('@/app/api/zones/jeux/[id]/simulation/route'),
  carte: await import('@/app/api/zones/jeux/[id]/simulation/carte/route'),
  simExport: await import('@/app/api/zones/jeux/[id]/simulation/export/route'),
  recaler: await import('@/app/api/zones/jeux/[id]/simulation/recaler/route'),
  pression: await import('@/app/api/campaigns/[campaignId]/pression-classes/route'),
};

/** Chaque route risque qui reçoit un identifiant de jeu, avec un appel valide jusqu'à la lecture du jeu. */
const ROUTES: [string, Appel][] = [
  ['GET [id]', () => R.jeu.GET(req(URL_JEU), params)],
  ['PATCH [id]', () => R.jeu.PATCH(req(URL_JEU, { ...enJson({ nom: 'x' }), method: 'PATCH' }), params)],
  ['GET cp-geo', () => R.cpGeo.GET(req(`${URL_JEU}/cp-geo?bbox=-5,47,-1,49`), params)],
  ['GET export', () => R.exporter.GET(req(`${URL_JEU}/export`), params)],
  ['POST extractions', () => R.extractions.POST(req(`${URL_JEU}/extractions`, enJson({})), params)],
  ['GET extractions/[version]/export', () => R.exportVersion.GET(req(`${URL_JEU}/extractions/1/export`),
    { params: Promise.resolve({ id: h.JEU, version: '1' }) })],
  ['GET grappes', () => R.grappes.GET(req(`${URL_JEU}/grappes`), params)],
  ['POST rattacher', () => R.rattacher.POST(req(`${URL_JEU}/rattacher`, enJson({ campagne: h.CAMPAGNE })), params)],
  ['GET simulation', () => R.simulation.GET(req(`${URL_JEU}/simulation`), params)],
  ['POST simulation', () => R.simulation.POST(req(`${URL_JEU}/simulation`, enJson({ version: 1 })), params)],
  ['DELETE simulation', () => R.simulation.DELETE(req(`${URL_JEU}/simulation`, { method: 'DELETE' }), params)],
  ['GET simulation/carte', () => R.carte.GET(req(`${URL_JEU}/simulation/carte?bbox=-5,47,-1,49`), params)],
  ['GET simulation/export', () => R.simExport.GET(req(`${URL_JEU}/simulation/export`), params)],
  ['POST simulation/recaler', () => R.recaler.POST(req(`${URL_JEU}/simulation/recaler`, enJson({})), params)],
  ['GET pression-classes', () => R.pression.GET(req(`http://localhost/api/campaigns/${h.CAMPAGNE}/pression-classes`),
    { params: Promise.resolve({ campaignId: h.CAMPAGNE }) })],
];

beforeEach(() => {
  h.jeu = null;
  h.lectures.length = 0;
  h.lectureEnEchec = 0;
  h.nLectures = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('routes risque — un jeu de zone reçoit un 409, sans autre lecture', () => {
  it.each(ROUTES.filter(([nom]) => !nom.endsWith(' [id]') && nom !== 'POST extractions'))('%s', async (_nom, appel) => {
    h.jeu = jeuDe('zone');
    const r = await appel();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "Ce jeu de zones se gère à l'étape ⑤ de la carte." });
  });
});

describe('routes risque — un jeu absent de l’espace : 404', () => {
  it.each(ROUTES.filter(([nom]) => nom !== 'GET pression-classes'))('%s', async (_nom, appel) => {
    const r = await appel();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Jeu de zones introuvable dans cet espace.' });
    // La lecture est filtrée par l'espace de la session : sans ce filtre, un identifiant suffirait (createAdminClient).
    expect(h.lectures).toContain(`zone_sets:org_id=${h.ORG}`);
  });

  it('GET pression-classes : le jeu de la campagne a disparu → le message existant, sans appeler la RPC', async () => {
    const r = await ROUTES.at(-1)![1]();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({
      error: 'Le jeu de zones de cette campagne a été supprimé. Rattachez-en un autre depuis l’onglet Stratégie.',
      raison: 'jeu_introuvable',
    });
  });
});

describe('les extractions servent les deux types (T8)', () => {
  it('POST extractions d’un jeu de zone : des unités envoyées par le client sont REFUSÉES (corps strict), rien d’autre lu', async () => {
    h.jeu = jeuDe('zone');
    const r = await R.extractions.POST(req(`${URL_JEU}/extractions`, enJson({ unites: [{ plateforme: 'meta' }] })), params);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('clé inattendue : unites');
    expect(h.lectures.every((l) => l.startsWith('zone_sets:'))).toBe(true);
  });
  it('POST extractions d’un jeu RISQUE : une clé inconnue reste ignorée, comme avant le lot 5', async () => {
    h.jeu = jeuDe('risque');
    const r = await R.extractions.POST(req(`${URL_JEU}/extractions`, enJson({ unites: [] })), params);
    expect(r.status).not.toBe(400);
  });
  it('GET extractions d’un jeu de zone : 200', async () => {
    h.jeu = jeuDe('zone');
    const r = await R.extractions.GET(req(`${URL_JEU}/extractions`), params);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ extractions: [], jeu: { id: h.JEU, nom: 'J', version: 1 } });
  });
});

describe('source des routes — une seule lecture du jeu, par le chargeur', () => {
  const FICHIERS = [
    'app/api/zones/jeux/[id]/route.ts', 'app/api/zones/jeux/[id]/cp-geo/route.ts',
    'app/api/zones/jeux/[id]/export/route.ts', 'app/api/zones/jeux/[id]/extractions/route.ts',
    'app/api/zones/jeux/[id]/extractions/[version]/export/route.ts', 'app/api/zones/jeux/[id]/grappes/route.ts',
    'app/api/zones/jeux/[id]/rattacher/route.ts', 'app/api/zones/jeux/[id]/simulation/route.ts',
    'app/api/zones/jeux/[id]/simulation/carte/route.ts', 'app/api/zones/jeux/[id]/simulation/export/route.ts',
    'app/api/zones/jeux/[id]/simulation/recaler/route.ts', 'app/api/campaigns/[campaignId]/pression-classes/route.ts',
  ];
  it.each(FICHIERS)('%s', (f) => {
    const s = readFileSync(f, 'utf8');
    expect(s).toContain("from '@/lib/zones/charger-jeu'");
    expect(s, 'lecture de zone_sets hors du chargeur').not.toMatch(/from\('zone_sets'\)\s*\.select/);
  });
});

describe('GET / PATCH [id] d’un jeu risque — la forme de réponse d’avant le chargeur', () => {
  const CHAMPS = ['brouillon', 'cible', 'construit_le', 'created_at', 'description', 'gravites', 'id', 'mode_plan',
    'modes', 'n_cp_retenus', 'natures', 'nom', 'poids', 'population_exposee', 'profil', 'profil_hash',
    'seuil_couverture_cp', 'taux_utile', 'territoire', 'version'];
  const risque = () => ({ ...jeuDe('risque'), created_by: 'u1', description: null, created_at: '2026-10-24',
    population_exposee: 1, n_cp_retenus: 1, taux_utile: 50 });

  it('GET : les champs d’avant, ni org_id, ni created_by, ni type, ni zone', async () => {
    h.jeu = risque();
    const r = await R.jeu.GET(req(URL_JEU), params);
    expect(r.status).toBe(200);
    expect(Object.keys((await r.json()).jeu).sort()).toEqual(CHAMPS);
  });

  it('PATCH : même forme ; une relecture après mise à jour qui échoue rend 500, pas 200 { jeu: null }', async () => {
    h.jeu = risque();
    const ok = await R.jeu.PATCH(req(URL_JEU, { ...enJson({ nom: 'x' }), method: 'PATCH' }), params);
    expect(ok.status).toBe(200);
    expect(Object.keys((await ok.json()).jeu).sort()).toEqual(CHAMPS);

    h.nLectures = 0;
    h.lectureEnEchec = 2;
    const ko = await R.jeu.PATCH(req(URL_JEU, { ...enJson({ nom: 'x' }), method: 'PATCH' }), params);
    expect(ko.status).toBe(500);
    expect(await ko.json()).toEqual({ error: 'Jeu de zones illisible.' });
  });
});
