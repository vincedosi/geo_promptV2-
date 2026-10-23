import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `GET /api/analyses/couverture-rayon` (lot 4, T12) — la courbe de couverture par rayon autour d'un type de POI, sur le
 * périmètre de ① ou sur la zone analysée (`couverture_rayon_poi`, sql/272).
 *
 * Verrouillé : l'ordre session → paramètres → quota → sources → RPC (une requête invalide ne touche pas la base) ;
 * l'espace et les sources viennent de la SESSION, jamais du client ; chaque refus a son statut et sa phrase française ;
 * une erreur Postgres ne fuit pas.
 */
const AUTRE_ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3399';
const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';
const SOURCES = ['s-socle', 's-espace'];

import { ORG, etat, reinitialiser } from './_doublures-route';

vi.mock('@/lib/api/middleware', () => import('./_doublures-route'));
vi.mock('@/lib/api/rate-limit', () => import('./_doublures-route'));
vi.mock('@/lib/auth', () => import('./_doublures-route'));
const sessionsSources: unknown[] = [];
vi.mock('@/lib/auth/getOrgSourceIds', () => ({
  getOrgSourceIds: async (s: unknown, o: unknown) => { sessionsSources.push([s, o]); return SOURCES; },
}));

const { GET } = await import('@/app/api/analyses/couverture-rayon/route');

const BASE = 'categorie=risque_industriel&perimetre_type=departement&perimetre_code=13';
const appel = (query = BASE, entetes: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/analyses/couverture-rayon?${query}`, { headers: entetes }) as never);

const COURBE = {
  calculable: true, cible: 'ind', rayon_max_m: 5000, n_poi: 2, poi: [[5.4, 43.3], [5.1, 43.5]], population_perimetre: 2_000_000,
  courbes: [{ cle: '*', total: 900_000, carreaux: 4000, points: [{ r: 100, p: 1000, i: 1000 }] }],
};

beforeEach(() => {
  reinitialiser();
  sessionsSources.length = 0; etat.reponses.couverture_rayon_poi = { data: COURBE, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('source de la route', () => {
  it('requireAuth, force-dynamic, maxDuration 60, jamais getUser ni Map locale ; UN limiteur 6 / 60 s', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('app/api/analyses/couverture-rayon/route.ts', 'utf8');
    expect(s).toContain('requireAuth(');
    expect(s).toContain("dynamic = 'force-dynamic'");
    expect(s).toMatch(/maxDuration\s*=\s*60/);
    expect(s).not.toContain('getUser(');
    expect(s).not.toMatch(/new Map\(/);
    expect(s.match(/createQuota\(/g)).toHaveLength(1);
    expect(etat.limiteurs.filter((l) => l.prefix === 'geo:rl:couverture-rayon'))
      .toEqual([{ max: 6, window: '60 s', prefix: 'geo:rl:couverture-rayon' }]);
  });
});

describe('session et paramètres — rien en base', () => {
  it('sans profil : 401 ; sans espace actif : 403', async () => {
    etat.profil = null; expect((await appel()).status).toBe(401);
    etat.profil = { id: 'u1', role: 'client', organization_id: null }; expect((await appel()).status).toBe(403);
    expect(etat.rpcs).toEqual([]); expect(etat.quotas).toEqual([]);
  });

  it.each([
    ['sans type de POI', 'perimetre_type=departement&perimetre_code=13'],
    ['sans périmètre', 'categorie=lycee'],
    ['type de périmètre inconnu', 'categorie=lycee&perimetre_type=pays&perimetre_code=FR'],
    ['rayon sous 100 m', `${BASE}&rayon_max=50`],
    ['rayon au-delà de 10 km', `${BASE}&rayon_max=10100`],
    ['cible mal formée', `${BASE}&cible=X%3BDROP`],
    ['valeurs sans champ', `${BASE}&valeur=seveso_haut`],
    ['neuf valeurs', `${BASE}&champ=sous_categorie${'&valeur=v'.repeat(9)}`],
    ['profil illisible', `${BASE}&profil=%7Bpas-du-json`],
    ['anneau au-delà du rayon max', `${BASE}&rayon_max=1000&profil=${encodeURIComponent('{"*":[500,2000]}')}`],
    ['cinq anneaux', `${BASE}&profil=${encodeURIComponent('{"*":[100,200,300,400,500]}')}`],
  ])('%s : 400 en français, sans jeton ni RPC', async (_n, q) => {
    const r = await appel(q);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/[a-zé]/);
    expect(etat.rpcs).toEqual([]); expect(etat.quotas).toEqual([]);
  });
});

describe('quota, sources, appel', () => {
  it('par défaut : cible ind, 5 km, sans champ ni profil ; quota (clé = le compte) PUIS sources de la session PUIS RPC', async () => {
    const r = await appel();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(COURBE);
    expect(etat.quotas).toEqual(['geo:rl:couverture-rayon:u1']);
    expect(sessionsSources).toEqual([[{ userId: 'u1', orgId: ORG, role: 'client' }, { vueEspace: true }]]);
    expect(etat.rpcs).toEqual([{ nom: 'couverture_rayon_poi', args: {
      p_categorie: 'risque_industriel', p_perimetre_type: 'departement', p_perimetre_code: '13', p_org_id: ORG,
      p_sources: SOURCES, p_cible: 'ind', p_rayon_max_m: 5000,
    } }]);
  });

  it('zone analysée, champ, valeurs, profil : transmis tels quels', async () => {
    const profilAnneaux = { seveso_haut: [500, 1000, 2000], seveso_bas: [500] };
    await appel(`categorie=risque_industriel&perimetre_type=zone&perimetre_code=${ZONE}&cible=men_pauv&rayon_max=10000`
      + `&champ=sous_categorie&valeur=seveso_haut&valeur=seveso_bas&profil=${encodeURIComponent(JSON.stringify(profilAnneaux))}`);
    expect(etat.rpcs[0].args).toMatchObject({
      p_perimetre_type: 'zone', p_perimetre_code: ZONE, p_cible: 'men_pauv', p_rayon_max_m: 10000,
      p_champ: 'sous_categorie', p_valeurs: ['seveso_haut', 'seveso_bas'], p_profil: profilAnneaux,
    });
  });

  it('un org_id en paramètre ou en en-tête est ignoré : la RPC reçoit l’espace du profil', async () => {
    await appel(`${BASE}&org_id=${AUTRE_ORG}&p_org_id=${AUTRE_ORG}`, { 'x-org-id': AUTRE_ORG });
    expect(etat.rpcs[0].args.p_org_id).toBe(ORG);
    expect(JSON.stringify(etat.rpcs)).not.toContain(AUTRE_ORG);
  });

  it('quota épuisé : 429, ni sources ni RPC', async () => {
    etat.quotaOk = false;
    expect((await appel()).status).toBe(429);
    expect(sessionsSources).toEqual([]); expect(etat.rpcs).toEqual([]);
  });
});

describe('refus de la RPC → statut et phrase française', () => {
  const cas: [Record<string, unknown>, number, RegExp][] = [
    [{ refus: 'perimetre_national_refuse' }, 422, /France entière/],
    [{ refus: 'perimetre_non_admis' }, 422, /département au plus/],
    [{ refus: 'perimetre_inconnu' }, 422, /introuvable/],
    [{ refus: 'perimetre_trop_grand' }, 422, /trop grand/],
    [{ refus: 'commune_ambigue' }, 422, /Plusieurs communes/],
    [{ refus: 'champ_non_admis' }, 422, /sous-catégorie/],
    [{ refus: 'cible_inconnue' }, 422, /cible n’est pas connue/],
    [{ refus: 'trop_de_poi', plafond: 5000 }, 422, /5\s000 POI/],
    [{ refus: 'trop_de_valeurs' }, 422, /8 valeurs/],
    [{ refus: 'calcul_trop_lourd', plafond: 300000, n_carreaux: 120000, n_valeurs: 6 }, 422, /^Calcul trop lourd : réduisez le périmètre, le rayon ou retirez le détail par champ/],
    [{ refus: 'couverture_non_construite', motif: 'jamais_certifiee' }, 503, /pas encore construite/],
  ];
  it.each(cas)('%o → %i', async (donnee, statut, message) => {
    etat.reponses.couverture_rayon_poi = { data: donnee, error: null };
    const r = await appel();
    expect(r.status).toBe(statut);
    const { refus, ...details } = donnee;
    expect(await r.json()).toEqual({ error: expect.stringMatching(message), refus, ...details });
  });

  it('sur la zone analysée : zone_introuvable en 404, et une zone trop grande se dit comme une zone (pas « l’étape ① »)', async () => {
    const zone = `categorie=lycee&perimetre_type=zone&perimetre_code=${ZONE}`;
    etat.reponses.couverture_rayon_poi = { data: { refus: 'zone_introuvable' }, error: null };
    const r404 = await appel(zone);
    expect(r404.status).toBe(404);
    expect(await r404.json()).toEqual({ error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' });
    etat.reponses.couverture_rayon_poi = { data: { refus: 'perimetre_trop_grand' }, error: null };
    expect((await (await appel(zone)).json()).error).toBe('La zone analysée dépasse 12 000 km².');
  });

  it('refus inconnu ou réponse hors contrat : 500, message générique', async () => {
    for (const data of [{ refus: 'inattendu' }, null, [1]]) {
      etat.reponses.couverture_rayon_poi = { data, error: null };
      const r = await appel();
      expect(r.status).toBe(500);
      expect((await r.json()).error).toBe('Calcul de la couverture par rayon impossible.');
    }
  });

  it('erreur Postgres : 500 sans fuite ; 22023 (argument hors contrat) : 400', async () => {
    etat.reponses.couverture_rayon_poi = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const r = await appel();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('statement');
    etat.reponses.couverture_rayon_poi = { data: null, error: { code: '22023', message: 'anneau hors de ]0, 5000] m' } };
    const r2 = await appel();
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await r2.json())).not.toContain('anneau hors');
  });
});
