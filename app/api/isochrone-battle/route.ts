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

// ── Appel ORS : 1 seul POI par requête (plus fiable que les batches) ─────────
/**
 * Retourne la geometry GeoJSON pour un seul point, ou null en cas d'échec.
 * Stratégie : 3 tentatives max avec backoff progressif.
 *   - 429 → attente 12s puis retry
 *   - Timeout (20s) → attente 3s puis retry
 *   - Autre erreur → abandon immédiat
 */
async function callORSSingle(
  location: [number, number],
  minutes:  number,
  mode:     string,
  apiKey:   string
): Promise<object | null> {
  const profile  = ORS_PROFILES[mode] ?? 'driving-car';
  const rangeSec = minutes * 60;
  const TIMEOUT  = 20_000;

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
          body: JSON.stringify({
            locations:  [location],
            range:      [rangeSec],
            range_type: 'time',
          }),
        }
      );
      clearTimeout(timer);

      if (res.status === 429) {
        console.warn(`[ORS] 429 rate-limit (tentative ${attempt + 1}/3) — attente 12s`);
        await new Promise(r => setTimeout(r, 12_000));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.error(`[ORS] HTTP ${res.status} — ${txt.slice(0, 150)}`);
        return null; // erreur définitive, pas de retry
      }

      const data = await res.json();
      const geom  = data.features?.[0]?.geometry ?? null;
      if (!geom) console.warn(`[ORS] Réponse OK mais aucune feature (${minutes}min, ${mode})`);
      return geom;

    } catch (e: any) {
      clearTimeout(timer);
      const isTimeout = e.name === 'AbortError';
      console.error(`[ORS] ${isTimeout ? `Timeout ${TIMEOUT/1000}s` : e.message} (tentative ${attempt + 1}/3, ${minutes}min)`);
      if (attempt < 2) await new Promise(r => setTimeout(r, isTimeout ? 3_000 : 2_000));
    }
  }
  return null;
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
    durations          = null,
  } = body as Record<string, unknown>;

  const maxMin = Math.min(Math.max(Number(max_minutes) || 120, 30), 180);
  // Si l'UI envoie des durées explicites, on les utilise (évite de tripler les appels ORS).
  // Sinon, fallback sur tous les niveaux standard jusqu'à maxMin.
  const BATTLE_LEVELS = Array.isArray(durations) && durations.length > 0
    ? (durations as number[]).map(Number).filter(n => n > 0 && n <= 180).sort((a, b) => a - b)
    : ALL_LEVELS.filter(l => l <= maxMin);

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

    // ── Construire la liste plate des POIs manquants (1 entrée par POI×niveau) ─
    type MissItem = { level: number; poi: PoiRow; cacheKey: string };
    const missItems: MissItem[] = [];

    for (const level of BATTLE_LEVELS) {
      const geomMap = levelCacheMaps.get(level)!;
      let hits = 0;
      for (const poi of pois) {
        const ck   = perCircfaCacheKey(category, poi.id, level, String(mode));
        const geom = geomMap.get(ck);
        if (geom) {
          rings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier: level, geojson: geom });
          hits++;
        } else {
          missItems.push({ level, poi, cacheKey: ck });
        }
      }
      console.log(`[battle] Palier ${level}min : ${hits} hits cache, ${pois.length - hits} miss`);
    }

    // ── Appels ORS séquentiels, 1 POI à la fois, 500ms entre chaque ──────────
    // Séquentiel = zéro rate-limit, compatible ORS free tier (≤40 req/min).
    // Chaque appel est indépendant (pas de group_index), plus simple et fiable.
    const ORS_CALL_DELAY = 500;
    let orsOk = 0; let orsErr = 0;

    console.log(`[battle] ${missItems.length} appels ORS séquentiels à lancer…`);

    for (let i = 0; i < missItems.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, ORS_CALL_DELAY));

      const { level, poi, cacheKey } = missItems[i];
      const geom = await callORSSingle([poi.lng, poi.lat], level, String(mode), apiKey);

      if (geom) {
        rings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier: level, geojson: geom });
        orsOk++;
        // Écriture cache fire-and-forget
        const fc = {
          type:     'FeatureCollection',
          features: [{ type: 'Feature', geometry: geom, properties: {} }],
        };
        supabase.from('isochrones_cache').upsert(
          { cache_key: cacheKey, ville: '_battle_', categorie: category, minutes: level, mode: String(mode), geojson: fc, poi_count: 1, created_at: new Date().toISOString() },
          { onConflict: 'cache_key' }
        ).then(({ error }) => {
          if (error) console.warn('[battle] cache write fail:', error.message);
        });
      } else {
        orsErr++;
      }

      // Progression toutes les 5 appels ou en fin
      if ((i + 1) % 5 === 0 || i === missItems.length - 1) {
        send({ type: 'progress', completed: i + 1, total: missItems.length, ok: orsOk, err: orsErr });
      }
    }

    console.log(`[battle] ORS terminé — ${orsOk} ok, ${orsErr} erreurs`);

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

    const allFeatures = Array.isArray(battleRows) ? battleRows : [];

    // ── Filtrer les géométries dégénérées (slivers PostGIS) ──────────────────
    // ST_Difference produit des micro-polygones (<0.0001 deg² ≈ <1 km²) quand
    // deux isochrones se croisent. On les élimine avant affichage/cache.
    const isValidGeom = (f: any): boolean => {
      const geom = f?.geometry;
      if (!geom) return false;
      const type = geom.type;
      if (type === 'Point' || type === 'LineString' || type === 'MultiLineString') return false;
      // Polygon : au moins 4 coordonnées dans le premier ring
      if (type === 'Polygon') return (geom.coordinates?.[0]?.length ?? 0) >= 4;
      // MultiPolygon : au moins un polygon valide
      if (type === 'MultiPolygon') return (geom.coordinates?.length ?? 0) > 0;
      return false;
    };

    const ringFeatures   = allFeatures.filter((f: any) => f?.properties?.feature_type === 'ring'   && isValidGeom(f));
    const borderFeatures = allFeatures.filter((f: any) => f?.properties?.feature_type === 'border' && isValidGeom(f));

    console.log(
      `[battle] → ${ringFeatures.length} anneaux, ${borderFeatures.length} bordures CIRFA`
    );

    // ── Clip de secours sur le résultat final (double protection France) ──────
    // Si clip_rings_to_france n'a pas fonctionné (migration non exécutée,
    // france_borders vide), on tente de clipper la FeatureCollection résultat.
    const clipResult = async (fc: { type: string; features: any[] }) => {
      try {
        const { data, error } = await supabase.rpc('clip_geojson_to_france', { p_fc: fc });
        if (!error && data && (data as any).features?.length > 0) return data as typeof fc;
      } catch { /* ignore */ }
      return fc;
    };

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

    const battleGeoJSONRaw = { type: 'FeatureCollection', features: ringFeatures };
    const battleBorders    = { type: 'FeatureCollection', features: borderFeatures };

    // Double clip : garantit qu'aucun polygone ne dépasse les frontières françaises
    const battleGeoJSON = await clipResult(battleGeoJSONRaw);

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
