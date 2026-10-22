import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `GET /api/zones/[id]/couverture?cible=&decoupage=` (lot 4, T6) — le chiffrage d'une zone, servi du cache tant que sa
 * forme et la base n'ont pas changé (sql/270).
 *
 * Ce que ces tests verrouillent, au-delà des statuts :
 * - l'ordre : session → paramètres → cache → quota → calcul ; une requête invalide ne touche pas la base ;
 * - un chiffrage en cache ne consomme AUCUN jeton et ne lance aucun calcul (A-16) ;
 * - l'espace passé aux RPC est TOUJOURS celui de la session (profil), jamais un paramètre ni un en-tête du client
 *   (Review Focus 1, consigne CdP après la relecture de T5) ;
 * - chaque refus de la RPC a son statut et son message français ; une erreur Postgres ne fuit pas.
 */
type Profil = { id: string; role: string; organization_id: string | null } | null;
const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const AUTRE_ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3399';
const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';

let profil: Profil = { id: 'u1', role: 'client', organization_id: ORG };
vi.mock('@/lib/api/middleware', () => ({ requireAuth: async () => profil }));
let quotaOk = true;
const quotas: string[] = [];
const limiteurs: unknown[] = [];
vi.mock('@/lib/api/rate-limit', () => ({
  createRateLimiter: (o: unknown) => {
    limiteurs.push(o);
    return async (cle: string) => { quotas.push(cle); return quotaOk ? { ok: true, retrySec: 0 } : { ok: false, retrySec: 30 }; };
  },
  rateLimitResponse: (s: number) => new Response(JSON.stringify({ error: 'Trop de requêtes.' }), { status: 429, headers: { 'Retry-After': String(s) } }),
}));
const rpcs: { nom: string; args: Record<string, unknown> }[] = [];
let reponsesRpc: Record<string, { data: unknown; error: unknown }> = {};
const lectures: string[] = [];
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc(nom: string, args: Record<string, unknown>) { rpcs.push({ nom, args }); return Promise.resolve(reponsesRpc[nom] ?? { data: null, error: null }); },
    from(table: string) { lectures.push(table); throw new Error('aucune lecture de table attendue'); },
  }),
}));

const { GET } = await import('@/app/api/zones/[id]/couverture/route');

const appel = (id: string, query = '', entetes: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/zones/${id}/couverture${query}`, { headers: entetes }) as never, { params: Promise.resolve({ id }) });

const CHIFFRAGE = {
  zone_id: ZONE, cible: 'ind', decoupage: 'cp', surface_km2: 6.3, n_carreaux: 150, population: 50_000,
  lignes: [{ code: '69002', nom: 'Lyon', commune: null, n_carreaux: 150, pop_en_zone: 50_000, pop_totale: 52_000, part: 96.2 }],
  hors_territoire: { n_carreaux: 0, population: 0 }, n_territoires: 1, motif_vide: null, territoires_non_carroyes: [],
  reference: { source: 'carroyage INSEE Filosofi 200 m (ménages fiscaux)', millesime: '2021', population_france: 63_783_568, n_carreaux_france: 2_324_577 },
  base_construite_le: '2026-10-22T10:50:44.104164+00:00', calcule_le: '2026-10-22T11:00:00+00:00',
};

beforeEach(() => {
  profil = { id: 'u1', role: 'client', organization_id: ORG }; quotaOk = true;
  rpcs.length = 0; reponsesRpc = {}; quotas.length = 0; lectures.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('source de la route', () => {
  it('garde requireAuth( (routes-publiques), force-dynamic, maxDuration, jamais getUser ni Map locale', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('app/api/zones/[id]/couverture/route.ts', 'utf8');
    expect(s).toContain('requireAuth(');
    expect(s).toContain("dynamic = 'force-dynamic'");
    expect(s).toMatch(/maxDuration\s*=\s*60/);
    expect(s).not.toContain('getUser(');
    expect(s).not.toMatch(/new Map\(/);
  });
  it('UN limiteur propre : 6 / 60 s / compte, préfixe geo:rl:couverture (A-16, correction R-4) — pas celui des zones', async () => {
    // `session-zones.ts`, importé pour `espaceDeZone`, crée aussi le sien (`geo:rl:zones`) : la route ne l'emploie pas.
    expect(limiteurs.filter((l) => (l as { prefix: string }).prefix === 'geo:rl:couverture'))
      .toEqual([{ max: 6, window: '60 s', prefix: 'geo:rl:couverture' }]);
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('app/api/zones/[id]/couverture/route.ts', 'utf8');
    expect(s.match(/createRateLimiter\(/g)).toHaveLength(1);
    expect(s).not.toContain('quotaZones');
  });
});

describe('session et paramètres — rien en base', () => {
  it('sans profil : 401 ; sans espace actif : 403', async () => {
    profil = null; expect((await appel(ZONE)).status).toBe(401);
    profil = { id: 'u1', role: 'client', organization_id: null }; expect((await appel(ZONE)).status).toBe(403);
    expect(rpcs).toEqual([]); expect(quotas).toEqual([]);
  });
  it('id non UUID, découpage inconnu, cible mal formée : 400 en français, sans RPC ni jeton', async () => {
    for (const [id, q] of [['pas-un-uuid', ''], [ZONE, '?decoupage=commune'], [ZONE, '?cible=X%3BDROP'], [ZONE, '?cible=a']]) {
      const r = await appel(id, q);
      expect(r.status, `${id}${q}`).toBe(400);
      expect((await r.json()).error).toMatch(/^[A-ZÉ][a-zàâçéèêëîïôûùüÿœ' ,:]+/);
    }
    expect(rpcs).toEqual([]); expect(quotas).toEqual([]); expect(lectures).toEqual([]);
  });
  it('par défaut : cible ind, découpage forme', async () => {
    reponsesRpc.couverture_zone_en_cache = { data: { ...CHIFFRAGE, decoupage: 'forme', cache: true }, error: null };
    await appel(ZONE);
    expect(rpcs[0].args).toEqual({ p_zone_id: ZONE, p_org_id: ORG, p_cible: 'ind', p_decoupage: 'forme' });
  });
});

describe('cache, quota, calcul', () => {
  it('cache valide : 200, la réponse telle quelle, AUCUN jeton ni calcul', async () => {
    reponsesRpc.couverture_zone_en_cache = { data: { ...CHIFFRAGE, cache: true }, error: null };
    const r = await appel(ZONE, '?cible=ind&decoupage=cp');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ...CHIFFRAGE, cache: true });
    expect(rpcs.map((x) => x.nom)).toEqual(['couverture_zone_en_cache']);
    expect(quotas).toEqual([]);
  });
  it('cache absent : quota (clé = le compte) PUIS calcul, séquentiels, mêmes arguments', async () => {
    reponsesRpc.couverture_zone = { data: { ...CHIFFRAGE, cache: false }, error: null };
    const r = await appel(ZONE, '?cible=men_pauv&decoupage=cp');
    expect(r.status).toBe(200);
    expect((await r.json()).cache).toBe(false);
    const attendu = { p_zone_id: ZONE, p_org_id: ORG, p_cible: 'men_pauv', p_decoupage: 'cp' };
    expect(rpcs).toEqual([{ nom: 'couverture_zone_en_cache', args: attendu }, { nom: 'couverture_zone', args: attendu }]);
    expect(quotas).toEqual(['u1']);
  });
  it('quota épuisé : 429, aucun calcul', async () => {
    quotaOk = false;
    const r = await appel(ZONE, '?decoupage=iris');
    expect(r.status).toBe(429);
    expect(rpcs.map((x) => x.nom)).toEqual(['couverture_zone_en_cache']);
  });
});

describe('l’espace vient de la session, jamais du client (Review Focus 1)', () => {
  it('un org_id en paramètre ou en en-tête est ignoré : les deux RPC reçoivent l’espace du profil', async () => {
    reponsesRpc.couverture_zone = { data: { refus: 'zone_introuvable' }, error: null };
    const r = await appel(ZONE, `?cible=ind&decoupage=cp&org_id=${AUTRE_ORG}&p_org_id=${AUTRE_ORG}&orgId=${AUTRE_ORG}`,
      { 'x-org-id': AUTRE_ORG, 'x-organization-id': AUTRE_ORG });
    expect(r.status).toBe(404);
    expect(rpcs).toHaveLength(2);
    for (const x of rpcs) expect(x.args.p_org_id).toBe(ORG);
    expect(JSON.stringify(rpcs)).not.toContain(AUTRE_ORG);
  });
});

describe('refus de la RPC → statut et message français', () => {
  const cas: [Record<string, unknown>, number, RegExp][] = [
    [{ refus: 'zone_introuvable' }, 404, /n’existe pas dans cet espace/],
    [{ refus: 'cible_inconnue' }, 422, /cible n’est pas connue/],
    [{ refus: 'zone_trop_vaste', surface_km2: 180000, plafond_km2: 100000 }, 422, /trop vaste/],
    [{ refus: 'trop_de_carreaux', plafond: 400000 }, 422, /400 000 carreaux/],
    [{ refus: 'couverture_non_construite', motif: 'jamais_certifiee' }, 503, /pas encore construite/],
  ];
  for (const [donnee, statut, message] of cas) {
    it(`${String(donnee.refus)} → ${statut}`, async () => {
      reponsesRpc.couverture_zone = { data: donnee, error: null };
      const r = await appel(ZONE, '?decoupage=cp');
      expect(r.status).toBe(statut);
      const corps = await r.json();
      expect(corps.error).toMatch(message);
      // Le code du refus et ses détails (plafond, surface, motif) accompagnent le message.
      expect(corps).toEqual({ error: corps.error, ...donnee });
    });
  }
  it('un refus inconnu de ce contrat : 500, sans le recracher', async () => {
    reponsesRpc.couverture_zone = { data: { refus: 'pluie' }, error: null };
    const r = await appel(ZONE);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Calcul de la couverture impossible.' });
  });
});

describe('erreurs', () => {
  it('erreur Postgres à la lecture du cache : 500 sans détail, ni jeton ni calcul', async () => {
    reponsesRpc.couverture_zone_en_cache = { data: null, error: { code: '42P01', message: 'relation secrète' } };
    const r = await appel(ZONE);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Calcul de la couverture impossible.' });
    expect(quotas).toEqual([]);
    expect(rpcs).toHaveLength(1);
  });
  it('erreur Postgres au calcul : 500 « Calcul de la couverture impossible. », sans détail', async () => {
    reponsesRpc.couverture_zone = { data: null, error: { code: 'XX000', message: 'part de territoire > 100 %' } };
    const r = await appel(ZONE);
    expect(r.status).toBe(500);
    const texte = await r.text();
    expect(JSON.parse(texte)).toEqual({ error: 'Calcul de la couverture impossible.' });
    expect(texte).not.toContain('territoire');
  });
  it('réponse hors contrat (pas un objet) : 500', async () => {
    reponsesRpc.couverture_zone = { data: [1, 2], error: null };
    expect((await appel(ZONE)).status).toBe(500);
  });
});
