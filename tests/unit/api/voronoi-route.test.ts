/**
 * `GET /api/voronoi` — le Voronoï du panneau Analyse sans le chat (2026-10-12,
 * suppression de l'IA, lot 4).
 *
 * Ce que la route doit tenir, et que l'outil copilote `voronoi_analysis`
 * tenait avant elle (`tests/unit/chat/voronoi-troncature.test.ts`) :
 *   - la garde de périmètre AVANT le calcul : une catégorie dont un seul POI
 *     échappe aux sources de l'appelant n'est pas calculée (403, RPC jamais
 *     appelée) ;
 *   - la jumelle `get_voronoi_by_category_jsonb`, jamais la forme SETOF que
 *     PostgREST coupe à 1 000 lignes sans erreur (4 653 cellules de lycées) ;
 *   - `tronque` quand la borne de 5 000 est atteinte ;
 *   - la même forme de réponse, que `appliquerResultatVoronoi` affiche.
 * Et ce qu'elle ajoute : session exigée par `requireAuth` (hors du matcher de
 * middleware.ts), quota partagé.
 *
 * Le faux client reproduit le plafond : la forme SETOF rend au plus 1 000
 * lignes, la jumelle rend `{ features, tronque }`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const MAX_ROWS = 1000;
let cellules = 0;
let erreurRpc: { message: string } | null = null;
let profil: { id: string; organization_id: string | null; role: string } | null = null;
let visible = true;
let quotaOk = true;
const appels: { nom: string; args: Record<string, unknown> }[] = [];
const gardes: { categorie: string; sources: string[] | null }[] = [];
let sourcesLues = 0;

const feature = (i: number) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [] },
  properties: { id: `l${i}`, nom: `Lycée ${i}`, categorie: 'lycee', lat: 45 + i / 10000, lng: 4 + i / 10000 },
});

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc: async (nom: string, args: Record<string, unknown> = {}) => {
      appels.push({ nom, args });
      if (erreurRpc) return { data: null, error: erreurRpc };
      const toutes = Array.from({ length: cellules }, (_, i) => feature(i));
      if (nom === 'get_voronoi_by_category') return { data: toutes.slice(0, MAX_ROWS), error: null };
      if (nom === 'get_voronoi_by_category_jsonb') {
        const limite = Number(args.p_limite ?? 5000);
        return { data: { features: toutes.slice(0, limite), tronque: toutes.length > limite }, error: null };
      }
      return { data: null, error: { message: `RPC inattendue ${nom}` } };
    },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async (req: Request) => (req.headers.get('authorization') ? profil : null),
  authUnauthorized: () => new Response(JSON.stringify({ success: false, error: 'Authentification requise.' }), { status: 401 }),
}));
vi.mock('@/lib/auth/perimetre-donnees', () => ({
  sourcesVisiblesDeLaRequete: async () => { sourcesLues += 1; return ['socle-1', 'espace-1']; },
  categorieEntierementVisible: async (_sb: unknown, categorie: string, sources: string[] | null) => {
    gardes.push({ categorie, sources });
    return visible;
  },
}));
vi.mock('@/lib/api/rate-limit', () => ({
  createRateLimiter: () => async () => ({ ok: quotaOk, retrySec: quotaOk ? 0 : 42 }),
  rateLimitResponse: (retrySec: number) =>
    new Response(JSON.stringify({ error: 'Trop de requêtes.', retry_after: retrySec }), { status: 429 }),
}));

const { GET } = await import('@/app/api/voronoi/route');

const appeler = (requete: string, entete: Record<string, string> = { authorization: 'Bearer jeton' }) =>
  GET(new NextRequest(`http://localhost/api/voronoi?${requete}`, { headers: entete }));

beforeEach(() => {
  cellules = 0;
  erreurRpc = null;
  profil = { id: 'u1', organization_id: 'o1', role: 'client' };
  visible = true;
  quotaOk = true;
  appels.length = 0;
  gardes.length = 0;
  sourcesLues = 0;
});

describe('GET /api/voronoi — accès', () => {
  it('sans catégorie : 400, aucun calcul', async () => {
    const r = await appeler('');
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/categorie/);
    expect(appels).toEqual([]);
  });

  it('sans en-tête Authorization (appel anonyme) : 401, ni garde ni calcul', async () => {
    const r = await appeler('categorie=lycee', {});
    expect(r.status).toBe(401);
    expect(gardes).toEqual([]);
    expect(appels).toEqual([]);
  });

  it('jeton invalide (aucun profil) : 401', async () => {
    profil = null;
    const r = await appeler('categorie=lycee');
    expect(r.status).toBe(401);
    expect(gardes).toEqual([]);
    expect(appels).toEqual([]);
  });

  it('quota épuisé : 429, aucun calcul', async () => {
    quotaOk = false;
    const r = await appeler('categorie=lycee');
    expect(r.status).toBe(429);
    expect(appels).toEqual([]);
  });

  it('catégorie hors périmètre : 403 avec le message de l’outil, la RPC n’est JAMAIS appelée', async () => {
    visible = false;
    const r = await appeler('categorie=bmw');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({
      error: 'Catégorie « bmw » hors de votre périmètre de données.', nb_polygones: 0, category: 'bmw',
    });
    expect(appels).toEqual([]);
  });

  it('la garde reçoit les sources de la CARTE (sourcesVisiblesDeLaRequete), jamais null', async () => {
    cellules = 3;
    await appeler('categorie=lycee');
    expect(sourcesLues).toBe(1);
    expect(gardes).toEqual([{ categorie: 'lycee', sources: ['socle-1', 'espace-1'] }]);
  });
});

describe('GET /api/voronoi — plafond PostgREST', () => {
  it('rend les 4 653 cellules des lycées, pas les 1 000 premières', async () => {
    cellules = 4653;
    const corps = await (await appeler('categorie=lycee')).json();
    expect(corps.nb_polygones).toBe(4653);
    expect(corps.voronoiGeoJSON.features).toHaveLength(4653);
    expect(corps.tronque).toBe(false);
  });

  it('UN appel à la jumelle jsonb, borne écrite (5 000), métropole par défaut, jamais la forme SETOF', async () => {
    cellules = 10;
    await appeler('categorie=lycee');
    expect(appels.map((a) => a.nom)).toEqual(['get_voronoi_by_category_jsonb']);
    expect(appels[0].args).toEqual({ cat_name: 'lycee', metropolitaine: true, p_limite: 5000 });
  });

  it('borne atteinte : le dit (tronque), au lieu de présenter un début comme le compte', async () => {
    cellules = 5001;
    const corps = await (await appeler('categorie=arret_transport')).json();
    expect(corps.nb_polygones).toBe(5000);
    expect(corps.tronque).toBe(true);
  });

  it('erreur de la RPC : 500 avec son message, dans l’enveloppe de l’outil', async () => {
    erreurRpc = { message: 'canceling statement due to statement timeout' };
    const r = await appeler('categorie=lycee');
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({
      error: 'canceling statement due to statement timeout', nb_polygones: 0, category: 'lycee',
    });
  });
});

describe('GET /api/voronoi — paramètres et forme de la réponse', () => {
  it('territoire : France entière, ville, département, région passent aux arguments de la RPC', async () => {
    cellules = 2;
    await appeler('categorie=lycee&metropolitaine=false');
    await appeler('categorie=lycee&ville=Lyon');
    await appeler('categorie=lycee&departement=29');
    await appeler('categorie=lycee&region=Bretagne');
    expect(appels.map((a) => a.args)).toEqual([
      { cat_name: 'lycee', metropolitaine: false, p_limite: 5000 },
      { cat_name: 'lycee', metropolitaine: true, p_limite: 5000, filtre_ville: 'Lyon' },
      { cat_name: 'lycee', metropolitaine: true, p_limite: 5000, filtre_departement: '29' },
      { cat_name: 'lycee', metropolitaine: true, p_limite: 5000, filtre_region: 'Bretagne' },
    ]);
  });

  it('la forme de l’outil voronoi_analysis : cellules, _meta, POI de la zone, compte', async () => {
    cellules = 2;
    const corps = await (await appeler('categorie=lycee&region=Bretagne')).json();
    expect(corps.voronoiGeoJSON.type).toBe('FeatureCollection');
    expect(corps.voronoiGeoJSON._meta).toEqual({
      category: 'lycee', metropolitaine: true, filtre_ville: null, filtre_region: 'Bretagne', filtre_dept: null,
    });
    expect(corps.poisForMap).toMatchObject({
      ville: 'Bretagne', region: 'Bretagne', departement: null, categorie_poi: 'lycee',
      rayon_metres: null, rayon_poi_metres: null, nb_pois: 2, categories: { lycee: 2 },
    });
    expect(corps.poisForMap.pois[0]).toMatchObject({ id: 'l0', nom: 'Lycée 0', lat: 45, lng: 4, categorie: 'lycee' });
    expect(corps.poisForMap.coordonnees.lat).toBeCloseTo(45.00005, 6);
    expect(corps).toMatchObject({ nb_polygones: 2, tronque: false, category: 'lycee', metropolitaine: true });
  });

  it('sans filtre, la zone s’appelle « France métropolitaine » ; « France » hors métropole', async () => {
    cellules = 2;
    expect((await (await appeler('categorie=lycee')).json()).poisForMap.ville).toBe('France métropolitaine');
    expect((await (await appeler('categorie=lycee&metropolitaine=false')).json()).poisForMap.ville).toBe('France');
  });
});
