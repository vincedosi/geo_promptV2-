/**
 * /api/isochrone-battle/route.ts — v5.0.0
 *
 * ZÉRO VORONOÏ — uniquement de vrais isochrones ORS par CIRFA.
 *
 * Optimisations v5 (vs v4) :
 *   v4 → v5 : ORS 1 POI/appel → batch 5 POIs/appel (40 POIs = 8 req au lieu de 40)
 *
 * Optimisations v4 (vs v3) :
 *   v3 → v4 : cache lookup 7 requêtes → 1 (chunked 200 clés) = -300 à -600ms
 *   v3 → v4 : N cache writes individuels → 1 batch upsert en fin
 *
 * Algorithme :
 *   1. Lookup cache résultat complet → retour immédiat si HIT
 *   2. Charger les POIs (Supabase bbox + région)
 *   3. Lookup cache par CIRFA×palier — UNE seule requête pour tout
 *   4. Streamer les anneaux en cache immédiatement
 *   5. Appels ORS multi-range (4 POIs simultanés via sémaphore)
 *   6. Batch cache write + résultat complet
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';
import {
  ORS_PROFILES,
  type PoiRow,
} from '@/lib/isochrones/fetcher';
import { getRegionNameMap } from '@/lib/geo/region-lookup-server';
import { toJson } from '@/lib/supabase/rpc-json';
import type { TableInsert } from '@/lib/supabase/tables';

export const maxDuration  = 300;
const ALL_LEVELS          = [10, 30, 60, 90, 120, 150, 180] as const;
const MAX_POIS_BATTLE     = 500;
// ORS public API : 5 locations max par appel, 40 req/min
// Avec batch=5 : 40 POIs → 8 appels ORS (5× moins que 40 appels individuels)
const ORS_BATCH_SIZE      = 5;
const ORS_CONCURRENCY     = 2;   // 2 batches simultanés = 10 POIs en parallèle
// Taille max d'un chunk IN() Supabase (évite URL trop longue)
const CACHE_CHUNK         = 200;

// ── Sémaphore : N slots, libère un slot dès qu'une tâche termine ──────────────
function makeSemaphore(n: number) {
  let count = n;
  const queue: (() => void)[] = [];
  return {
    acquire: () => new Promise<void>(resolve => {
      if (count > 0) { count--; resolve(); }
      else queue.push(resolve);
    }),
    release() {
      const next = queue.shift();
      if (next) next(); else count++;
    },
  };
}

// ── Normalisation des clés de cache ──────────────────────────────────────────
/**
 * Étend une liste de codes département pour matcher les variantes de format
 * présentes dans poi_france.departement (incohérences d'import historiques) :
 *   - '01'..'09' → ajoute aussi '1'..'9' (sans padding, format CIRFA)
 *   - '2A' → ajoute aussi '20A' (format Corse INSEE legacy)
 *   - '2B' → ajoute aussi '20B'
 *   - '1'..'9' (déjà sans padding) → ajoute aussi '01'..'09'
 *   - '20A' → ajoute aussi '2A' ; '20B' → ajoute aussi '2B'
 */
function expandDeptCodes(codes: string[]): string[] {
  const out = new Set<string>();
  for (const c of codes) {
    out.add(c);
    if (/^0[1-9]$/.test(c))      out.add(c.slice(1));            // '03' → '3'
    else if (/^[1-9]$/.test(c))  out.add('0' + c);               // '3' → '03'
    if (c === '2A')              out.add('20A');
    else if (c === '20A')        out.add('2A');
    if (c === '2B')              out.add('20B');
    else if (c === '20B')        out.add('2B');
  }
  return [...out];
}

function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function perCirfaCacheKey(category: string, cirfaId: string, level: number, mode: string): string {
  return `battle__${normKey(category)}__${normKey(cirfaId)}__${level}min__${normKey(mode)}`;
}

// ── Appel ORS batch : jusqu'à ORS_BATCH_SIZE POIs, N paliers en une requête ───
/**
 * Envoie UN appel ORS pour un batch de POIs (max 5 locations, limite API publique).
 * ORS retourne une feature par (location, durée) — properties.group_index indique le POI.
 * Retry : 429 → 15s, Timeout → 5s, autre erreur → abandon immédiat.
 *
 * Gain : 40 POIs → 8 appels ORS (batch=5) au lieu de 40 appels individuels.
 */
interface ORSBatchResult {
  byPoi: Map<string, Map<number, object>>; // poi.id → level → geometry
  errorMsg: string | null;
}

async function callORSBatch(
  entries: PoiMissEntry[],
  levels:  number[],
  mode:    string,
  apiKey:  string,
): Promise<ORSBatchResult> {
  const profile   = ORS_PROFILES[mode] ?? 'driving-car';
  const locations = entries.map(e => [e.poi.lng, e.poi.lat] as [number, number]);
  const ranges    = levels.map(l => l * 60);
  const TIMEOUT   = 60_000;  // 60s — ORS free tier peut être lent sur gros isochrones
  let   lastErr: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(
        `https://api.openrouteservice.org/v2/isochrones/${profile}`,
        {
          method:  'POST',
          signal:  ctrl.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
          body:    JSON.stringify({ locations, range: ranges, range_type: 'time' }),
        },
      );
      clearTimeout(timer);

      if (res.status === 429) {
        console.warn(`[ORS batch] 429 rate-limit (tentative ${attempt + 1}/3) — attente 15s`);
        await new Promise(r => setTimeout(r, 15_000));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} — ${txt.slice(0, 200)}`;
        console.error(`[ORS batch] ${lastErr}`);
        return { byPoi: new Map(), errorMsg: lastErr };
      }

      const data  = await res.json();
      const byPoi = new Map<string, Map<number, object>>();
      for (const feat of (data.features ?? [])) {
        // group_index : index de la location dans le batch (absent = 0 pour 1 seule location)
        const groupIdx = feat?.properties?.group_index ?? 0;
        const entry    = entries[groupIdx];
        if (!entry || !feat.geometry) continue;
        const valueSec = feat?.properties?.value;
        if (valueSec == null) continue;
        const levelMin = Math.round(Number(valueSec) / 60);
        // Tolérance ±1 min pour l'arrondi ORS
        const matched = levels.find(l => Math.abs(l - levelMin) <= 1);
        if (matched === undefined) continue;
        const pid = entry.poi.id;
        if (!byPoi.has(pid)) byPoi.set(pid, new Map());
        byPoi.get(pid)!.set(matched, feat.geometry);
      }
      return { byPoi, errorMsg: null };

    } catch (e: unknown) {
      clearTimeout(timer);
      const isTimeout = e instanceof Error && e.name === 'AbortError';
      lastErr = isTimeout ? `Timeout ${TIMEOUT / 1000}s` : (e instanceof Error ? e.message : 'Erreur inconnue');
      console.error(`[ORS batch] ${lastErr} (tentative ${attempt + 1}/3)`);
      if (attempt < 2) await new Promise(r => setTimeout(r, isTimeout ? 5_000 : 2_000));
    }
  }
  return { byPoi: new Map(), errorMsg: lastErr ?? 'Erreur inconnue' };
}

interface RingEntry {
  cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: object;
}
interface PoiMissEntry {
  poi:           PoiRow;
  missingLevels: number[];
  cacheKeys:     Map<number, string>;
}

// ── Handler principal ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const {
    category          = '',
    mode              = 'drive',
    metropolitaine    = true,
    filtre_ville      = null,
    filtre_regions    = null,
    filtre_depts      = null,
    force_recalculate = false,
    max_minutes       = 120,
    durations         = null,
  } = body as Record<string, unknown>;

  // Filtre département : array de codes (ex: ['75', '92', '93'])
  // deptCodesCanonical = format ALL_DEPTS reçu (utilisé pour le cache key, déterministe)
  // deptFilter        = étendu pour matcher les 2 formats incohérents en DB
  //                     ('03'↔'3', '2A'↔'20A' — historique des imports)
  const deptCodesCanonical = Array.isArray(filtre_depts) && (filtre_depts as string[]).length > 0
    ? (filtre_depts as string[]).map(String)
    : null;
  const deptFilter = deptCodesCanonical ? expandDeptCodes(deptCodesCanonical) : null;

  const MODE_NORMALIZE: Record<string, string> = {
    drive: 'drive', 'driving-car': 'drive',
    walk:  'walk',  'foot-walking': 'walk',
    bike:  'bike',  'cycling-regular': 'bike',
  };
  const normalizedMode = MODE_NORMALIZE[String(mode)] ?? 'drive';
  const maxMin         = Math.min(Math.max(Number(max_minutes) || 120, 30), 180);
  const BATTLE_LEVELS  = Array.isArray(durations) && durations.length > 0
    ? (durations as number[]).map(Number).filter(n => n > 0 && n <= 180).sort((a, b) => a - b)
    : ALL_LEVELS.filter(l => l <= maxMin);

  if (!category || typeof category !== 'string')
    return NextResponse.json({ error: 'category requis' }, { status: 400 });
  if (BATTLE_LEVELS.length === 0)
    return NextResponse.json({ error: 'Aucune durée valide (1–180 min)' }, { status: 400 });

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ORS_API_KEY non configurée' }, { status: 500 });

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        const supabase = createAdminClient();

        // ── 0. Cache résultat complet ───────────────────────────────────────
        const regionKey      = Array.isArray(filtre_regions) && (filtre_regions as string[]).length > 0
          ? [...(filtre_regions as string[])].sort().join('+')
          : metropolitaine ? 'metro' : 'all';
        const deptKey        = deptCodesCanonical ? `__d${[...deptCodesCanonical].sort().join('-')}` : '';
        const battleCacheKey = `battle_full__${normKey(String(category))}__${normKey(normalizedMode)}__${BATTLE_LEVELS.join('-')}min__${regionKey}${deptKey}${filtre_ville ? '__' + normKey(String(filtre_ville)) : ''}`;

        if (!force_recalculate) {
          const { data: cached } = await supabase
            .from('isochrones_cache').select('geojson').eq('cache_key', battleCacheKey).single();
          if (cached?.geojson) {
            const c = cached.geojson as any;
            send({ type: 'result', data: {
              battleGeoJSON: c.battleGeoJSON, battleBorders: c.battleBorders,
              poisForMap: c.poisForMap,
              nb_features: c.battleGeoJSON?.features?.length ?? 0,
              nb_pois: c.poisForMap?.length ?? 0,
              category, mode: normalizedMode, levels: [...BATTLE_LEVELS], metropolitaine,
              fromCache: true,
              battleCacheKey,
            }});
            return;
          }
        }

        // ── 1. Charger les POIs ─────────────────────────────────────────────
        const normStr = (s: string) =>
          s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

        const regions     = Array.isArray(filtre_regions) && (filtre_regions as string[]).length > 0
          ? (filtre_regions as string[]) : null;
        // Map code_region INSEE → nom_region depuis ref_regions (cache module)
        const regionNames = regions ? await getRegionNameMap(supabase) : null;
        const regionNorms = regions && regionNames
          ? regions.map(r => normStr(regionNames.get(r) ?? r))
          : null;

        let q = supabase.from('poi_france')
          .select('id, nom, lat, lng, categorie, adresse, ville, region, departement')
          .ilike('categorie', category);
        if (metropolitaine) q = q.gte('lng', -5.5).lte('lng', 9.6).gte('lat', 41.3).lte('lat', 51.1);
        if (filtre_ville)   q = q.ilike('ville', `%${filtre_ville}%`);
        if (deptFilter)     q = q.in('departement', deptFilter);

        const { data: rawRows, error: poiErr } = await q.limit(MAX_POIS_BATTLE);
        if (poiErr) { send({ type: 'error', message: `Erreur chargement POIs : ${poiErr.message}` }); return; }

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
          send({ type: 'error', message: `Moins de 2 POIs trouvés pour "${category}"` }); return;
        }
        send({ type: 'pois_loaded', total: pois.length });

        // ── 2. Cache lookup — UNE seule requête (chunked) ───────────────────
        // Remplace les 7 requêtes parallèles de v3 → -300 à -600ms sur le chemin chaud
        const rings: RingEntry[]    = [];
        const cacheHitMap           = new Map<string, object>();

        if (!force_recalculate) {
          const allKeys = pois.flatMap(p =>
            BATTLE_LEVELS.map(l => perCirfaCacheKey(category, p.id, l, normalizedMode)),
          );
          // Chunking pour éviter les URLs trop longues avec PostgREST
          const chunks: string[][] = [];
          for (let i = 0; i < allKeys.length; i += CACHE_CHUNK)
            chunks.push(allKeys.slice(i, i + CACHE_CHUNK));

          const results = await Promise.all(
            chunks.map(chunk =>
              supabase.from('isochrones_cache').select('cache_key, geojson').in('cache_key', chunk),
            ),
          );
          for (const { data } of results) {
            for (const row of data ?? []) {
              const geom = (row.geojson as any)?.features?.[0]?.geometry;
              if (geom) cacheHitMap.set(row.cache_key, geom);
            }
          }
        }

        // ── 3. Trier HIT → rings / MISS → ORS queue ────────────────────────
        const poisWithMisses = new Map<string, PoiMissEntry>();

        for (const poi of pois) {
          for (const level of BATTLE_LEVELS) {
            const ck   = perCirfaCacheKey(category, poi.id, level, normalizedMode);
            const geom = cacheHitMap.get(ck);
            if (geom) {
              rings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier: level, geojson: geom });
            } else {
              if (!poisWithMisses.has(poi.id))
                poisWithMisses.set(poi.id, { poi, missingLevels: [], cacheKeys: new Map() });
              const e = poisWithMisses.get(poi.id)!;
              e.missingLevels.push(level);
              e.cacheKeys.set(level, ck);
            }
          }
        }

        // Streamer les anneaux en cache pour affichage immédiat
        if (rings.length > 0) {
          send({ type: 'partial_rings', rings: rings.map(r => ({
            cirfa_id: r.cirfa_id, nom: r.nom, lat: r.lat, lng: r.lng, palier: r.palier, geojson: r.geojson,
          })) });
        }

        // ── 4. ORS — batches de ORS_BATCH_SIZE POIs ───────────────────────
        // 40 POIs → 8 appels ORS (batch=5) au lieu de 40 individuels
        // Chaque batch : 1 appel ORS avec N locations, N paliers → N×M features
        const poiEntries  = [...poisWithMisses.values()];
        const batches: PoiMissEntry[][] = [];
        for (let i = 0; i < poiEntries.length; i += ORS_BATCH_SIZE)
          batches.push(poiEntries.slice(i, i + ORS_BATCH_SIZE));

        const newCacheRows: TableInsert<'isochrones_cache'>[] = [];
        const batchSem    = makeSemaphore(ORS_CONCURRENCY);
        let poisCompleted = 0, orsOk = 0, orsErr = 0;
        let firstOrsErr: string | null = null;

        const processBatch = async (batch: PoiMissEntry[]) => {
          // Union des paliers manquants pour tous les POIs du batch
          const levelSet = new Set<number>();
          for (const e of batch) e.missingLevels.forEach(l => levelSet.add(l));
          const batchLevels = [...levelSet].sort((a, b) => a - b);

          const { byPoi, errorMsg } = await callORSBatch(batch, batchLevels, normalizedMode, apiKey);
          if (errorMsg && !firstOrsErr) firstOrsErr = errorMsg;

          // Collecter d'abord toutes les géométries brutes du batch
          type RawRing = { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: object; ck: string };
          const rawNewRings: RawRing[] = [];
          for (const entry of batch) {
            const levelMap = byPoi.get(entry.poi.id) ?? new Map<number, object>();
            for (const level of entry.missingLevels) {
              const geom = levelMap.get(level);
              const ck   = entry.cacheKeys.get(level)!;
              if (geom) {
                rawNewRings.push({ cirfa_id: entry.poi.id, nom: entry.poi.nom, lat: entry.poi.lat, lng: entry.poi.lng, palier: level, geojson: geom, ck });
              } else {
                orsErr++;
              }
            }
            poisCompleted++;
          }

          // Clipper tous les rings du batch à la France en 1 appel PostGIS
          const newRings: object[] = [];
          if (rawNewRings.length > 0) {
            const fc = { type: 'FeatureCollection', features: rawNewRings.map((r, i) => ({ type: 'Feature', geometry: r.geojson, properties: { _idx: i } })) };
            const { data: clipped } = await supabase.rpc('clip_geojson_to_france', { p_fc: toJson(fc) }).single();
            const clippedFeatures: any[] = (clipped as any)?.features ?? fc.features; // fallback si RPC échoue

            for (const feat of clippedFeatures) {
              const idx = feat?.properties?._idx ?? clippedFeatures.indexOf(feat);
              const raw = rawNewRings[idx];
              if (!raw || !feat?.geometry) continue;
              const geom = feat.geometry;
              rings.push({ cirfa_id: raw.cirfa_id, nom: raw.nom, lat: raw.lat, lng: raw.lng, palier: raw.palier, geojson: geom });
              orsOk++;
              newCacheRows.push({
                cache_key: raw.ck, ville: '_battle_', categorie: category,
                minutes: raw.palier, mode: normalizedMode,
                geojson: toJson({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geom, properties: {} }] }),
                poi_count: 1, created_at: new Date().toISOString(),
              });
              newRings.push({ cirfa_id: raw.cirfa_id, nom: raw.nom, lat: raw.lat, lng: raw.lng, palier: raw.palier, geojson: geom });
            }
          }
          if (newRings.length > 0) send({ type: 'partial_rings', rings: newRings });
          send({ type: 'progress', completed: poisCompleted, total: poiEntries.length, ok: orsOk, err: orsErr });
        };

        // Batches en parallèle, limités par le sémaphore
        await Promise.all(
          batches.map(async batch => {
            await batchSem.acquire();
            try   { await processBatch(batch); }
            finally { batchSem.release(); }
          }),
        );

        // Batch cache write (1 upsert pour tous les nouveaux isochrones)
        if (newCacheRows.length > 0) {
          supabase.from('isochrones_cache')
            .upsert(newCacheRows, { onConflict: 'cache_key' })
            .then(({ error }) => { if (error) console.warn('[battle] cache batch write fail:', error.message); });
        }

        if (rings.length === 0) {
          const detail = firstOrsErr ? ` — ${firstOrsErr}` : ' Vérifier ORS_API_KEY et les coordonnées POIs.';
          send({ type: 'error', message: `ORS n'a retourné aucun isochrone.${detail}` });
          return;
        }

        // ── 5. Isochrones → GeoJSON features ───────────────────────────────
        const ringFeatures = rings.map(r => ({
          type: 'Feature' as const,
          geometry: r.geojson,
          properties: {
            feature_type: 'ring',
            id: r.cirfa_id, cirfa_id: r.cirfa_id,
            nom: r.nom, lat: r.lat, lng: r.lng, palier: r.palier,
          },
        }));

        const poisForMap    = pois.map(p => ({ id: p.id, nom: p.nom, lat: p.lat, lng: p.lng, categorie: p.categorie, adresse: p.adresse, ville: p.ville }));
        const battleGeoJSON = { type: 'FeatureCollection', features: ringFeatures };

        // ── 6. Cache résultat complet ───────────────────────────────────────
        await supabase.from('isochrones_cache').upsert({
          cache_key: battleCacheKey, ville: '_battle_full_', categorie: String(category),
          minutes: maxMin, mode: normalizedMode,
          geojson: toJson({ battleGeoJSON, battleBorders: null, poisForMap }),
          poi_count: pois.length, created_at: new Date().toISOString(),
        }, { onConflict: 'cache_key' });

        send({ type: 'result', data: {
          battleGeoJSON, battleBorders: null, poisForMap,
          nb_features: ringFeatures.length, nb_pois: pois.length,
          category, mode: normalizedMode, levels: [...BATTLE_LEVELS], metropolitaine,
          battleCacheKey,
        }});

      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erreur inconnue';
        console.error('[battle] Erreur inattendue:', msg);
        send({ type: 'error', message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  });
}
