/**
 * /api/isochrone-battle/route.ts — v4.0.0
 *
 * ZÉRO VORONOÏ — uniquement de vrais isochrones ORS par CIRFA.
 *
 * Optimisations v4 (vs v3) :
 *   v3 → v4 : cache lookup 7 requêtes → 1 (chunked 200 clés) = -300 à -600ms
 *   v3 → v4 : ORS concurrence 2 → 4 + sémaphore vrai (slot libéré immédiatement)
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

export const maxDuration  = 300;
const ALL_LEVELS          = [10, 30, 60, 90, 120, 150, 180] as const;
const MAX_POIS_BATTLE     = 500;
// 4 POIs simultanés ≈ 40 req/min ORS max (limite free tier = 40 req/min)
const ORS_CONCURRENCY     = 4;
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

// ── Appel ORS multi-range : 1 POI, N paliers en une seule requête ─────────────
/**
 * Envoie UN appel ORS avec toutes les durées demandées.
 * ORS retourne une feature par durée (properties.value en secondes).
 * Retry : 429 → 15s, Timeout → 5s, autre erreur → abandon immédiat.
 */
interface ORSResult { geomMap: Map<number, object>; errorMsg: string | null }

async function callORSMulti(
  location: [number, number],
  levels:   number[],
  mode:     string,
  apiKey:   string,
): Promise<ORSResult> {
  const profile = ORS_PROFILES[mode] ?? 'driving-car';
  const ranges  = levels.map(l => l * 60);
  const TIMEOUT = 30_000;
  let   lastErr: string | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(
        `https://api.openrouteservice.org/v2/isochrones/${profile}`,
        {
          method:  'POST',
          signal:  ctrl.signal,
          headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
          body:    JSON.stringify({ locations: [location], range: ranges, range_type: 'time' }),
        },
      );
      clearTimeout(timer);

      if (res.status === 429) {
        console.warn(`[ORS] 429 rate-limit (tentative ${attempt + 1}/3) — attente 15s`);
        await new Promise(resolve => setTimeout(resolve, 15_000));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} — ${txt.slice(0, 200)}`;
        console.error(`[ORS] ${lastErr}`);
        return { geomMap: new Map(), errorMsg: lastErr };
      }

      const data    = await res.json();
      const geomMap = new Map<number, object>();
      for (const feat of (data.features ?? [])) {
        const valueSec = feat?.properties?.value;
        if (valueSec == null || !feat.geometry) continue;
        const levelMin = Math.round(Number(valueSec) / 60);
        // Tolérance ±1 min pour l'arrondi ORS
        const matched = levels.find(l => Math.abs(l - levelMin) <= 1);
        if (matched !== undefined) geomMap.set(matched, feat.geometry);
      }
      return { geomMap, errorMsg: null };

    } catch (e: any) {
      clearTimeout(timer);
      const isTimeout = e.name === 'AbortError';
      lastErr = isTimeout ? `Timeout ${TIMEOUT / 1000}s` : e.message;
      console.error(`[ORS] ${lastErr} (tentative ${attempt + 1}/3)`);
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, isTimeout ? 5_000 : 2_000));
    }
  }
  return { geomMap: new Map(), errorMsg: lastErr ?? 'Erreur inconnue' };
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
    force_recalculate = false,
    max_minutes       = 120,
    durations         = null,
  } = body as Record<string, unknown>;

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
        const battleCacheKey = `battle_full__${normKey(String(category))}__${normKey(normalizedMode)}__${BATTLE_LEVELS.join('-')}min__${regionKey}${filtre_ville ? '__' + normKey(String(filtre_ville)) : ''}`;

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
            }});
            return;
          }
        }

        // ── 1. Charger les POIs ─────────────────────────────────────────────
        const normStr = (s: string) =>
          s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

        const regions     = Array.isArray(filtre_regions) && (filtre_regions as string[]).length > 0
          ? (filtre_regions as string[]) : null;
        const regionNorms = regions ? regions.map(r => normStr(REGION_ID_TO_NAME[r] ?? r)) : null;

        let q = supabase.from('poi_france')
          .select('id, nom, lat, lng, categorie, adresse, ville, region')
          .ilike('categorie', category);
        if (metropolitaine) q = q.gte('lng', -5.5).lte('lng', 9.6).gte('lat', 41.3).lte('lat', 51.1);
        if (filtre_ville)   q = q.ilike('ville', `%${filtre_ville}%`);

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

        // ── 4. ORS avec sémaphore (4 slots, libérés immédiatement) ──────────
        const poiEntries     = [...poisWithMisses.values()];
        const newCacheRows:  object[] = [];   // batch write en fin
        const sem            = makeSemaphore(ORS_CONCURRENCY);
        let orsCompleted = 0, orsOk = 0, orsErr = 0;
        let firstOrsErr: string | null = null;

        const processPoiORS = async (entry: PoiMissEntry) => {
          const { poi, missingLevels, cacheKeys } = entry;
          const sortedLevels = [...missingLevels].sort((a, b) => a - b);

          const { geomMap, errorMsg } = await callORSMulti([poi.lng, poi.lat], sortedLevels, normalizedMode, apiKey);
          if (errorMsg && !firstOrsErr) firstOrsErr = errorMsg;

          const newRings: object[] = [];
          for (const level of sortedLevels) {
            const geom = geomMap.get(level);
            const ck   = cacheKeys.get(level)!;
            if (geom) {
              rings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier: level, geojson: geom });
              orsOk++;
              // Accumule pour batch write en fin (remplace N fire-and-forget individuels)
              newCacheRows.push({
                cache_key: ck, ville: '_battle_', categorie: category,
                minutes: level, mode: normalizedMode,
                geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geom, properties: {} }] },
                poi_count: 1, created_at: new Date().toISOString(),
              });
              newRings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier: level, geojson: geom });
            } else {
              orsErr++;
            }
          }
          orsCompleted++;
          if (newRings.length > 0) send({ type: 'partial_rings', rings: newRings });
          send({ type: 'progress', completed: orsCompleted, total: poiEntries.length, ok: orsOk, err: orsErr });
        };

        // Tous les POIs en parallèle, limités par le sémaphore
        await Promise.all(
          poiEntries.map(async entry => {
            await sem.acquire();
            try   { await processPoiORS(entry); }
            finally { sem.release(); }
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
          geojson: { battleGeoJSON, battleBorders: null, poisForMap },
          poi_count: pois.length, created_at: new Date().toISOString(),
        }, { onConflict: 'cache_key' });

        send({ type: 'result', data: {
          battleGeoJSON, battleBorders: null, poisForMap,
          nb_features: ringFeatures.length, nb_pois: pois.length,
          category, mode: normalizedMode, levels: [...BATTLE_LEVELS], metropolitaine,
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
