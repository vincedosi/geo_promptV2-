/**
 * Routes du clustering POI : plus de plafond silencieux à 1 000, et
 * « toutes les variables » entraîne enfin un modèle (T-serveur 5, lot 4).
 *
 * ── Le plafond ─────────────────────────────────────────────────────────────
 *
 * PostgREST applique `db-max-rows` = 1 000 à toute requête de table
 * (`CLAUDE.md` § « Troncature PostgREST »). Mesuré le 2026-10-11 :
 * `/api/poi-clusters/poi-types` lisait `poi_france` (390 029 lignes) sans
 * pagination et n'en recevait que 1 000 — l'étape 1 de l'assistant ne
 * proposait que « arret_transport 1 000 POIs ». Les comptes viennent désormais
 * d'une agrégation EN BASE (`types_poi_clustering`, sql/248, `RETURNS jsonb`).
 *
 * `GET /api/poi-clusters`, `/models/[version]` et `/[clusterId]` lisaient
 * `poi_clusters` sans pagination (95 lignes aujourd'hui) : coupées à 1 000 au
 * premier modèle national. Elles passent par `lireTout`.
 *
 * Le faux client ci-dessous reproduit le plafond : chaque requête de table rend
 * au plus 1 000 lignes, quoi qu'on demande.
 *
 * ── « Toutes les variables » ───────────────────────────────────────────────
 *
 * Avec les 16 variables cochées, l'assistant envoie `features: null`. La route
 * n'ajoutait alors pas `--features`, et le script n'enchaîne `full-retrain`
 * QUE si `--features` est fourni (`run_cache_isochrones`, « Chainage
 * automatique ») : le run réel de T20 a mis les isochrones en cache et
 * n'a entraîné aucun modèle, alors que l'en-tête de la route annonçait
 * « null = toutes ».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ALL_FEATURES } from '@/lib/clustering/feature-themes';

const MAX_ROWS = 1000;

type Ligne = Record<string, unknown>;
const tables: Record<string, Ligne[]> = {};
const appelsRpc: string[] = [];
const spawns: { cmd: string; args: string[] }[] = [];

function constructeur(table: string) {
  let filtres: ((l: Ligne) => boolean)[] = [];
  let tri: string | null = null;
  let de = 0;
  let a = Number.POSITIVE_INFINITY;
  let unique = false;
  let ecriture = false;
  let uriTropLongue = false;
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.insert = () => { ecriture = true; return c; };
  c.update = () => { ecriture = true; return c; };
  c.eq = (col: string, v: unknown) => { filtres.push((l) => l[col] === v); return c; };
  c.in = (col: string, vs: unknown[]) => {
    // Kong rend « URI too long » dès 250 UUID (mesuré le 2026-10-11) : 200 passe.
    if (vs.length > 200) uriTropLongue = true;
    const s = new Set(vs);
    filtres.push((l) => s.has(l[col]));
    return c;
  };
  c.order = (col: string) => { tri = col; return c; };
  c.limit = (n: number) => { a = Math.min(a, de + n - 1); return c; };
  c.range = (x: number, y: number) => { de = x; a = y; return c; };
  c.single = () => { unique = true; return c; };
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    if (uriTropLongue) return Promise.resolve({ data: null, error: { message: 'URI too long' } }).then(ok, ko);
    if (ecriture) {
      return Promise.resolve({ data: unique ? { id: 'job-1' } : null, error: null }).then(ok, ko);
    }
    let rows = (tables[table] ?? []).filter((l) => filtres.every((f) => f(l)));
    if (tri) {
      const t = tri;
      rows = [...rows].sort((x, y) => (String(x[t]) < String(y[t]) ? -1 : String(x[t]) > String(y[t]) ? 1 : 0));
    }
    // LE plafond : au plus 1 000 lignes, quoi qu'on demande.
    const fin = Math.min(a + 1, de + MAX_ROWS, rows.length);
    const page = rows.slice(de, Math.max(de, fin));
    filtres = [];
    return Promise.resolve({ data: unique ? page[0] ?? null : page, error: null }).then(ok, ko);
  };
  return c;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from: (t: string) => constructeur(t),
    rpc: async (nom: string) => {
      appelsRpc.push(nom);
      if (nom === 'types_poi_clustering') {
        // Ce que fait sql/248 : GROUP BY categorie en base, POI clusterisés distincts.
        const total = new Map<string, number>();
        for (const p of tables.poi_france ?? []) {
          const cat = String(p.categorie);
          total.set(cat, (total.get(cat) ?? 0) + 1);
        }
        const catParId = new Map((tables.poi_france ?? []).map((p) => [p.id, String(p.categorie)]));
        const clusterises = new Map<string, Set<unknown>>();
        for (const c of tables.poi_clusters ?? []) {
          const cat = catParId.get(c.poi_id);
          if (!cat) continue;
          if (!clusterises.has(cat)) clusterises.set(cat, new Set());
          clusterises.get(cat)!.add(c.poi_id);
        }
        const types = [...total.entries()]
          .map(([type, n]) => ({ type, total: n, clustered: clusterises.get(type)?.size ?? 0 }))
          .sort((x, y) => y.total - x.total);
        return { data: types, error: null };
      }
      return { data: null, error: { message: `rpc inconnue ${nom}` } };
    },
  }),
}));
vi.mock('@/lib/auth/perimetre-donnees', () => ({
  reserverAuSuperAdmin: async () => null,
}));
vi.mock('child_process', () => {
  const spawn = (cmd: string, args: string[]) => {
    spawns.push({ cmd, args });
    return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {} };
  };
  return { spawn, default: { spawn } };
});

/** `n` POI d'une catégorie, ids lisibles et triables. */
function poi(cat: string, n: number, depuis = 0): Ligne[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${cat}-${String(depuis + i).padStart(6, '0')}`,
    categorie: cat, nom: `${cat} ${i}`, lat: 45 + i / 1e5, lng: 2 + i / 1e5, ville: 'X',
  }));
}

function clusters(pois: Ligne[], version: number): Ligne[] {
  return pois.map((p, i) => ({
    id: i + 1, poi_id: p.id, cluster_id: i % 3, cluster_label: null,
    profile_features: {}, pca_components: [], n_carreaux_intersected: 1,
    population_totale_couverte: 1, imputed_features: [], model_version: version,
    duration_minutes: 15, mode: 'drive',
  }));
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  appelsRpc.length = 0;
  spawns.length = 0;
});

describe('GET /api/poi-clusters/poi-types — compté en base, pas sur 1 000 lignes', () => {
  it('rend le vrai total de chaque catégorie au-delà de 1 000 POI', async () => {
    const transport = poi('arret_transport', 1500);
    const bmw = poi('bmw', 177);
    tables.poi_france = [...transport, ...bmw];
    tables.poi_clusters = clusters(bmw.slice(0, 40), 3);

    const { GET } = await import('@/app/api/poi-clusters/poi-types/route');
    const res = await GET(new NextRequest('http://x/api/poi-clusters/poi-types'));
    expect(res.status).toBe(200);
    const { types } = await res.json();

    expect(types).toEqual([
      { type: 'arret_transport', total: 1500, clustered: 0, has_clusters: false },
      { type: 'bmw', total: 177, clustered: 40, has_clusters: true },
    ]);
    expect(appelsRpc).toEqual(['types_poi_clustering']);
  });
});

describe('POST /api/poi-clusters/run — « toutes les variables » entraîne un modèle', () => {
  async function lancer(features: unknown) {
    const { POST } = await import('@/app/api/poi-clusters/run/route');
    return POST(new NextRequest('http://x/api/poi-clusters/run', {
      method: 'POST',
      body: JSON.stringify({
        poi_types: ['bmw'],
        params: { duration: 15, transport: 'drive' },
        features,
      }),
    }));
  }
  function valeurDe(args: string[], option: string): string | undefined {
    const i = args.indexOf(option);
    return i < 0 ? undefined : args[i + 1];
  }

  it('features null : passe les 16 variables, ce qui enchaîne full-retrain', async () => {
    const res = await lancer(null);
    expect(res.status).toBe(201);
    expect(spawns).toHaveLength(1);
    expect(valeurDe(spawns[0].args, '--features')).toBe(ALL_FEATURES.join(','));
  });

  it('features absent : même chose que null', async () => {
    await lancer(undefined);
    expect(valeurDe(spawns[0].args, '--features')).toBe(ALL_FEATURES.join(','));
  });

  it('features [] : même chose que null (aucune sélection = toutes)', async () => {
    await lancer([]);
    expect(valeurDe(spawns[0].args, '--features')).toBe(ALL_FEATURES.join(','));
  });

  it('une sélection explicite part telle quelle', async () => {
    await lancer(['demographie', 'revenu_moyen']);
    expect(valeurDe(spawns[0].args, '--features')).toBe('demographie,revenu_moyen');
  });

  it('la liste complète vient de la source unique et compte 16 variables', () => {
    expect(ALL_FEATURES).toHaveLength(16);
  });
});

describe('lectures de poi_clusters — paginées, plus coupées à 1 000', () => {
  it('GET /api/poi-clusters rend les 1 500 POI d un modèle', async () => {
    const pois = poi('lycee', 1500);
    tables.poi_france = pois;
    tables.poi_clusters = clusters(pois, 7);
    tables.clustering_models = [{
      version: 7, k: 3, duration_minutes: 15, mode: 'drive',
      cluster_labels: {}, cluster_avg_profiles: {}, feature_names: [],
    }];

    const { GET } = await import('@/app/api/poi-clusters/route');
    const res = await GET(new NextRequest('http://x/api/poi-clusters?duration=15'));
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.features).toHaveLength(1500);
    const total = Object.values(corps.metadata.cluster_summary as Record<string, { count: number }>)
      .reduce((s, c) => s + c.count, 0);
    expect(total).toBe(1500);
  });

  it('GET /api/poi-clusters/models/[version] rend les 1 500 POI, avec leurs coordonnées', async () => {
    const pois = poi('lycee', 1500);
    tables.poi_france = pois;
    tables.poi_clusters = clusters(pois, 7);
    tables.clustering_models = [{
      version: 7, k: 3, duration_minutes: 15, mode: 'drive',
      cluster_labels: {}, cluster_avg_profiles: {}, feature_names: [],
    }];

    const { GET } = await import('@/app/api/poi-clusters/models/[version]/route');
    const res = await GET(new NextRequest('http://x/api/poi-clusters/models/7'), { params: Promise.resolve({ version: '7' }) });
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.poi_list).toHaveLength(1500);
    expect(corps.poi_list.every((p: { lat?: number }) => typeof p.lat === 'number')).toBe(true);
  });

  it('GET /api/poi-clusters/[clusterId] rend les 1 200 POI d un cluster, avec leurs noms', async () => {
    const pois = poi('lycee', 1200);
    tables.poi_france = pois;
    tables.poi_clusters = clusters(pois, 7).map((c) => ({ ...c, cluster_id: 2 }));
    tables.clustering_models = [{ version: 7, cluster_labels: {}, cluster_avg_profiles: {}, feature_names: [] }];

    const { GET } = await import('@/app/api/poi-clusters/[clusterId]/route');
    const res = await GET(new NextRequest('http://x/api/poi-clusters/2'), { params: Promise.resolve({ clusterId: '2' }) });
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.pois).toHaveLength(1200);
    expect(corps.pois.every((p: { nom?: string }) => typeof p.nom === 'string')).toBe(true);
  });
});
