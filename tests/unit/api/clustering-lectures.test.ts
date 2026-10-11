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
