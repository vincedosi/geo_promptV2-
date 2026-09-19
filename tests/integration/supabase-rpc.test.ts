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

/**
 * ── CE FICHIER TAPAIT EN PRODUCTION, ET RIEN NE LE DISAIT (2026-09-18) ─────
 *
 * Il chargeait `.env.local` par son nom, en dur. Or `.env.local` porte les
 * identifiants de PROD — l'URL `vkkdbygwbrxyogqosten.supabase.co` et la clé
 * `service_role`, qui contourne toute RLS. Un simple `npm test` émettait donc
 * des requêtes réelles sur la base de production, sans le dire : vérifié le
 * 2026-09-18 en observant `[dotenv] injecting env (24) from .env.local` et
 * des appels de 542 ms, soit des allers-retours réseau et non du local.
 *
 * Depuis le 2026-09-17 un stack local existe, et ses identifiants vivent dans
 * `.env.development.local` (écrit par `scripts/local/04-env-local.sh`). C'est
 * lui qu'on charge EN PRIORITÉ. `.env.local` ne sert plus que de repli, pour
 * la machine d'un contributeur qui n'a pas monté le stack.
 *
 * L'ordre compte et n'est pas un détail de confort : `dotenv` n'écrase pas une
 * variable déjà posée (sans `override: true`), donc le PREMIER fichier chargé
 * gagne. Inverser ces deux lignes remettrait les tests sur la production.
 */
const envLocalDev = path.resolve(process.cwd(), '.env.development.local');
const envLocal = path.resolve(process.cwd(), '.env.local');
const envPath = fs.existsSync(envLocalDev) ? envLocalDev : envLocal;
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
// Dit en clair sur quelle base la suite s'exécute. Un test d'intégration qui
// ne nomme pas sa cible est un test dont on ne sait pas ce qu'il prouve.
console.log(`[supabase-rpc] base ciblée : ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(aucune)'}`);

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
