/**
 * /api/isochrone-battle-v2/route.ts
 *
 * Bataille multi-paliers (ex: 10, 20, 30, 40, 50, 60, 90 min).
 *
 * AUCUN appel ORS — lit uniquement le cache isochrones_cache.
 * Si un palier manque en cache pour un POI, il est skipé avec un warning.
 *
 * Utilise la fonction PostGIS get_isochrone_battle_v10 :
 *   - ST_Subdivide pour résoudre les chevauchements intra-palier
 *   - Attribution au POI le plus proche (ST_Distance) dans les zones de recouvrement
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const maxDuration = 300;

const CACHE_CHUNK = 200;

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
  pac: "Provence-Alpes-Cote d'Azur",
  dom: 'DROM',
};

function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function perPoiCacheKey(category: string, poiId: string, level: number, mode: string): string {
  return `battle__${normKey(category)}__${normKey(poiId)}__${level}min__${normKey(mode)}`;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const {
    category          = '',
    mode              = 'drive',
    metropolitaine    = true,
    filtre_regions    = null,
    filtre_ville      = null,
    paliers           = [10, 20, 30, 40, 50, 60, 90],
    force_battle      = false,
  } = body as Record<string, unknown>;

  const MODE_NORMALIZE: Record<string, string> = {
    drive: 'drive', 'driving-car': 'drive',
    walk:  'walk',  'foot-walking': 'walk',
    bike:  'bike',  'cycling-regular': 'bike',
  };
  const normalizedMode  = MODE_NORMALIZE[String(mode)] ?? 'drive';
  const PALIERS: number[] = Array.isArray(paliers)
    ? (paliers as number[]).map(Number).filter(n => n > 0 && n <= 180).sort((a, b) => a - b)
    : [10, 20, 30, 40, 50, 60, 90];

  if (!category || typeof category !== 'string')
    return NextResponse.json({ error: 'category requis' }, { status: 400 });
  if (PALIERS.length === 0)
    return NextResponse.json({ error: 'Aucun palier valide (1–180 min)' }, { status: 400 });

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        const supabase = createAdminClient();

        // ── 0. Cache résultat complet ──────────────────────────────────────
        const normStr = (s: string) =>
          s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

        const regions     = Array.isArray(filtre_regions) && (filtre_regions as string[]).length > 0
          ? (filtre_regions as string[]) : null;
        const regionKey   = regions ? [...regions].sort().join('+') : metropolitaine ? 'metro' : 'all';
        const battleCacheKey = `battle_v2_full__${normKey(String(category))}__${normKey(normalizedMode)}__${PALIERS.join('-')}min__${regionKey}${filtre_ville ? '__' + normKey(String(filtre_ville)) : ''}`;

        if (!force_battle) {
          const { data: cached } = await supabase
            .from('isochrones_cache').select('geojson').eq('cache_key', battleCacheKey).single();
          if (cached?.geojson) {
            const c = cached.geojson as any;
            send({ type: 'result', data: {
              battleGeoJSON: c.battleGeoJSON,
              battleBorders: c.battleBorders ?? null,
              poisForMap:    c.poisForMap,
              nb_features: c.battleGeoJSON?.features?.length ?? 0,
              nb_pois:     c.poisForMap?.length ?? 0,
              category, mode: normalizedMode, paliers: PALIERS,
              fromCache: true, battleCacheKey,
            }});
            return;
          }
        }

        // ── 1. Charger les POIs ────────────────────────────────────────────
        const regionNorms = regions ? regions.map(r => normStr(REGION_ID_TO_NAME[r] ?? r)) : null;

        let q = supabase.from('poi_france')
          .select('id, nom, lat, lng, categorie, adresse, ville, region')
          .ilike('categorie', category);
        if (metropolitaine) q = q.gte('lng', -5.5).lte('lng', 9.6).gte('lat', 41.3).lte('lat', 51.1);
        if (filtre_ville)   q = q.ilike('ville', `%${filtre_ville}%`);

        const { data: rawRows, error: poiErr } = await q.limit(500);
        if (poiErr) { send({ type: 'error', message: `Erreur chargement POIs : ${poiErr.message}` }); return; }

        const pois = (rawRows ?? [])
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

        // ── 2. Lecture cache — UNE seule requête chunked ──────────────────
        const allKeys = pois.flatMap(p =>
          PALIERS.map(l => perPoiCacheKey(category, p.id, l, normalizedMode)),
        );
        const chunks: string[][] = [];
        for (let i = 0; i < allKeys.length; i += CACHE_CHUNK)
          chunks.push(allKeys.slice(i, i + CACHE_CHUNK));

        const results = await Promise.all(
          chunks.map(chunk =>
            supabase.from('isochrones_cache').select('cache_key, geojson').in('cache_key', chunk),
          ),
        );

        const cacheHitMap = new Map<string, object>();
        for (const { data } of results) {
          for (const row of data ?? []) {
            const geom = (row.geojson as any)?.features?.[0]?.geometry;
            if (geom) cacheHitMap.set(row.cache_key, geom);
          }
        }

        // ── 3. Construire les rings depuis le cache ───────────────────────
        type RingEntry = {
          cirfa_id: string; nom: string; lat: number; lng: number;
          palier: number; geojson: object;
        };
        const rings: RingEntry[] = [];
        const missingLog: { poi: string; palier: number }[] = [];

        for (const poi of pois) {
          for (const palier of PALIERS) {
            const ck   = perPoiCacheKey(category, poi.id, palier, normalizedMode);
            const geom = cacheHitMap.get(ck);
            if (geom) {
              rings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier, geojson: geom });
            } else {
              missingLog.push({ poi: poi.nom, palier });
            }
          }
        }

        if (missingLog.length > 0) {
          const sample = missingLog.slice(0, 5).map(m => `${m.poi}@${m.palier}min`).join(', ');
          console.warn(`[battle-v2] ${missingLog.length} paliers manquants en cache (ex: ${sample})`);
          send({ type: 'warning', message: `${missingLog.length} paliers manquants en cache — skippés.`, sample });
        }

        if (rings.length === 0) {
          send({ type: 'error', message: 'Aucun isochrone trouvé en cache. Lance d\'abord le calcul des isochrones pour les paliers voulus.' });
          return;
        }

        send({ type: 'rings_loaded', count: rings.length, missing: missingLog.length });

        // ── 4. Appel PostGIS get_isochrone_battle_v10 ────────────────────
        const p_rings = rings.map(r => ({
          cirfa_id: r.cirfa_id,
          nom:      r.nom,
          lat:      r.lat,
          lng:      r.lng,
          palier:   r.palier,
          geojson:  JSON.stringify(r.geojson),
        }));

        send({ type: 'computing', message: `PostGIS — ${rings.length} anneaux, ${PALIERS.length} paliers…` });

        const { data: battleResult, error: battleErr } = await supabase.rpc(
          'get_isochrone_battle',
          { p_rings },
        );

        if (battleErr) {
          send({ type: 'error', message: `Erreur PostGIS : ${battleErr.message}` });
          return;
        }

        const features: GeoJSON.Feature[] = Array.isArray(battleResult) ? battleResult as GeoJSON.Feature[] : [];
        const battleGeoJSON = { type: 'FeatureCollection', features };
        const poisForMap    = pois.map(p => ({
          id: p.id, nom: p.nom, lat: p.lat, lng: p.lng,
          categorie: p.categorie, adresse: p.adresse, ville: p.ville,
        }));

        // ── 5. Cache résultat complet ─────────────────────────────────────
        await supabase.from('isochrones_cache').upsert({
          cache_key: battleCacheKey, ville: '_battle_v2_full_', categorie: String(category),
          minutes: Math.max(...PALIERS), mode: normalizedMode,
          geojson: { battleGeoJSON, battleBorders: null, poisForMap },
          poi_count: pois.length, created_at: new Date().toISOString(),
        }, { onConflict: 'cache_key' });

        send({ type: 'result', data: {
          battleGeoJSON, battleBorders: null, poisForMap,
          nb_features: features.length, nb_pois: pois.length,
          category, mode: normalizedMode, paliers: PALIERS,
          battleCacheKey,
        }});

      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erreur inconnue';
        console.error('[battle-v2]', msg);
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
