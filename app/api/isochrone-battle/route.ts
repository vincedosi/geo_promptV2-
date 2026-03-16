/**
 * /api/isochrone-battle/route.ts — v3.0.0
 *
 * ZÉRO VORONOÏ — uniquement de vrais isochrones ORS par CIRFA.
 *
 * Optimisations v3 :
 *   - Multi-range ORS : 1 appel par POI avec TOUS les paliers → 3-7× moins d'appels ORS
 *   - Concurrence = 2 : 2 POIs simultanés → 2× plus rapide, ≈20 req/min (sous la limite 40)
 *   - Streaming progressif : progress event par POI traité, carte se remplit en temps réel
 *
 * Algorithme (Phase 1 — isochrones bruts, pas de bataille PostGIS) :
 *   1. Lookup cache complet (résultat entier) → retour immédiat si HIT
 *   2. Charger les POIs depuis poi_france (filtre catégorie + bbox + région)
 *   3. Lookup cache par CIRFA×palier en parallèle
 *   4. Grouper les MISS par POI → 1 appel ORS multi-range par POI (tous paliers manquants)
 *      Concurrence = 2 POIs simultanés
 *   5. Conversion directe rings → GeoJSON features (pas de PostGIS)
 *   6. Cache du résultat complet
 *
 * Phase 2 (à venir) : bouton "BATAILLE" → ST_Difference sur les anneaux déjà en cache
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

export const maxDuration  = 300;  // Vercel timeout étendu
const ALL_LEVELS          = [10, 30, 60, 90, 120, 150, 180] as const;
const MAX_POIS_BATTLE     = 500;
// 2 POIs en parallèle ≈ 20 req/min ORS (sous la limite free tier 40 req/min)
const ORS_CONCURRENCY     = 2;

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

// ── Appel ORS multi-range : 1 POI, N paliers en une seule requête ────────────
/**
 * Envoie UN seul appel ORS avec plusieurs durées (range: [600, 1800, 3600]…).
 * ORS retourne une feature par durée, identifiée par properties.value (secondes).
 * Retourne Map<level_minutes, geometry> — levels absents si ORS échoue.
 *
 * Retry : 429 → 15s, Timeout → 5s, autre erreur → abandon (3 tentatives max).
 */
interface ORSResult {
  geomMap:  Map<number, object>;
  errorMsg: string | null;  // premier message d'erreur ORS, null si succès
}

async function callORSMulti(
  location: [number, number],
  levels:   number[],   // triés croissant, validés 1-180
  mode:     string,
  apiKey:   string
): Promise<ORSResult> {
  const profile = ORS_PROFILES[mode] ?? 'driving-car';
  const ranges  = levels.map(l => l * 60);
  const TIMEOUT = 30_000;  // 30s : multi-range peut prendre plus longtemps
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
          headers: {
            Authorization:  apiKey,
            'Content-Type': 'application/json',
            Accept:         'application/geo+json',
          },
          body: JSON.stringify({ locations: [location], range: ranges, range_type: 'time' }),
        }
      );
      clearTimeout(timer);

      if (res.status === 429) {
        console.warn(`[ORS] 429 rate-limit (tentative ${attempt + 1}/3) — attente 15s`);
        await new Promise(r => setTimeout(r, 15_000));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} — ${txt.slice(0, 200)}`;
        console.error(`[ORS] ${lastErr}`);
        return { geomMap: new Map(), errorMsg: lastErr };  // erreur définitive, pas de retry
      }

      const data   = await res.json();
      const geomMap = new Map<number, object>();
      for (const feat of (data.features ?? [])) {
        const valueSec = feat?.properties?.value;
        if (valueSec == null || !feat.geometry) continue;
        const levelMin = Math.round(Number(valueSec) / 60);
        // Trouver le palier demandé correspondant (tolérance ±1 min pour arrondi ORS)
        const matched  = levels.find(l => Math.abs(l - levelMin) <= 1);
        if (matched !== undefined) geomMap.set(matched, feat.geometry);
      }
      return { geomMap, errorMsg: null };

    } catch (e: any) {
      clearTimeout(timer);
      const isTimeout = e.name === 'AbortError';
      lastErr = isTimeout ? `Timeout ${TIMEOUT / 1000}s` : e.message;
      console.error(`[ORS] ${lastErr} (tentative ${attempt + 1}/3)`);
      if (attempt < 2) await new Promise(r => setTimeout(r, isTimeout ? 5_000 : 2_000));
    }
  }
  return { geomMap: new Map(), errorMsg: lastErr ?? 'Erreur inconnue' };
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
    category          = '',
    mode              = 'drive',
    metropolitaine    = true,
    filtre_ville      = null,
    filtre_regions    = null,
    force_recalculate = false,
    max_minutes       = 120,
    durations         = null,
  } = body as Record<string, unknown>;

  // Normalise mode : accepte 'drive'/'walk'/'bike' ET les profils ORS directs
  const MODE_NORMALIZE: Record<string, string> = {
    drive: 'drive', 'driving-car': 'drive',
    walk:  'walk',  'foot-walking': 'walk',
    bike:  'bike',  'cycling-regular': 'bike',
  };
  const normalizedMode = MODE_NORMALIZE[String(mode)] ?? 'drive';

  const maxMin = Math.min(Math.max(Number(max_minutes) || 120, 30), 180);
  const BATTLE_LEVELS = Array.isArray(durations) && durations.length > 0
    ? (durations as number[]).map(Number).filter(n => n > 0 && n <= 180).sort((a, b) => a - b)
    : ALL_LEVELS.filter(l => l <= maxMin);

  if (!category || typeof category !== 'string') {
    return NextResponse.json({ error: 'category requis' }, { status: 400 });
  }
  if (BATTLE_LEVELS.length === 0) {
    return NextResponse.json({ error: 'Aucune durée valide (doit être entre 1 et 180 min)' }, { status: 400 });
  }
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ORS_API_KEY non configurée' }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

  try {
    const supabase = createAdminClient();

    // ── 0. Cache du résultat complet ─────────────────────────────────────────
    const regionKey = Array.isArray(filtre_regions) && (filtre_regions as string[]).length > 0
      ? [...(filtre_regions as string[])].sort().join('+')
      : metropolitaine ? 'metro' : 'all';
    const durationsKey   = BATTLE_LEVELS.join('-');
    const battleCacheKey = `battle_full__${normKey(String(category))}__${normKey(normalizedMode)}__${durationsKey}min__${regionKey}${filtre_ville ? '__' + normKey(String(filtre_ville)) : ''}`;

    if (!force_recalculate) {
      const { data: cached } = await supabase
        .from('isochrones_cache')
        .select('geojson')
        .eq('cache_key', battleCacheKey)
        .single();

      if (cached?.geojson) {
        const c = cached.geojson as any;
        send({ type: 'result', data: {
          battleGeoJSON: c.battleGeoJSON,
          battleBorders: c.battleBorders,
          poisForMap:    c.poisForMap,
          nb_features:   c.battleGeoJSON?.features?.length ?? 0,
          nb_pois:       c.poisForMap?.length ?? 0,
          category,
          mode:          normalizedMode,
          levels:        [...BATTLE_LEVELS],
          metropolitaine,
          fromCache:     true,
        }});
        return;
      }
    }

    // ── 1. Charger les POIs ──────────────────────────────────────────────────
    const normStr = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

    const regions     = Array.isArray(filtre_regions) && (filtre_regions as string[]).length > 0
      ? (filtre_regions as string[]) : null;
    const regionNorms = regions
      ? regions.map(r => normStr(REGION_ID_TO_NAME[r] ?? r)) : null;

    let q = supabase
      .from('poi_france')
      .select('id, nom, lat, lng, categorie, adresse, ville, region')
      .ilike('categorie', category);
    if (metropolitaine) q = q.gte('lng', -5.5).lte('lng', 9.6).gte('lat', 41.3).lte('lat', 51.1);
    if (filtre_ville)   q = q.ilike('ville', `%${filtre_ville}%`);

    const { data: rawRows, error: poiErr } = await q.limit(MAX_POIS_BATTLE);
    if (poiErr) {
      send({ type: 'error', message: `Erreur chargement POIs : ${poiErr.message}` });
      return;
    }

    const pois: PoiRow[] = (rawRows ?? [])
      .filter((p: any) => {
        if (p.lat == null || p.lng == null) return false;
        if (!regionNorms) return true;
        const pNorm = normStr(p.region ?? '');
        return regionNorms.some(rn => pNorm.includes(rn) || rn.includes(pNorm));
      })
      .map((p: any) => ({
        id:        String(p.id),
        nom:       p.nom       ?? '',
        lat:       Number(p.lat),
        lng:       Number(p.lng),
        categorie: p.categorie ?? category,
        adresse:   p.adresse   ?? '',
        ville:     p.ville     ?? '',
      }));

    if (pois.length < 2) {
      send({ type: 'error', message: `Moins de 2 POIs trouvés pour "${category}"` });
      return;
    }

    send({ type: 'pois_loaded', total: pois.length });

    // ── 2. Cache lookup : tous les niveaux en parallèle ──────────────────────
    const rings: RingEntry[] = [];
    const levelCacheMaps     = new Map<number, Map<string, object>>();

    await Promise.all(BATTLE_LEVELS.map(async level => {
      const cacheKeys = pois.map(p => perCircfaCacheKey(category, p.id, level, normalizedMode));
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

    // ── 3. Grouper les MISS par POI ───────────────────────────────────────────
    // Optimisation clé : N_POIs appels multi-range au lieu de N_POIs×N_niveaux
    interface PoiMissEntry {
      poi:           PoiRow;
      missingLevels: number[];
      cacheKeys:     Map<number, string>;
    }
    const poisWithMisses = new Map<string, PoiMissEntry>();
    let   totalHits      = 0;

    for (const level of BATTLE_LEVELS) {
      const geomMap = levelCacheMaps.get(level)!;
      for (const poi of pois) {
        const ck   = perCircfaCacheKey(category, poi.id, level, normalizedMode);
        const geom = geomMap.get(ck);
        if (geom) {
          rings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier: level, geojson: geom });
          totalHits++;
        } else {
          if (!poisWithMisses.has(poi.id)) {
            poisWithMisses.set(poi.id, { poi, missingLevels: [], cacheKeys: new Map() });
          }
          const entry = poisWithMisses.get(poi.id)!;
          entry.missingLevels.push(level);
          entry.cacheKeys.set(level, ck);
        }
      }
    }

    const poiEntries = [...poisWithMisses.values()];

    // Streamer immédiatement les rings en cache pour affichage progressif
    if (rings.length > 0) {
      send({ type: 'partial_rings', rings: rings.map(r => ({
        cirfa_id: r.cirfa_id, nom: r.nom, lat: r.lat, lng: r.lng, palier: r.palier, geojson: r.geojson,
      })) });
    }

    // ── 4. Appels ORS multi-range avec concurrence ────────────────────────────
    let orsCompleted = 0;
    let orsOk        = 0;
    let orsErr       = 0;
    let firstOrsErr: string | null = null;  // pour message d'erreur diagnostique

    const processPoiORS = async (entry: PoiMissEntry) => {
      const { poi, missingLevels, cacheKeys } = entry;
      const sortedLevels = [...missingLevels].sort((a, b) => a - b);

      const { geomMap, errorMsg } = await callORSMulti([poi.lng, poi.lat], sortedLevels, normalizedMode, apiKey);
      if (errorMsg && !firstOrsErr) firstOrsErr = errorMsg;

      for (const level of sortedLevels) {
        const geom     = geomMap.get(level);
        const cacheKey = cacheKeys.get(level)!;
        if (geom) {
          rings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier: level, geojson: geom });
          orsOk++;
          // Écriture cache fire-and-forget
          supabase.from('isochrones_cache').upsert(
            {
              cache_key:  cacheKey,
              ville:      '_battle_',
              categorie:  category,
              minutes:    level,
              mode:       normalizedMode,
              geojson:    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geom, properties: {} }] },
              poi_count:  1,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'cache_key' }
          ).then(({ error }) => {
            if (error) console.warn('[battle] cache write fail:', error.message);
          });
        } else {
          orsErr += sortedLevels.length - geomMap.size;  // niveaux manquants dans la réponse
          break;  // si le POI a échoué, tous ses niveaux manquent
        }
      }
      orsCompleted++;
      // Streaming progressif : envoyer les anneaux bruts du POI pour affichage immédiat
      const newRings = sortedLevels
        .map(level => geomMap.get(level)
          ? { cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier: level, geojson: geomMap.get(level) }
          : null)
        .filter(Boolean);
      if (newRings.length > 0) {
        send({ type: 'partial_rings', rings: newRings });
      }
      send({ type: 'progress', completed: orsCompleted, total: poiEntries.length, ok: orsOk, err: orsErr });
    };

    // Fenêtre glissante de ORS_CONCURRENCY tâches simultanées
    for (let i = 0; i < poiEntries.length; i += ORS_CONCURRENCY) {
      await Promise.all(poiEntries.slice(i, i + ORS_CONCURRENCY).map(processPoiORS));
    }


    if (rings.length === 0) {
      const detail = firstOrsErr ? ` — ${firstOrsErr}` : ' Vérifier ORS_API_KEY et les coordonnées POIs.';
      send({ type: 'error', message: `ORS n'a retourné aucun isochrone.${detail}` });
      return;
    }

    // ── 5. Isochrones bruts → GeoJSON features ───────────────────────────────
    const ringFeatures = rings.map(r => ({
      type:       'Feature' as const,
      geometry:   r.geojson,
      properties: {
        feature_type: 'ring',
        id:           r.cirfa_id,
        cirfa_id:     r.cirfa_id,
        nom:          r.nom,
        lat:          r.lat,
        lng:          r.lng,
        palier:       r.palier,
      },
    }));

    // ── 6. Réponse + cache complet ────────────────────────────────────────────
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
    const battleBorders = null;

    await supabase.from('isochrones_cache').upsert({
      cache_key:  battleCacheKey,
      ville:      '_battle_full_',
      categorie:  String(category),
      minutes:    maxMin,
      mode:       normalizedMode,
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
      mode:          normalizedMode,
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
