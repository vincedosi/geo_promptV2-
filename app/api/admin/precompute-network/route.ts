/**
 * /api/admin/precompute-network
 *
 * Pré-calcule les isochrones ORS pour un réseau de POI et les stocke en cache.
 * Permet à /api/network-coverage de répondre instantanément (cache HIT).
 *
 * POST { poi_category, minutes, mode, region?, ville?, departement? }
 * → { cache_key, nb_pois, nb_isochrones, skipped, duration_sec }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { ORS_PROFILES } from '@/lib/isochrones/fetcher';
import { resolveCategory } from '@/lib/geo/locations';
import { fetchPois } from '@/lib/geo/fetchPois';

export const maxDuration = 300;

const ORS_BATCH      = 5;
const ORS_RETRIES    = 3;
const ORS_TIMEOUT    = 20_000;
const ORS_RETRY_DELAY = 20_000;

async function callORS(
  locations: number[][],
  rangeSec: number,
  profile: string,
  apiKey: string,
  label: string,
): Promise<any[] | null> {
  for (let attempt = 0; attempt < ORS_RETRIES; attempt++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ORS_TIMEOUT);
    try {
      const res = await fetch(
        `https://api.openrouteservice.org/v2/isochrones/${profile}`,
        {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Authorization': apiKey,
            'Content-Type':  'application/json',
            'Accept':        'application/json, application/geo+json',
          },
          body: JSON.stringify({ locations, range: [rangeSec], range_type: 'time' }),
        }
      );
      clearTimeout(timer);

      console.log(`[precompute] ${label} attempt ${attempt + 1} → HTTP ${res.status}`);

      if (res.status === 429) {
        console.warn(`[precompute] Rate limit, waiting ${ORS_RETRY_DELAY / 1000}s…`);
        await new Promise(r => setTimeout(r, ORS_RETRY_DELAY));
        continue;
      }
      if (!res.ok) {
        const errText = await res.text();
        console.error(`[precompute] ORS ${res.status}: ${errText.slice(0, 200)}`);
        return null;
      }
      const data = await res.json();
      return data.features ?? [];
    } catch (e: any) {
      clearTimeout(timer);
      const msg = e.name === 'AbortError' ? `Timeout ${ORS_TIMEOUT / 1000}s` : e.message;
      console.error(`[precompute] ${label} attempt ${attempt + 1} error: ${msg}`);
      if (attempt < ORS_RETRIES - 1) await new Promise(r => setTimeout(r, 3_000));
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
    minutes       = 30,
    mode          = 'drive',
    region        = null,
    ville         = null,
    departement   = null,
  } = body;

  if (!poi_category) return NextResponse.json({ error: 'poi_category requis.' }, { status: 400 });

  const rangeSec = Number(minutes) * 60;
  const profile  = ORS_PROFILES[mode] ?? 'driving-car';
  const apiKey   = process.env.ORS_API_KEY;

  if (!apiKey) return NextResponse.json({ error: 'ORS_API_KEY non configurée.' }, { status: 500 });

  const supabase = createAdminClient();
  const t0 = Date.now();

  // ── 1. Résolution catégorie ──────────────────────────────────────────────
  const { data: catRows } = await supabase.from('poi_france').select('categorie').limit(1000);
  const validCats = [...new Set((catRows ?? []).map((r: any) => r.categorie as string))];
  const resolvedCategory = resolveCategory(poi_category, validCats);

  console.log(`[precompute] resolvedCategory="${resolvedCategory}" (requested="${poi_category}")`);

  // ── 2. Fetch POIs (multi-requêtes union comme le chat route) ─────────────
  const { pois, error: poisErr } = await fetchPois(supabase, resolvedCategory, poi_category, {
    region, ville, departement, limit: 5000,
  });
  if (poisErr) return NextResponse.json({ error: `Supabase error: ${poisErr}` }, { status: 500 });

  console.log(`[precompute] ${pois.length} POIs pour "${resolvedCategory ?? poi_category}", ${minutes}min ${mode}`);

  if (pois.length === 0) {
    return NextResponse.json({ error: `Aucun POI trouvé pour "${poi_category}".` }, { status: 404 });
  }

  // ── 3. Cache key ────────────────────────────────────────────────────────
  const geoTag   = ((ville ?? region ?? departement ?? 'france') as string)
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
  const cacheKey = `network__${(resolvedCategory ?? poi_category).toLowerCase()}__${geoTag}__${minutes}min__${mode}`;

  console.log(`[precompute] cache_key="${cacheKey}"`);

  // ── 4. ORS batch calls ───────────────────────────────────────────────────
  const allFeatures: any[] = [];
  const skipped: string[]  = [];
  const totalBatches = Math.ceil(pois.length / ORS_BATCH);

  for (let i = 0; i < pois.length; i += ORS_BATCH) {
    const batch     = pois.slice(i, i + ORS_BATCH);
    const batchNum  = Math.floor(i / ORS_BATCH) + 1;
    const locations = batch.map(p => [p.lng, p.lat]);

    const batchFeats = await callORS(locations, rangeSec, profile, apiKey, `batch ${batchNum}/${totalBatches}`);

    if (batchFeats !== null) {
      allFeatures.push(...batchFeats);
    } else {
      // Fallback individuel pour isoler le POI problématique
      console.warn(`[precompute] Batch ${batchNum} failed → fallback individuel`);
      for (const poi of batch) {
        const singleFeats = await callORS([[poi.lng, poi.lat]], rangeSec, profile, apiKey, `solo ${poi.nom}`);
        if (singleFeats !== null && singleFeats.length > 0) {
          allFeatures.push(...singleFeats);
        } else {
          const msg = `${poi.nom} [${poi.lng}, ${poi.lat}]`;
          console.warn(`[precompute] POI ignoré: ${msg}`);
          skipped.push(msg);
        }
      }
    }
  }

  console.log(`[precompute] ORS done: ${allFeatures.length} features, ${skipped.length} skipped`);

  if (allFeatures.length === 0) {
    return NextResponse.json({
      error: `ORS n'a retourné aucun isochrone pour ${pois.length} POIs.`,
      skipped,
    }, { status: 500 });
  }

  // ── 5. Sauvegarde cache ─────────────────────────────────────────────────
  const geojson = { type: 'FeatureCollection', features: allFeatures };
  const geoScope = ville ?? region ?? departement ?? 'France';

  const { error: saveErr } = await supabase.from('isochrones_cache').upsert(
    {
      cache_key:  cacheKey,
      ville:      geoScope,
      categorie:  resolvedCategory ?? poi_category,
      minutes:    Number(minutes),
      mode,
      geojson,
      poi_count:  pois.length,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'cache_key' }
  );

  const duration_sec = Math.round((Date.now() - t0) / 1000);

  if (saveErr) {
    console.error(`[precompute] Cache save error: ${saveErr.message}`);
    return NextResponse.json({ error: `Cache save failed: ${saveErr.message}` }, { status: 500 });
  }

  console.log(`[precompute] DONE cache_key="${cacheKey}" nb_pois=${pois.length} nb_iso=${allFeatures.length} duration=${duration_sec}s`);

  return NextResponse.json({
    cache_key:     cacheKey,
    poi_category:  resolvedCategory ?? poi_category,
    geo_scope:     geoScope,
    nb_pois:       pois.length,
    nb_isochrones: allFeatures.length,
    skipped_pois:  skipped.length,
    skipped_names: skipped.slice(0, 20),
    duration_sec,
    minutes:       Number(minutes),
    mode,
  });
}
