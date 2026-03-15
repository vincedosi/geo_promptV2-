/**
 * /api/isochrone-battle/route.ts — v2.0.0
 *
 * ZÉRO VORONOÏ — uniquement de vrais isochrones ORS par CIRFA.
 *
 * Algorithme :
 *   1. Pour chaque palier L ∈ [10, 30, 60, 90, 120] :
 *        – Lookup cache batch (une query Supabase par palier)
 *        – Pour les MISS : appel ORS par batches de 5 avec tracking précis
 *          du group_index → CIRFA (offset batch)
 *        – Cache individuel par CIRFA par palier
 *   2. Construire rings[] = [{cirfa_id, nom, lat, lng, palier, geojson}]
 *   3. RPC PostGIS get_isochrone_battle(rings) → ST_Difference pur
 *   4. Retourner { battleGeoJSON (rings), battleBorders (union/CIRFA), poisForMap }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';
import {
  ORS_PROFILES,
  ORS_MAX_RETRIES,
  ORS_RETRY_DELAY,
  type PoiRow,
} from '@/lib/isochrones/fetcher';

const REGION_ID_TO_NAME: Record<string, string> = {
  ara: 'Auvergne-Rhone-Alpes',
  bfc: 'Bourgogne-Franche-Comte',
  bre: 'Bretagne',
  cvl: 'Centre-Val de Loire',
  cor: 'Corse',
  ges: 'Grand Est',
  hdf: 'Hauts-de-France',
  idf: 'Ile-de-France',
  nor: 'Normandie',
  naq: 'Nouvelle-Aquitaine',
  occ: 'Occitanie',
  pdl: 'Pays de la Loire',
  pac: 'Provence-Alpes-Cote d\'Azur',
  dom: 'DROM',
};

export const maxDuration = 300;  // Vercel timeout étendu

const ALL_LEVELS      = [10, 30, 60, 90, 120, 150, 180] as const;
const ORS_BATCH_SIZE  = 5;
const MAX_POIS_BATTLE = 500;

// ── Normalisation des clés de cache ─────────────────────────────────────────
function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function perCircfaCacheKey(
  category: string,
  cirfaId:  string,
  level:    number,
  mode:     string
): string {
  return `battle__${normKey(category)}__${normKey(cirfaId)}__${level}min__${normKey(mode)}`;
}

// ── Appel ORS pour un batch de locations ────────────────────────────────────
interface OrsFeature {
  group_index: number;
  geometry:    object;  // GeoJSON Geometry
}

async function callORS(
  locations: [number, number][],
  minutes:   number,
  mode:      string,
  apiKey:    string
): Promise<OrsFeature[]> {
  const profile  = ORS_PROFILES[mode] ?? 'driving-car';
  const rangeSec = minutes * 60;

  // Max 2 tentatives, timeout 12s par appel, retry delay 5s (pas 20s)
  const MAX_ATTEMPTS  = 2;
  const CALL_TIMEOUT  = 12_000;
  const RATE_DELAY    = 5_000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT);
    try {
      const res = await fetch(
        `https://api.openrouteservice.org/v2/isochrones/${profile}`,
        {
          method:  'POST',
          signal:  controller.signal,
          headers: {
            Authorization:  apiKey,
            'Content-Type': 'application/json',
            Accept:         'application/json, application/geo+json',
          },
          body: JSON.stringify({
            locations,
            range:      [rangeSec],
            range_type: 'time',
          }),
        }
      );
      clearTimeout(timer);

      if (res.status === 429) {
        console.warn(`[battle/ORS] Rate limit (tentative ${attempt + 1}), attente ${RATE_DELAY / 1000}s…`);
        await new Promise(r => setTimeout(r, RATE_DELAY));
        continue;
      }

      if (!res.ok) {
        console.error(`[battle/ORS] HTTP ${res.status}`);
        return [];
      }

      const data = await res.json();
      return (data.features ?? []).map((f: any) => ({
        group_index: Number(f.properties?.group_index ?? 0),
        geometry:    f.geometry,
      }));
    } catch (e: any) {
      clearTimeout(timer);
      const isTimeout = e.name === 'AbortError';
      console.error(`[battle/ORS] ${isTimeout ? 'Timeout 12s' : e.message} (tentative ${attempt + 1})`);
      if (attempt < MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, 2_000));
    }
  }

  return [];
}

// ── Type d'entrée pour le RPC PostGIS ───────────────────────────────────────
interface RingEntry {
  cirfa_id: string;
  nom:      string;
  lat:      number;
  lng:      number;
  palier:   number;
  geojson:  object;
}

// ── Handler principal ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const {
    category           = '',
    mode               = 'drive',
    metropolitaine     = true,
    filtre_ville    = null,
    filtre_regions  = null,
    force_recalculate  = false,
    max_minutes        = 120,
  } = body as Record<string, unknown>;

  const maxMin = Math.min(Math.max(Number(max_minutes) || 120, 30), 180);
  const BATTLE_LEVELS = ALL_LEVELS.filter(l => l <= maxMin);

  if (!category || typeof category !== 'string') {
    return NextResponse.json({ error: 'category requis' }, { status: 400 });
  }
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ORS_API_KEY non configurée' }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

  try {
    const supabase = createAdminClient();

    // ── 0. Cache du résultat complet ─────────────────────────────────────────
    // Clé déterministe : catégorie + mode + paliers + territoire
    const regionKey = Array.isArray(filtre_regions)
      ? [...(filtre_regions as string[])].sort().join('+')
      : metropolitaine ? 'metro' : 'all';
    const battleCacheKey = `battle_full__${normKey(String(category))}__${normKey(String(mode))}__${maxMin}min__${regionKey}${filtre_ville ? '__' + normKey(String(filtre_ville)) : ''}`;

    if (!force_recalculate) {
      const { data: cached } = await supabase
        .from('isochrones_cache')
        .select('geojson')
        .eq('cache_key', battleCacheKey)
        .single();

      if (cached?.geojson) {
        const c = cached.geojson as any;
        console.log(`[battle] cache HIT — ${battleCacheKey}`);
        send({ type: 'result', data: {
          battleGeoJSON: c.battleGeoJSON,
          battleBorders: c.battleBorders,
          poisForMap:    c.poisForMap,
          nb_features:   c.battleGeoJSON?.features?.length ?? 0,
          nb_pois:       c.poisForMap?.length ?? 0,
          category,
          mode,
          levels:        [...BATTLE_LEVELS],
          metropolitaine,
          fromCache:     true,
        }});
        return;
      }
    }

    // ── 1. Charger les POIs ──────────────────────────────────────────────────
    // Fetch all POIs (category + bbox), then filter by region in JS to avoid
    // PostgREST accent/encoding issues with ilike on region column.
    // Normalize a string for fuzzy region matching (remove accents + punctuation)
    const normStr = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

    const regions = Array.isArray(filtre_regions) && (filtre_regions as string[]).length > 0
      ? (filtre_regions as string[])
      : null;
    const regionNorms = regions
      ? regions.map(r => normStr(REGION_ID_TO_NAME[r] ?? r))
      : null;

    let q = supabase
      .from('poi_france')
      .select('id, nom, lat, lng, categorie, adresse, ville, region')
      .ilike('categorie', category);
    if (metropolitaine) {
      q = q.gte('lng', -5.5).lte('lng', 9.6).gte('lat', 41.3).lte('lat', 51.1);
    }
    if (filtre_ville) q = q.ilike('ville', `%${filtre_ville}%`);

    const { data: rawRows, error: poiErr } = await q.limit(MAX_POIS_BATTLE);
    if (poiErr) return NextResponse.json({ error: poiErr.message }, { status: 500 });

    const pois: PoiRow[] = (rawRows ?? [])
      .filter((p: any) => {
        if (p.lat == null || p.lng == null) return false;
        if (!regionNorms) return true;
        const pNorm = normStr(p.region ?? '');
        return regionNorms.some(rn => pNorm.includes(rn) || rn.includes(pNorm));
      })
      .map((p: any) => ({
        id: String(p.id), nom: p.nom ?? '', lat: Number(p.lat), lng: Number(p.lng),
        categorie: p.categorie ?? category, adresse: p.adresse ?? '', ville: p.ville ?? '',
      }));

    if (pois.length < 2) {
      send({ type: 'error', message: `Moins de 2 POIs trouvés pour "${category}"` });
      return;
    }

    console.log(`[battle] "${category}" → ${pois.length} POIs, mode=${mode}`);
    send({ type: 'pois_loaded', total: pois.length });

    // ── 2. Per-CIRFA per-niveau : cache → ORS ───────────────────────────────
    const rings: RingEntry[] = [];

    // ── Cache lookup : tous les niveaux en parallèle ────────────────────────
    const levelCacheMaps = new Map<number, Map<string, object>>();
    await Promise.all(BATTLE_LEVELS.map(async level => {
      const cacheKeys = pois.map(p => perCircfaCacheKey(category, p.id, level, String(mode)));
      const geomMap   = new Map<string, object>();
      if (!force_recalculate) {
        const { data: cachedRows } = await supabase
          .from('isochrones_cache')
          .select('cache_key, geojson')
          .in('cache_key', cacheKeys);
        for (const row of cachedRows ?? []) {
          const features = (row.geojson as any)?.features ?? [];
          if (features.length > 0 && features[0]?.geometry) {
            geomMap.set(row.cache_key, features[0].geometry);
          }
        }
      }
      levelCacheMaps.set(level, geomMap);
    }));

    // ── Construire la liste complète des batches ORS manquants ───────────────
    type OrsBatch = {
      level: number;
      batch: { poi: PoiRow; cacheKey: string }[];
    };
    const orsBatches: OrsBatch[] = [];

    for (const level of BATTLE_LEVELS) {
      const cacheGeomMap = levelCacheMaps.get(level)!;
      const cacheKeys    = pois.map(p => perCircfaCacheKey(category, p.id, level, String(mode)));

      const missedItems: { poi: PoiRow; cacheKey: string }[] = [];
      for (let i = 0; i < pois.length; i++) {
        const geom = cacheGeomMap.get(cacheKeys[i]);
        if (geom) {
          rings.push({ cirfa_id: pois[i].id, nom: pois[i].nom, lat: pois[i].lat, lng: pois[i].lng, palier: level, geojson: geom });
        } else {
          missedItems.push({ poi: pois[i], cacheKey: cacheKeys[i] });
        }
      }
      console.log(`[battle] Palier ${level}min : ${pois.length - missedItems.length} hits, ${missedItems.length} miss`);

      for (let bi = 0; bi < missedItems.length; bi += ORS_BATCH_SIZE) {
        orsBatches.push({ level, batch: missedItems.slice(bi, bi + ORS_BATCH_SIZE) });
      }
    }

    // ── Appels ORS en parallèle (5 simultanés max) ───────────────────────────
    const ORS_CONCURRENCY = 10;
    console.log(`[battle] ${orsBatches.length} batches ORS — concurrence ${ORS_CONCURRENCY}`);

    // Collecter toutes les écritures cache pour les awaiter ensemble
    const cacheWrites: Promise<any>[] = [];
    const processedPoiIds = new Set<string>();

    for (let i = 0; i < orsBatches.length; i += ORS_CONCURRENCY) {
      const chunk = orsBatches.slice(i, i + ORS_CONCURRENCY);
      await Promise.all(chunk.map(async ({ level, batch }) => {
        const locations   = batch.map(({ poi }) => [poi.lng, poi.lat] as [number, number]);
        const orsFeatures = await callORS(locations, level, String(mode), apiKey);

        for (const f of orsFeatures) {
          const item = batch[f.group_index];
          if (!item || !f.geometry) continue;
          const { poi, cacheKey } = item;

          rings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier: level, geojson: f.geometry });

          const fc = {
            type:     'FeatureCollection',
            features: [{ type: 'Feature', geometry: f.geometry, properties: { group_index: 0 } }],
          };
          cacheWrites.push(
            supabase.from('isochrones_cache').upsert(
              { cache_key: cacheKey, ville: '_battle_', categorie: category, minutes: level, mode: String(mode), geojson: fc, poi_count: 1, created_at: new Date().toISOString() },
              { onConflict: 'cache_key' }
            )
          );
        }

        if (orsFeatures.length < batch.length) {
          console.warn(`[battle] Palier ${level}min: ORS ${orsFeatures.length}/${batch.length} polygones`);
        }
        for (const { poi } of batch) processedPoiIds.add(poi.id);
      }));

      // Progression après chaque vague ORS
      send({ type: 'progress', completed: processedPoiIds.size, total: pois.length });
    }

    // Awaiter toutes les écritures cache avant de continuer
    if (cacheWrites.length > 0) {
      const results = await Promise.allSettled(cacheWrites);
      const failed  = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) console.warn(`[battle] ${failed}/${cacheWrites.length} cache writes échouées`);
      else console.log(`[battle] ${cacheWrites.length} isochrones mis en cache ✓`);
    }

    console.log(`[battle] ORS terminé — ${rings.length} anneaux total`);

    if (rings.length === 0) {
      send({ type: 'error', message: 'ORS n\'a retourné aucun isochrone. Vérifier ORS_API_KEY et les coordonnées POIs.' });
      return;
    }

    // ── 2b. Clip aux frontières françaises ───────────────────────────────────
    let clippedRings: RingEntry[] = rings;
    {
      const { data: clipped, error: clipErr } = await supabase.rpc(
        'clip_rings_to_france',
        { p_rings: rings }
      );
      if (clipErr) {
        console.warn('[battle] clip_rings_to_france error (fallback unclipped):', clipErr.message);
      } else if (Array.isArray(clipped) && clipped.length > 0) {
        clippedRings = clipped as RingEntry[];
        console.log(`[battle] Clip France OK → ${clippedRings.length}/${rings.length} rings retenus`);
      }
    }

    // ── 3. Appel PostGIS : ST_Difference pur, zéro Voronoï ──────────────────
    console.log(`[battle] RPC get_isochrone_battle → ${clippedRings.length} polygones…`);
    send({ type: 'postgis' });

    const { data: battleRows, error: rpcErr } = await supabase.rpc(
      'get_isochrone_battle',
      { p_rings: clippedRings }
    );

    if (rpcErr) {
      console.error('[battle] Erreur RPC:', rpcErr.message);
      send({ type: 'error', message: rpcErr.message });
      return;
    }

    const allFeatures     = Array.isArray(battleRows) ? battleRows : [];
    const ringFeatures    = allFeatures.filter((f: any) => f?.properties?.feature_type === 'ring');
    const borderFeatures  = allFeatures.filter((f: any) => f?.properties?.feature_type === 'border');

    console.log(
      `[battle] → ${ringFeatures.length} anneaux, ${borderFeatures.length} bordures CIRFA`
    );

    // ── 4. Réponse ───────────────────────────────────────────────────────────
    const poisForMap = pois.map(p => ({
      id:        p.id,
      nom:       p.nom,
      lat:       p.lat,
      lng:       p.lng,
      categorie: p.categorie,
      adresse:   p.adresse,
      ville:     p.ville,
    }));

    const battleGeoJSON = { type: 'FeatureCollection', features: ringFeatures };
    const battleBorders = { type: 'FeatureCollection', features: borderFeatures };

    // Stocker le résultat complet en cache (awaité pour garantir l'écriture)
    await supabase.from('isochrones_cache').upsert({
      cache_key:  battleCacheKey,
      ville:      '_battle_full_',
      categorie:  String(category),
      minutes:    maxMin,
      mode:       String(mode),
      geojson:    { battleGeoJSON, battleBorders, poisForMap },
      poi_count:  pois.length,
      created_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });

    send({ type: 'result', data: {
      battleGeoJSON,
      battleBorders,
      poisForMap,
      nb_features:   ringFeatures.length,
      nb_pois:       pois.length,
      category,
      mode,
      levels:        [...BATTLE_LEVELS],
      metropolitaine,
    }});

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue';
    console.error('[battle] Erreur inattendue:', msg);
    send({ type: 'error', message: msg });
  } finally {
    controller.close();
  }
  } // end start()
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  });
}
