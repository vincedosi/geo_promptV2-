/**
 * /api/network-coverage/route.ts
 *
 * Calcule l'empreinte démographique totale d'un réseau de POI :
 *   1. Fetch POIs (avec filtre géo optionnel)
 *   2. Calcul isochrones ORS par batches
 *   3. Simplification géométries côté JS
 *   4. RPC Supabase calculate_network_coverage_v2 → prorata carreaux
 *
 * ⚠ AUCUNE connexion Postgres directe — tout via supabase.rpc()
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';
import { ORS_PROFILES }              from '@/lib/isochrones/fetcher';
import { resolveCategory }           from '@/lib/geo/locations';
import { fetchPois }                 from '@/lib/geo/fetchPois';

export const maxDuration = 300;

const ORS_BATCH       = 5;
const ORS_RETRIES     = 2;    // 2 tentatives max (fail vite pour les POIs hors réseau)
const ORS_TIMEOUT     = 8_000; // 8s suffit pour la plupart des isochrones
const ORS_RETRY_DELAY = 3_000; // 3s entre retries (pas 20s)

/** Appelle ORS pour un array de locations. Retourne features[] ou null si échec total. */
async function callORS(
  locations: number[][],
  rangeSec:  number,
  profile:   string,
  apiKey:    string,
  batchNum:  number,
  totalBatches: number,
  timeout:   number,
  retryDelay: number,
  maxRetries: number
): Promise<any[] | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(
        `https://api.openrouteservice.org/v2/isochrones/${profile}`,
        {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Authorization': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json, application/geo+json' },
          body: JSON.stringify({ locations, range: [rangeSec], range_type: 'time' }),
        }
      );
      clearTimeout(timer);
      console.log(`[net-cov] ORS batch ${batchNum}/${totalBatches} attempt ${attempt + 1} → HTTP ${res.status}, remaining=${res.headers.get('x-ratelimit-remaining')}`);

      if (res.status === 429) {
        console.warn(`[net-cov] Rate limit, waiting ${retryDelay / 1000}s…`);
        await new Promise(r => setTimeout(r, retryDelay));
        continue;
      }
      if (!res.ok) {
        const errText = await res.text();
        console.error(`[net-cov] ORS HTTP ${res.status}: ${errText.slice(0, 200)}`);
        return null; // 4xx non-429 : inutile de retry
      }
      const data  = await res.json();
      const feats = data.features ?? [];
      console.log(`[net-cov] Batch ${batchNum} OK: ${feats.length} feature(s) pour ${locations.length} location(s)`);
      return feats;
    } catch (e: any) {
      clearTimeout(timer);
      const msg = e.name === 'AbortError' ? `Timeout ${timeout / 1000}s` : e.message;
      console.error(`[net-cov] Batch ${batchNum} attempt ${attempt + 1} error: ${msg}`);
      if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 3_000));
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 }); }

  const {
    poi_category,
    travel_time_minutes,
    target_demo_column,
    target_demo_label,
    mode              = 'drive',
    region            = null,
    ville             = null,
    departement       = null,
    force_recalculate = false,
  } = body;

  if (!poi_category)       return NextResponse.json({ error: 'poi_category requis.' }, { status: 400 });
  if (!target_demo_column) return NextResponse.json({ error: 'target_demo_column requis.' }, { status: 400 });

  const minutes  = Number(travel_time_minutes);
  const rangeSec = minutes * 60;
  const profile  = ORS_PROFILES[mode] ?? 'driving-car';
  const apiKey   = process.env.ORS_API_KEY;

  if (!apiKey) return NextResponse.json({ error: 'ORS_API_KEY non configurée côté serveur.' }, { status: 500 });

  const supabase = createAdminClient();

  // ── 1. Résolution catégorie + fetch POIs ──────────────────────────────────
  const { data: catRows } = await supabase.from('poi_france').select('categorie').limit(1000);
  const validCats = [...new Set((catRows ?? []).map((r: any) => r.categorie as string))];
  const resolvedCategory = resolveCategory(poi_category, validCats);

  console.log(`[net-cov] resolvedCategory="${resolvedCategory}" (requested="${poi_category}")`);

  const { pois, error: poisErr } = await fetchPois(supabase, resolvedCategory, poi_category, {
    region, ville, departement, limit: 5000,
  });
  if (poisErr) return NextResponse.json({ error: `Supabase POI error: ${poisErr}` }, { status: 500 });

  console.log(`[net-cov] ${pois.length} POIs, scope=${ville ?? region ?? departement ?? 'France'}, ${minutes}min ${mode} (${profile})`);

  if (pois.length === 0) {
    const hint = ville ?? region ?? departement;
    return NextResponse.json({ error: `Aucun POI "${poi_category}"${hint ? ` dans "${hint}"` : ''}.` }, { status: 404 });
  }

  // ── 2. Cache check ────────────────────────────────────────────────────────
  const geoTag   = (ville ?? region ?? departement ?? 'france').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_');
  const cacheKey = `network__${(resolvedCategory ?? poi_category).toLowerCase()}__${geoTag}__${minutes}min__${mode}`;
  const geoScope = ville ?? region ?? departement ?? 'France';

  if (!force_recalculate) {
    const { data: cached, error: cacheErr } = await supabase.from('isochrones_cache').select('geojson, created_at, poi_count').eq('cache_key', cacheKey).single();
    if (cacheErr && cacheErr.code !== 'PGRST116') { // PGRST116 = no rows
      console.warn(`[net-cov] Cache lookup error (non-fatal): ${cacheErr.message}`);
    }
    if (cached?.geojson) {
      console.log(`[net-cov] Cache HIT: ${cacheKey}`);
      const geojsonData = cached.geojson as any;
      // If coverage result was stored alongside features, return it directly (no RPC call)
      if (geojsonData._coverage) {
        console.log(`[net-cov] Cache HIT with stored coverage, skipping RPC`);
        return NextResponse.json({
          poi_category:        resolvedCategory ?? poi_category,
          travel_time_minutes: minutes,
          mode,
          target_demo_column,
          target_demo_label,
          nb_pois:             pois.length,
          from_cache:          true,
          geo_scope:           geoScope,
          ...geojsonData._coverage,
        });
      }
      const cachedFeatures: any[] = geojsonData.features ?? [];
      return await computeCoverage(supabase, cachedFeatures, target_demo_column, target_demo_label, poi_category, resolvedCategory, minutes, mode, pois.length, geoScope, true);
    }
    console.log(`[net-cov] Cache MISS: ${cacheKey}`);
  }

  // ── 3. ORS batch isochrones ───────────────────────────────────────────────
  const allFeatures: any[] = [];
  const batchErrors: string[] = [];
  const sliced = pois.slice(0, 300);
  const totalBatches = Math.ceil(sliced.length / ORS_BATCH);

  console.log(`[net-cov] ORS: ${sliced.length} POIs → ${totalBatches} batches, range=${rangeSec}s`);

  for (let i = 0; i < sliced.length; i += ORS_BATCH) {
    const batch    = sliced.slice(i, i + ORS_BATCH);
    const batchNum = Math.floor(i / ORS_BATCH) + 1;
    const locations = batch.map(p => [p.lng, p.lat]);

    const batchFeats = await callORS(locations, rangeSec, profile, apiKey, batchNum, totalBatches, ORS_TIMEOUT, ORS_RETRY_DELAY, ORS_RETRIES);

    if (batchFeats !== null) {
      // Inject POI name into feature properties so the SQL breakdown can use it
      batchFeats.forEach((feat: any, idx: number) => {
        feat.properties = feat.properties ?? {};
        feat.properties.poi_name = batch[idx]?.nom ?? `POI ${i + idx}`;
      });
      allFeatures.push(...batchFeats);
    } else {
      // Fallback : appels individuels pour isoler le POI problématique (île, coords hors réseau…)
      console.warn(`[net-cov] Batch ${batchNum} failed → fallback individuel pour ${batch.length} POIs`);
      for (const poi of batch) {
        const singleFeats = await callORS([[poi.lng, poi.lat]], rangeSec, profile, apiKey, batchNum, totalBatches, ORS_TIMEOUT, ORS_RETRY_DELAY, 1);
        if (singleFeats !== null && singleFeats.length > 0) {
          singleFeats.forEach((feat: any) => {
            feat.properties = feat.properties ?? {};
            feat.properties.poi_name = poi.nom;
          });
          allFeatures.push(...singleFeats);
          console.log(`[net-cov] Fallback OK: ${poi.nom} → ${singleFeats.length} feature(s)`);
        } else {
          const msg = `POI ignoré (ORS failed): ${poi.nom} [${poi.lng}, ${poi.lat}]`;
          console.warn(`[net-cov] ${msg}`);
          batchErrors.push(msg);
        }
      }
    }
  }

  console.log(`[net-cov] ORS done: ${allFeatures.length} features total, ${batchErrors.length} batch errors`);

  if (allFeatures.length === 0) {
    const errDetail = batchErrors.length > 0 ? ` Erreurs: ${batchErrors.join(' | ')}` : '';
    return NextResponse.json({
      error: `ORS n'a retourné aucun isochrone pour ${sliced.length} POIs (${minutes}min ${mode}).${errDetail}`,
    }, { status: 500 });
  }

  // ── 4. Sauvegarde cache des isochrones (sans coverage encore) ────────────
  const geojsonToCache: any = { type: 'FeatureCollection', features: allFeatures };
  const { error: saveErr } = await supabase.from('isochrones_cache').upsert(
    { cache_key: cacheKey, ville: geoScope, categorie: resolvedCategory ?? poi_category, minutes, mode, geojson: geojsonToCache, poi_count: sliced.length, created_at: new Date().toISOString() },
    { onConflict: 'cache_key' }
  );
  if (saveErr) console.error(`[net-cov] Cache save error: ${saveErr.message}`);
  else console.log(`[net-cov] Cache saved (features): ${cacheKey}`);

  // ── 5. PostGIS coverage ───────────────────────────────────────────────────
  const coverageResponse = await computeCoverage(supabase, allFeatures, target_demo_column, target_demo_label, poi_category, resolvedCategory, minutes, mode, pois.length, geoScope, false);

  // ── 6. Mettre à jour le cache avec le résultat coverage ─────────────────
  // Permet de retourner le résultat directement sur cache hit sans appeler le RPC
  try {
    const coverageBody = await coverageResponse.clone().json();
    if (!coverageBody.error) {
      geojsonToCache._coverage = {
        coverage:         coverageBody.coverage,
        total_pop:        coverageBody.total_pop,
        penetration_rate: coverageBody.penetration_rate,
        breakdown_by_poi: coverageBody.breakdown_by_poi,
        union_geojson:    coverageBody.union_geojson,
        millesime:        coverageBody.millesime,
      };
      await supabase.from('isochrones_cache').upsert(
        { cache_key: cacheKey, ville: geoScope, categorie: resolvedCategory ?? poi_category, minutes, mode, geojson: geojsonToCache, poi_count: sliced.length, created_at: new Date().toISOString() },
        { onConflict: 'cache_key' }
      );
      console.log(`[net-cov] Cache updated with coverage: ${cacheKey}`);
    }
  } catch { /* non-fatal */ }

  return coverageResponse;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Geometry simplification — pure JS, no external deps.
// Rounds coordinates to 4 decimal places (~11m accuracy) and removes
// consecutive duplicate vertices. This cuts vertex count by 60-80% on
// ORS isochrone polygons, making the PostGIS intersection dramatically faster.
// ═══════════════════════════════════════════════════════════════════════════════

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

function dedupeRing(ring: number[][]): number[][] {
  if (ring.length === 0) return ring;
  const out: number[][] = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const prev = out[out.length - 1];
    if (ring[i][0] !== prev[0] || ring[i][1] !== prev[1]) out.push(ring[i]);
  }
  // Ensure ring is closed
  if (out.length > 1 && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) {
    out.push([...out[0]]);
  }
  // PostGIS needs at least 4 points for a valid ring
  if (out.length < 4) return ring;
  return out;
}

function simplifyCoords(coords: any, type: string): any {
  if (type === 'Polygon') {
    return (coords as number[][][]).map(ring =>
      dedupeRing(ring.map(([lng, lat]) => [round4(lng), round4(lat)]))
    );
  }
  if (type === 'MultiPolygon') {
    return (coords as number[][][][]).map(poly => simplifyCoords(poly, 'Polygon'));
  }
  return coords;
}

function simplifyFeature(feat: any): any {
  if (!feat?.geometry?.coordinates) return feat;
  return {
    ...feat,
    geometry: {
      ...feat.geometry,
      coordinates: simplifyCoords(feat.geometry.coordinates, feat.geometry.type),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════

async function computeCoverage(
  supabase: any,
  features: any[],
  target_demo_column: string,
  target_demo_label: string,
  poi_category: string,
  resolvedCategory: string | null,
  minutes: number,
  mode: string,
  nb_pois: number,
  geoScope: string,
  from_cache: boolean
) {
  const { data: sources } = await supabase.from('data_sources').select('geo_config').eq('type', 'carreaux').limit(1);
  const millesime = (sources?.[0]?.geo_config as any)?.millesime ?? '2021';

  // Simplify isochrone geometries to reduce PostGIS compute time
  const simplified = features.map(simplifyFeature);
  const origSize = JSON.stringify(features).length;
  const simpSize = JSON.stringify(simplified).length;
  console.log(`[net-cov] Simplified ${features.length} features: ${(origSize/1024).toFixed(0)}KB → ${(simpSize/1024).toFixed(0)}KB (${Math.round((1-simpSize/origSize)*100)}% reduction)`);

  // Call the optimized v2 function via supabase.rpc() — no direct Postgres
  console.log(`[net-cov] supabase.rpc('calculate_network_coverage_v3', ${simplified.length} features, col=${target_demo_column}, mil=${millesime})`);

  const { data: rpcData, error: rpcErr } = await supabase.rpc('calculate_network_coverage_v3', {
    isochrone_features: simplified,
    target_column:      target_demo_column,
    p_millesime:        millesime,
  });

  if (rpcErr) {
    const msg = String(rpcErr.message ?? rpcErr);
    console.error(`[net-cov] RPC error: ${msg}`);
    return NextResponse.json({ error: `Erreur RPC: ${msg}` }, { status: 500 });
  }

  const result = rpcData as any;
  if (result?.error) {
    console.error(`[net-cov] RPC result error: ${result.error}`);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const coverage         = Number(result?.coverage ?? 0);
  const total_pop        = Number(result?.total_pop ?? 0);
  const union_geojson    = result?.union_geojson ?? null;
  const breakdown_by_poi = ((result?.breakdown_by_poi ?? []) as { name: string; audience: number }[])
    .sort((a: { audience: number }, b: { audience: number }) => b.audience - a.audience)
    .slice(0, 10);

  const penetration_rate = total_pop > 0 ? Math.round((coverage / total_pop) * 1000) / 10 : 0;
  console.log(`[net-cov] DONE coverage=${coverage} total_pop=${total_pop} penetration=${penetration_rate}% breakdown=${breakdown_by_poi.length} items from_cache=${from_cache}`);

  return NextResponse.json({
    poi_category:        resolvedCategory ?? poi_category,
    travel_time_minutes: minutes,
    mode,
    target_demo_column,
    target_demo_label,
    nb_pois,
    coverage,
    total_pop,
    penetration_rate,
    breakdown_by_poi,
    union_geojson,
    from_cache,
    geo_scope: geoScope,
    millesime: result?.millesime ?? millesime,
  });
}
