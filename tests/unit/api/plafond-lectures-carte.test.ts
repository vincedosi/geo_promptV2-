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
 *
 * Le même plafond mord AUSSI les RPC `RETURNS TABLE` (`max_rows` local = 1 000,
 * mesuré le 2026-10-10 : `get_zone_centroids('cp')` → 1 000 sur 6 187,
 * `codes_postaux_dans_bbox` métropole → 1 000 sur 6 051). Le faux client coupe
 * donc à 1 000 ces RPC tabulaires ; leurs remplaçantes `jsonb` rendent tout.
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
      if (nom === 'get_zone_centroids') return { data: zonesMeteo.slice(0, MAX_ROWS), error: null };
      if (nom === 'get_zone_centroids_jsonb') {
        // Ce que fait sql/243 : filtre la bbox en base, rend au plus p_limite zones et `tronque`.
        const avecBbox = args.p_ouest != null;
        const dedans = zonesMeteo.filter((z) => !avecBbox || (
          z.lon >= Number(args.p_ouest) && z.lon <= Number(args.p_est)
          && z.lat >= Number(args.p_sud) && z.lat <= Number(args.p_nord)));
        const limite = Number(args.p_limite ?? 10000);
        return { data: { zones: dedans.slice(0, limite), tronque: dedans.length > limite }, error: null };
      }
      if (nom === 'codes_postaux_dans_bbox' || nom === 'codes_postaux_dans_bbox_jsonb') {
        const dedans = cpsBboxForces ?? referentielCp().filter((z) =>
          z.lon >= Number(args.p_ouest) && z.lon <= Number(args.p_est)
          && z.lat >= Number(args.p_sud) && z.lat <= Number(args.p_nord)).map((z) => z.code);
        // RETURNS TABLE : coupée à 1 000 ; la jumelle jsonb (sql/245) rend tout.
        return nom === 'codes_postaux_dans_bbox'
          ? { data: dedans.slice(0, MAX_ROWS).map((code) => ({ code_postal: code })), error: null }
          : { data: dedans, error: null };
      }
      if (nom === 'lire_sante_cp_jsonb') {
        // Ce que fait sql/244 : date la plus récente, seuil, bbox par le centroïde du CP, borne + `tronque`.
        if (!lignes.length) return { data: { date: null, rows: [], tronque: false }, error: null };
        const centroides = new Map(referentielCp().map((z) => [z.code, z]));
        const avecBbox = args.p_ouest != null;
        const retenues = lignes.filter((l) => {
          const z = centroides.get(String(l.code_postal));
          return Number(l.indice_global) >= Math.max(Number(args.p_niveau_min), 1) && (!avecBbox || (!!z
            && z.lon >= Number(args.p_ouest) && z.lon <= Number(args.p_est)
            && z.lat >= Number(args.p_sud) && z.lat <= Number(args.p_nord)));
        });
        const limite = Number(args.p_limite);
        return {
          data: {
            date: lignes[0].date_ech,
            rows: retenues.slice(0, limite).map(({ date_ech: _d, ...l }) => l),
            tronque: retenues.length > limite,
          },
          error: null,
        };
      }
      if (nom === 'calculer_score_composite' || nom === 'calculer_score_composite_jsonb') {
        // Un score par CP demandé, croissant avec son rang : les meilleurs sont EN FIN de liste.
        const cps = args.p_codes_postaux as string[];
        const scores = cps.map((code, i) => ({
          postal_code: code, score: Math.round((1000 * i) / cps.length) / 10, n_indicateurs: 1,
        }));
        // RETURNS TABLE : coupée à 1 000 ; la jumelle jsonb (sql/170) rend tout.
        return { data: nom === 'calculer_score_composite' ? scores.slice(0, MAX_ROWS) : scores, error: null };
      }
      if (nom === 'get_admin_filter_geometry') {
        const codes = args.p_codes as string[];
        return { data: { geometry: { type: 'MultiPolygon', coordinates: [], n: codes.length } }, error: null };
      }
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
  requireAuth: async () => ({ id: 'u', organization_id: 'o' }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/api/rate-limit', () => ({
  createRateLimiter: () => async () => ({ ok: true }),
  // Le score lit les messages de refus de la couverture (lib/zones/couverture.ts), qui déclare son quota au chargement.
  createQuota: () => async () => null,
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
// Le cache fichier de la météo survit d'une exécution à l'autre : sans ce
// faux, une seconde exécution lirait le cache et ne toucherait plus la base.
vi.mock('fs/promises', () => ({
  readFile: async () => { throw new Error('pas de cache'); },
  stat: async () => { throw new Error('pas de cache'); },
  writeFile: async () => undefined,
  mkdir: async () => undefined,
}));
// Ingestion santé : aucun appel réseau, seul le chargement du référentiel compte ici.
vi.mock('@/lib/civic-health/wfs-civic', () => ({
  fetchPollenBulkWfs: async () => null,
  fetchAtmoBulkWfs: async () => null,
}));
vi.mock('@/lib/civic-health/provider', () => ({ getProvider: () => ({ name: 'aucun' }) }));
vi.mock('@/lib/auth/perimetre-donnees', () => ({
  sourcesVisiblesDeLaRequete: async () => null,
  filtrerParSourcesVisibles: (q: unknown) => q,
  // Le score accepte un indicateur visible (sql/288) ; ce test porte sur le plafond, pas sur les droits.
  indicateursVisibles: async () => ({ visibles: { has: () => true }, propres: new Set() }),
}));

const ooh = await import('@/app/api/map/ooh/route');
const transport = await import('@/app/api/map/transport/route');
const stations = await import('@/app/api/radio/stations/route');
const emetteurs = await import('@/app/api/radio/emetteurs/route');
const meteo = await import('@/app/api/meteo-geo/route');
const santeCarte = await import('@/app/api/civic-indicators/health-map/route');
const score = await import('@/app/api/analyses/score/route');
const sourceScore = await import('@/app/api/custom-geo/source/score/route');
const ingestion = await import('@/lib/civic-health/civic-ingest');

interface ZoneMeteo { code: string; nom: string; lat: number; lon: number }
/** Le référentiel : 6 051 CP en métropole (grille), puis 136 ultramarins EN FIN de liste, comme en base. */
const referentielCp = (): ZoneMeteo[] => [
  ...Array.from({ length: 6051 }, (_, i) => ({
    code: String(1000 + i).padStart(5, '0'), nom: `CP ${i}`,
    lat: 42.5 + (i % 80) * 0.1, lon: -4 + Math.floor(i / 80) * 0.15,
  })),
  ...Array.from({ length: 136 }, (_, i) => ({
    code: `974${String(i).padStart(2, '0')}`, nom: `Réunion ${i}`,
    lat: -21.1 + (i % 10) * 0.02, lon: 55.3 + Math.floor(i / 10) * 0.02,
  })),
];
let zonesMeteo: ZoneMeteo[] = [];
/** Codes rendus pour toute bbox, quand un test veut un périmètre précis. */
let cpsBboxForces: string[] | null = null;

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
  zonesMeteo = [];
  cpsBboxForces = null;
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

describe('GET /api/meteo-geo?scale=cp', () => {
  const hier = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const appel = (bbox: string) => meteo.GET(new NextRequest(
    `http://localhost/api/meteo-geo?scale=cp&variable=precipitation&startDate=${hier}&endDate=${hier}&bbox=${bbox}`,
  ));
  /** Lit le flux NDJSON jusqu'à sa dernière ligne. */
  const derniereLigne = async (res: Response) => {
    const lignesFlux = (await res.text()).trim().split('\n');
    return JSON.parse(lignesFlux[lignesFlux.length - 1]);
  };

  beforeEach(() => {
    zonesMeteo = referentielCp();
    // Open-Meteo : une série par point demandé (latitude=a,b,c…).
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const n = new URL(String(url)).searchParams.get('latitude')!.split(',').length;
      const series = Array.from({ length: n }, () => ({ daily: { time: [hier], precipitation_sum: [2] } }));
      return new Response(JSON.stringify(series), { status: 200 });
    });
  });

  it('France métropole : les 6 051 CP de la bbox, pas 1 000', async () => {
    const fin = await derniereLigne(await appel('-5.5,41,10,51.5'));
    expect(fin.status).toBe('done');
    expect(fin.meta.totalZones).toBe(6051);
    expect(Object.keys(fin.data)).toHaveLength(6051);
  });

  it('La Réunion : ses 136 CP, et non la métropole par repli', async () => {
    const fin = await derniereLigne(await appel('55.2,-21.4,55.9,-20.8'));
    expect(fin.status).toBe('done');
    expect(fin.meta.totalZones).toBe(136);
    expect(Object.keys(fin.data).every((c) => c.startsWith('974'))).toBe(true);
  });

  it('UN appel en base, bbox arrondie vers l extérieur, borne écrite (10 000)', async () => {
    await derniereLigne(await appel('4.33,45.5,5.1,46.25'));
    expect(appelsRpc.map((a) => a.nom)).toEqual(['get_zone_centroids_jsonb']);
    expect(appelsRpc[0].args).toEqual({
      p_scale: 'cp', p_ouest: 4, p_sud: 45.5, p_est: 5.5, p_nord: 46.5, p_limite: 10000,
    });
  });

  it('vue sans aucun CP : le dit en français, sans repli sur la France entière', async () => {
    const fin = await derniereLigne(await appel('-30,30,-25,35'));
    expect(fin.status).toBe('error');
    expect(fin.error).toMatch(/aucun code postal/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('borne atteinte : échoue en français plutôt que de peindre un début', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    zonesMeteo = Array.from({ length: 10001 }, (_, i) => ({ code: String(i), nom: '', lat: 46, lon: 2 }));
    const res = await appel('-5.5,41,10,51.5');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/codes postaux/);
  });
});

describe('GET /api/civic-indicators/health-map?scale=cp', () => {
  const appel = (suite = '') => santeCarte.GET(new NextRequest(
    `http://localhost/api/civic-indicators/health-map?dataset=pollen&scale=cp&min_level=0&metric=global${suite}`,
  ));
  /** Un jour national : une ligne par CP du référentiel (6 187), toutes peintes. */
  const jourNational = () => referentielCp().map((z) => ({
    date_ech: '2026-10-10', code_postal: z.code, indice_global: 3,
  }));

  it('sans bbox : les 6 187 CP du jour, pas 1 000', async () => {
    lignes = jourNational();
    const corps = await (await appel()).json();
    expect(corps.date).toBe('2026-10-10');
    expect(corps.rows).toHaveLength(6187);
  });

  it('bbox métropole : les 6 051 CP, pas les 1 000 premiers codes de la bbox', async () => {
    lignes = jourNational();
    const corps = await (await appel('&bbox=-5.5,41,10,51.5')).json();
    expect(corps.rows).toHaveLength(6051);
  });

  it('UN appel en base, zéro lecture de table, borne écrite (10 000)', async () => {
    lignes = jourNational();
    await appel('&bbox=4.33,45.5,5.1,46.25');
    expect(requetes).toBe(0);
    expect(appelsRpc.map((a) => a.nom)).toEqual(['lire_sante_cp_jsonb']);
    expect(appelsRpc[0].args).toEqual({
      p_jeu: 'pollen', p_metrique: 'global', p_niveau_min: 1,
      p_ouest: 4.33, p_sud: 45.5, p_est: 5.1, p_nord: 46.25, p_limite: 10000,
    });
  });

  it('table vide : no_data, comme avant', async () => {
    const corps = await (await appel()).json();
    expect(corps).toEqual({ date: null, rows: [], error: 'no_data' });
  });

  it('borne atteinte : échoue en français plutôt que de peindre un début', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lignes = Array.from({ length: 10001 }, (_, i) => ({ date_ech: '2026-10-10', code_postal: String(i), indice_global: 2 }));
    const res = await appel();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/codes postaux/);
  });

  it('échec de la RPC : message français, détail au journal', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    erreurRpc = { message: 'function lire_sante_cp_jsonb does not exist' };
    const res = await appel();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Lecture de la santé environnementale impossible.');
    expect(journal).toHaveBeenCalled();
  });
});

describe('POST /api/analyses/score — périmètre par bbox', () => {
  const appel = () => score.POST(new NextRequest('http://localhost/api/analyses/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      indicateurs: [{ code: 'revenu_median', poids: 1, sens: 'croissant' }],
      bbox: [-5.5, 41, 10, 51.5],
      enregistrer: false,
    }),
  }));

  it('lit la bbox par la jumelle jsonb, jamais par la RPC tabulaire', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await appel();
    const noms = appelsRpc.map((a) => a.nom);
    expect(noms).toContain('codes_postaux_dans_bbox_jsonb');
    expect(noms).not.toContain('codes_postaux_dans_bbox');
  });

  it('compte TOUS les codes de la bbox : 7 100 dépassent le plafond (7 000), et le disent', async () => {
    // Avant : 1 000 codes rendus, sous le plafond — un score sur un septième de la zone.
    cpsBboxForces = Array.from({ length: 7100 }, (_, i) => String(10000 + i));
    const res = await appel();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/7100 codes postaux/);
  });
});

describe('POST /api/custom-geo/source/score — zone de plus de 1 000 codes postaux', () => {
  /** 1 429 CP : Auvergne-Rhône-Alpes + Occitanie, mesuré en base le 2026-10-10. */
  const zone = Array.from({ length: 1429 }, (_, i) => String(10000 + i));
  const appel = (seuil: number) => sourceScore.POST(new NextRequest('http://localhost/api/custom-geo/source/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      indicateurs: [{ code: 'rev_median', poids: 1, sens: 'croissant' }],
      codes_postaux: zone,
      seuil,
    }),
  }));

  it('lit le score par la jumelle jsonb, jamais par la RPC tabulaire', async () => {
    await appel(80);
    const noms = appelsRpc.map((a) => a.nom);
    expect(noms).toContain('calculer_score_composite_jsonb');
    expect(noms).not.toContain('calculer_score_composite');
  });

  it('retient les CP au-dessus du seuil sur les 1 429, pas sur les 1 000 premiers', async () => {
    // Avant : les 429 derniers CP — ceux du haut du classement — n'existaient pas,
    // et la zone « score ≥ 80 » sortait VIDE, sans aucune erreur.
    const res = await appel(80);
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.count).toBe(286);
    expect(corps.codes).toContain(zone[1428]);
  });
});

describe('POST /api/admin/civic-ingest — référentiel codes postaux ↔ communes', () => {
  /** 35 358 liaisons en base (mesuré le 2026-10-10), une commune distincte par liaison ici. */
  const liaisons = (n: number) => Array.from({ length: n }, (_, i) => ({
    code_postal: String(1000 + Math.floor(i / 6)).padStart(5, '0'), code_commune: `C${i}`,
  }));

  it('charge les 35 358 liaisons, pas les 1 000 premières', async () => {
    lignes = liaisons(35358);
    const etapes: string[] = [];
    const bilan = await ingestion.runCivicIngest((p) => etapes.push(p.message));
    expect(bilan.communes_mapping).toBe(35358);
    expect(etapes.some((m) => m.startsWith('35358 liaisons'))).toBe(true);
  });

  it('au-delà de la borne écrite (60 000), échoue plutôt que d ingérer un début', async () => {
    lignes = liaisons(60001);
    await expect(ingestion.runCivicIngest()).rejects.toThrow(/mapping_failed/);
  });
});
