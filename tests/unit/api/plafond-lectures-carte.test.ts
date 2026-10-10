/**
 * Routes de la carte qui lisent une TABLE : plus de plafond silencieux à 1 000.
 *
 * PostgREST applique `db-max-rows` = 1 000 à toute requête de table, et aucun
 * `.limit(5000)` client ne le lève (`lib/supabase/lire-tout.ts`). Mesuré le
 * 2026-10-10 (lot 4 Angular, T8-T9) : `/api/map/ooh` rendait 1 000 panneaux sur
 * 1 434 actifs, `/api/map/transport` 1 000 arrêts sur 1 626 dans la vue de
 * Marseille-Est, `/api/radio/stations` un `total` de 1 000 sur 1 175 radios.
 *
 * Le faux client ci-dessous reproduit le plafond : chaque requête rend au plus
 * 1 000 lignes, quoi qu'on demande.
 *
 * Le transport ne pagine pas (revue 1) : une page de 1 000 refaisait tout le
 * parcours de l'index de catégorie. Il lit en UN appel la RPC
 * `lire_arrets_transport_bbox` (sql/241), qui porte la borne et `tronque`.
 *
 * Et `/api/radio/emetteurs` : un échec de la RPC ne doit plus afficher le
 * message PostgREST anglais brut (signatures SQL) à l'écran.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const MAX_ROWS = 1000;
let lignes: Record<string, unknown>[] = [];
let erreurRpc: { message: string } | null = null;
let requetes = 0;
const appelsRpc: { nom: string; args: Record<string, unknown> }[] = [];

function constructeur() {
  let de = 0;
  let a = Number.POSITIVE_INFINITY;
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'ilike', 'order']) c[m] = () => c;
  c.limit = (n: number) => { a = Math.min(a, de + n - 1); return c; };
  c.range = (x: number, y: number) => { de = x; a = y; return c; };
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    requetes += 1;
    const fin = Math.min(a + 1, de + MAX_ROWS, lignes.length);
    return Promise.resolve({ data: lignes.slice(de, Math.max(de, fin)), error: null }).then(ok, ko);
  };
  return c;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from: () => constructeur(),
    rpc: async (nom: string, args: Record<string, unknown> = {}) => {
      appelsRpc.push({ nom, args });
      if (erreurRpc) return { data: null, error: erreurRpc };
      if (nom === 'lire_arrets_transport_bbox') {
        // Ce que fait sql/241 : lit p_limite + 1 lignes, rend p_limite et `tronque`.
        const limite = Number(args.p_limite);
        return { data: { arrets: lignes.slice(0, limite), tronque: lignes.length > limite }, error: null };
      }
      return { data: [], error: null };
    },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u' }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/auth/perimetre-donnees', () => ({
  sourcesVisiblesDeLaRequete: async () => null,
  filtrerParSourcesVisibles: (q: unknown) => q,
}));

const ooh = await import('@/app/api/map/ooh/route');
const transport = await import('@/app/api/map/transport/route');
const stations = await import('@/app/api/radio/stations/route');
const emetteurs = await import('@/app/api/radio/emetteurs/route');

const panneaux = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, regie: 'R', type_panneau: 'T', adresse: null, ville: null, lat: 45, lng: 5, nb_faces: 1, metadata: null,
}));
const arrets = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `a${i}`, nom: 'Arrêt', lat: 43.3, lng: 5.5, sous_categorie: 'bus',
}));
const radios = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `r${i}`, nom: `Radio ${i}`, metadata: null, parent: null,
}));

beforeEach(() => {
  lignes = [];
  erreurRpc = null;
  requetes = 0;
  appelsRpc.length = 0;
  vi.restoreAllMocks();
});

describe('POST /api/map/ooh', () => {
  const appel = () => ooh.POST(new NextRequest('http://localhost/api/map/ooh', {
    method: 'POST', body: JSON.stringify({ regies: [] }), headers: { 'content-type': 'application/json' },
  }));

  it('rend les 1 434 panneaux actifs, pas les 1 000 premiers', async () => {
    lignes = panneaux(1434);
    const res = await appel();
    expect(res.status).toBe(200);
    expect((await res.json()).nb_pois).toBe(1434);
  });

  it('au-delà de la borne écrite (5 000), échoue en français plutôt que de tronquer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lignes = panneaux(5001);
    const res = await appel();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/panneaux/i);
  });
});

describe('GET /api/map/transport', () => {
  const appel = () => transport.GET(new NextRequest(
    'http://localhost/api/map/transport?west=5.4623&south=43.2782&east=5.9494&north=43.5003',
  ));

  it('rend les 1 626 arrêts de la vue, pas les 1 000 premiers', async () => {
    lignes = arrets(1626);
    const corps = await (await appel()).json();
    expect(corps.nb_pois).toBe(1626);
    expect(corps.tronque).toBe(false);
  });

  it('vue trop large : UN seul appel en base, borne écrite (5 000), et le DIT', async () => {
    lignes = arrets(12000);
    const corps = await (await appel()).json();
    expect(corps.nb_pois).toBe(5000);
    expect(corps.tronque).toBe(true);
    // Aucune requête de table paginée : chaque page refaisait le parcours de
    // l'index de catégorie (≈ 177 000 buffers sur la vue de Paris).
    expect(requetes).toBe(0);
    expect(appelsRpc.map((a) => a.nom)).toEqual(['lire_arrets_transport_bbox']);
    expect(appelsRpc[0].args).toMatchObject({ p_west: 5.4623, p_south: 43.2782, p_east: 5.9494, p_north: 43.5003, p_limite: 5000 });
  });

  it('échec de la RPC : message français, détail au journal', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    erreurRpc = { message: 'function lire_arrets_transport_bbox does not exist' };
    const res = await appel();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Lecture des arrêts de transport impossible.');
    expect(journal).toHaveBeenCalled();
  });
});

describe('GET /api/radio/stations', () => {
  it('compte les 1 175 radios, pas 1 000', async () => {
    lignes = radios(1175);
    const res = await stations.GET(new NextRequest('http://localhost/api/radio/stations?limit=8'));
    const corps = await res.json();
    expect(corps.total).toBe(1175);
    expect(corps.stations).toHaveLength(8);
  });
});

describe('GET /api/radio/emetteurs — message d erreur', () => {
  it('journalise le détail et rend un message français générique', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    erreurRpc = { message: 'Could not choose the best candidate function between: public.get_radio_emetteurs_geojson(...)' };
    const res = await emetteurs.GET(new NextRequest('http://localhost/api/radio/emetteurs?limit=15000'));
    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error).not.toMatch(/candidate|function|public\./i);
    expect(error).toMatch(/émetteurs radio/);
    expect(journal).toHaveBeenCalled();
    expect(String(journal.mock.calls[0].join(' '))).toMatch(/candidate/);
  });
});
