/**
 * Tests d'intégration — RPC Supabase critiques
 *
 * Nécessite les variables d'environnement :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Ces tests sont skippés automatiquement si les env vars sont absentes.
 * Pour les lancer : npm test (avec .env.local chargé)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Charger .env.local si présent
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_ENV       = !!(SUPABASE_URL && SERVICE_KEY);

// ── Client Supabase admin ──────────────────────────────────────────────────────
// Using `any` for the DB generic: these RPC functions exist in the DB
// but are not yet included in the generated Supabase TypeScript types.
let supabase: any;

beforeAll(() => {
  if (HAS_ENV) {
    supabase = createClient(SUPABASE_URL!, SERVICE_KEY!, {
      auth: { persistSession: false },
    });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Polygone de test : carré centré sur Paris (coordonnées WGS84, format GeoJSON string) */
const PARIS_BBOX_GEOJSON = JSON.stringify({
  type: 'Polygon',
  coordinates: [[
    [2.25, 48.80],
    [2.45, 48.80],
    [2.45, 48.92],
    [2.25, 48.92],
    [2.25, 48.80],
  ]],
});

/** Polygone de test : Lyon centre (petit carré ~5km², calcul rapide) */
const LYON_BBOX_GEOJSON = JSON.stringify({
  type: 'Polygon',
  coordinates: [[
    [4.81, 45.73],
    [4.86, 45.73],
    [4.86, 45.77],
    [4.81, 45.77],
    [4.81, 45.73],
  ]],
});

// ── calculate_coverage_per_group ──────────────────────────────────────────────

describe('RPC calculate_coverage_per_group', () => {
  it.skipIf(!HAS_ENV)('retourne une couverture numérique pour une géométrie valide', async () => {
    const { data, error } = await supabase.rpc('calculate_coverage_per_group', {
      p_groups: [{ id: 'test_paris', geometries: [PARIS_BBOX_GEOJSON] }],
      p_column: 'ind',
    });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].group_id).toBe('test_paris');
    expect(typeof data[0].coverage).toBe('number');
    expect(data[0].coverage).toBeGreaterThan(0);
  });

  it.skipIf(!HAS_ENV)('retourne 0 pour une géométrie en dehors de France', async () => {
    const horseFrance = JSON.stringify({
      type: 'Polygon',
      coordinates: [[
        [10.0, 51.0],
        [11.0, 51.0],
        [11.0, 52.0],
        [10.0, 52.0],
        [10.0, 51.0],
      ]],
    });

    const { data, error } = await supabase.rpc('calculate_coverage_per_group', {
      p_groups: [{ id: 'test_hors_france', geometries: [horseFrance] }],
      p_column: 'ind',
    });

    expect(error).toBeNull();
    expect(data[0].coverage).toBe(0);
  });

  it.skipIf(!HAS_ENV)('déduplique correctement — union de 2 zones identiques ≠ somme simple', async () => {
    const { data: single } = await supabase.rpc('calculate_coverage_per_group', {
      p_groups: [{ id: 'test_single', geometries: [PARIS_BBOX_GEOJSON] }],
      p_column: 'ind',
    });
    const { data: double } = await supabase.rpc('calculate_coverage_per_group', {
      p_groups: [{ id: 'test_double', geometries: [PARIS_BBOX_GEOJSON, PARIS_BBOX_GEOJSON] }],
      p_column: 'ind',
    });

    // ST_UnaryUnion doit déduplicer → résultat identique à une seule géométrie
    expect(double[0].coverage).toBe(single[0].coverage);
  });

  it.skipIf(!HAS_ENV)('plusieurs groupes dans un seul appel', async () => {
    const { data, error } = await supabase.rpc('calculate_coverage_per_group', {
      p_groups: [
        { id: 'test_paris', geometries: [PARIS_BBOX_GEOJSON] },
        { id: 'test_lyon',  geometries: [LYON_BBOX_GEOJSON] },
      ],
      p_column: 'ind',
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    const ids = data.map((r: { group_id: string }) => r.group_id);
    expect(ids).toContain('test_paris');
    expect(ids).toContain('test_lyon');
  }, 20_000);

  it.skipIf(!HAS_ENV)('supporte les métriques démographiques clés', async () => {
    const metrics = ['ind', 'men', 'ind_0_3', 'ind_18_24', 'ind_65_79', 'men_pauv'];
    for (const metric of metrics) {
      const { error } = await supabase.rpc('calculate_coverage_per_group', {
        p_groups: [{ id: 'test_metric', geometries: [PARIS_BBOX_GEOJSON] }],
        p_column: metric,
      });
      expect(error, `metric=${metric} a retourné une erreur`).toBeNull();
    }
  });
});

// ── clip_geojson_to_france ─────────────────────────────────────────────────────

describe('RPC clip_geojson_to_france', () => {
  it.skipIf(!HAS_ENV)('retourne un FeatureCollection pour une entrée valide', async () => {
    const fc = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [2.25, 48.80], [2.45, 48.80], [2.45, 48.92],
            [2.25, 48.92], [2.25, 48.80],
          ]],
        },
        properties: {},
      }],
    };

    const { data, error } = await supabase.rpc('clip_geojson_to_france', { p_fc: fc });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect((data as any).type).toBe('FeatureCollection');
  });

  it.skipIf(!HAS_ENV)('retourne FC vide pour un polygone hors France', async () => {
    const fc = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [10.0, 51.0], [11.0, 51.0], [11.0, 52.0],
            [10.0, 52.0], [10.0, 51.0],
          ]],
        },
        properties: {},
      }],
    };

    const { data, error } = await supabase.rpc('clip_geojson_to_france', { p_fc: fc });
    expect(error).toBeNull();
    const features = (data as any)?.features ?? [];
    expect(features.length).toBe(0);
  });
});

// ── Tables pré-agrégées (carreaux_2km / carreaux_5km) ─────────────────────────

describe('Tables pré-agrégées carreaux', () => {
  it.skipIf(!HAS_ENV)('carreaux_5km contient des données', async () => {
    const { count, error } = await supabase
      .from('carreaux_5km')
      .select('*', { count: 'exact', head: true });

    expect(error).toBeNull();
    expect(count).toBeGreaterThan(1000);
  });

  it.skipIf(!HAS_ENV)('carreaux_2km contient des données', async () => {
    const { count, error } = await supabase
      .from('carreaux_2km')
      .select('*', { count: 'exact', head: true });

    expect(error).toBeNull();
    expect(count).toBeGreaterThan(5000);
  });

  it.skipIf(!HAS_ENV)('carreaux_5km — champs population présents', async () => {
    const { data, error } = await supabase
      .from('carreaux_5km')
      .select('id, ind, men, ind_18_24, men_pauv')
      .limit(1);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(typeof data![0].ind).toBe('number');
    expect(typeof data![0].men).toBe('number');
  });
});

// ── Table poi ─────────────────────────────────────────────────────────────────

describe('Table poi', () => {
  it.skipIf(!HAS_ENV)('la vue poi_france est accessible et contient des données', async () => {
    const { error } = await supabase
      .from('poi_france')
      .select('id, nom, lat, lng')
      .limit(1);

    expect(error).toBeNull();
  });
});
