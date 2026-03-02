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

export const maxDuration = 300;  // Vercel timeout étendu

const ALL_LEVELS      = [10, 30, 60, 90, 120, 150, 180] as const;
const ORS_BATCH_SIZE  = 5;
const MAX_POIS_BATTLE = 300;

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

  for (let attempt = 0; attempt < ORS_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        `https://api.openrouteservice.org/v2/isochrones/${profile}`,
        {
          method:  'POST',
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

      if (res.status === 429) {
        console.warn(
          `[battle/ORS] Rate limit (tentative ${attempt + 1}), attente ${ORS_RETRY_DELAY / 1000}s…`
        );
        await new Promise(r => setTimeout(r, ORS_RETRY_DELAY));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[battle/ORS] HTTP ${res.status}: ${errText}`);
        return [];
      }

      const data = await res.json();
      return (data.features ?? []).map((f: any) => ({
        group_index: Number(f.properties?.group_index ?? 0),
        geometry:    f.geometry,
      }));
    } catch (e: any) {
      console.error(`[battle/ORS] Fetch error (tentative ${attempt + 1}):`, e.message);
      if (attempt < ORS_MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 5_000));
      }
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
  try {
    const body = await req.json();
    const {
      category           = '',
      mode               = 'drive',
      metropolitaine     = true,
      filtre_ville       = null,
      filtre_region      = null,
      filtre_departement = null,
      force_recalculate  = false,
      max_minutes        = 120,
    } = body as Record<string, unknown>;

    // Niveaux dynamiques : tous les paliers ≤ max_minutes
    const maxMin = Math.min(Math.max(Number(max_minutes) || 120, 30), 180);
    const BATTLE_LEVELS = ALL_LEVELS.filter(l => l <= maxMin);

    if (!category || typeof category !== 'string') {
      return NextResponse.json({ error: 'category requis' }, { status: 400 });
    }

    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ORS_API_KEY non configurée' }, { status: 500 });
    }

    const supabase = createAdminClient();

    // ── 1. Charger les POIs ──────────────────────────────────────────────────
    let query = supabase
      .from('poi_france')
      .select('id, nom, lat, lng, categorie, adresse, ville')
      .ilike('categorie', category);

    if (metropolitaine) {
      query = query
        .gte('lng', -5.5).lte('lng',  9.6)
        .gte('lat', 41.3).lte('lat', 51.1);
    }
    if (filtre_ville)        query = query.ilike('ville',      `%${filtre_ville}%`);
    if (filtre_region)       query = query.ilike('region',     `%${filtre_region}%`);
    if (filtre_departement)  query = query.or(
      `departement.ilike.%${filtre_departement}%,code_departement.eq.${filtre_departement}`
    );

    const { data: poisRaw, error: poiErr } = await query.limit(MAX_POIS_BATTLE);
    if (poiErr) {
      return NextResponse.json({ error: poiErr.message }, { status: 500 });
    }

    const pois: PoiRow[] = (poisRaw ?? [])
      .filter(p => p.lat != null && p.lng != null)
      .map(p => ({
        id:        String(p.id),
        nom:       p.nom       ?? '',
        lat:       Number(p.lat),
        lng:       Number(p.lng),
        categorie: p.categorie ?? category,
        adresse:   p.adresse   ?? '',
        ville:     p.ville     ?? '',
      }));

    if (pois.length < 2) {
      return NextResponse.json(
        { error: `Moins de 2 POIs trouvés pour "${category}"` },
        { status: 422 }
      );
    }

    console.log(`[battle] "${category}" → ${pois.length} POIs, mode=${mode}`);

    // ── 2. Per-CIRFA per-niveau : cache → ORS ───────────────────────────────
    const rings: RingEntry[] = [];

    for (const level of BATTLE_LEVELS) {
      // Construire toutes les clés cache pour ce niveau (une par CIRFA)
      const cacheKeys = pois.map(p =>
        perCircfaCacheKey(category, p.id, level, String(mode))
      );

      // Lookup batch (1 requête Supabase pour tout le niveau)
      const cacheGeomMap = new Map<string, object>();
      if (!force_recalculate) {
        const { data: cachedRows } = await supabase
          .from('isochrones_cache')
          .select('cache_key, geojson')
          .in('cache_key', cacheKeys);

        for (const row of cachedRows ?? []) {
          // geojson stocké = FeatureCollection à 1 feature → extraire geometry
          const features = (row.geojson as any)?.features ?? [];
          if (features.length > 0 && features[0]?.geometry) {
            cacheGeomMap.set(row.cache_key, features[0].geometry);
          }
        }
      }

      // Séparer les CIRFA cachés / manquants
      const missedItems: { poi: PoiRow; cacheKey: string }[] = [];
      for (let i = 0; i < pois.length; i++) {
        const poi = pois[i];
        const ck  = cacheKeys[i];
        const geom = cacheGeomMap.get(ck);
        if (geom) {
          rings.push({ cirfa_id: poi.id, nom: poi.nom, lat: poi.lat, lng: poi.lng, palier: level, geojson: geom });
        } else {
          missedItems.push({ poi, cacheKey: ck });
        }
      }

      const cacheHits = pois.length - missedItems.length;
      console.log(
        `[battle] Palier ${level}min : ${cacheHits} cache hits, ${missedItems.length} miss ORS`
      );

      // ── Appels ORS pour les MISS (batches de 5) ─────────────────────────
      for (let bi = 0; bi < missedItems.length; bi += ORS_BATCH_SIZE) {
        const batch     = missedItems.slice(bi, bi + ORS_BATCH_SIZE);
        const locations = batch.map(({ poi }) => [poi.lng, poi.lat] as [number, number]);
        const batchNum  = Math.floor(bi / ORS_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(missedItems.length / ORS_BATCH_SIZE);

        console.log(
          `[battle] ORS palier ${level}min, batch ${batchNum}/${totalBatches} (${batch.length} CIRFA)`
        );

        const orsFeatures = await callORS(locations, level, String(mode), apiKey);

        for (const f of orsFeatures) {
          // group_index est l'index dans le batch courant (0 → batch.length-1)
          const item = batch[f.group_index];
          if (!item || !f.geometry) continue;

          const { poi, cacheKey } = item;

          // Ajouter à la liste des anneaux
          rings.push({
            cirfa_id: poi.id,
            nom:      poi.nom,
            lat:      poi.lat,
            lng:      poi.lng,
            palier:   level,
            geojson:  f.geometry,
          });

          // Cacher le résultat individuel pour les appels futurs
          const fc = {
            type:     'FeatureCollection',
            features: [{ type: 'Feature', geometry: f.geometry, properties: { group_index: 0 } }],
          };
          await supabase.from('isochrones_cache').upsert(
            {
              cache_key:  cacheKey,
              ville:      '_battle_',
              categorie:  category,
              minutes:    level,
              mode:       String(mode),
              geojson:    fc,
              poi_count:  1,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'cache_key' }
          );
        }

        const gotCount = orsFeatures.length;
        if (gotCount < batch.length) {
          console.warn(
            `[battle] Palier ${level}min batch ${batchNum}: ORS a retourné ${gotCount}/${batch.length} polygones`
          );
        }
      }

      const levelRings = rings.filter(r => r.palier === level).length;
      console.log(`[battle] Palier ${level}min → ${levelRings}/${pois.length} polygones`);
    }

    if (rings.length === 0) {
      return NextResponse.json(
        { error: 'ORS n\'a retourné aucun isochrone. Vérifier ORS_API_KEY et les coordonnées POIs.' },
        { status: 422 }
      );
    }

    // ── 3. Appel PostGIS : ST_Difference pur, zéro Voronoï ──────────────────
    console.log(`[battle] RPC get_isochrone_battle → ${rings.length} polygones…`);

    const { data: battleRows, error: rpcErr } = await supabase.rpc(
      'get_isochrone_battle',
      { p_rings: rings }
    );

    if (rpcErr) {
      console.error('[battle] Erreur RPC:', rpcErr.message);
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
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

    return NextResponse.json({
      battleGeoJSON: { type: 'FeatureCollection', features: ringFeatures },
      battleBorders: { type: 'FeatureCollection', features: borderFeatures },
      poisForMap,
      nb_features:   ringFeatures.length,
      nb_pois:       pois.length,
      category,
      mode,
      levels:        [...BATTLE_LEVELS],
      metropolitaine,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue';
    console.error('[battle] Erreur inattendue:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
