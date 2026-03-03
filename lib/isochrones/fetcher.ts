/**
 * lib/isochrones/fetcher.ts
 * Module partagé : appel ORS API + cache Supabase pour les isochrones.
 * Réutilisé par /api/chat/route.ts et /api/isochrone-battle/route.ts
 */

import { createAdminClient } from '@/lib/auth';
import type { PoiRow } from '@/types/poi';

// ── Types ────────────────────────────────────────────────────────────────────
export type { PoiRow };

// ── Profils ORS ──────────────────────────────────────────────────────────────
export const ORS_PROFILES: Record<string, string> = {
  walk:  'foot-walking',
  drive: 'driving-car',
  bike:  'cycling-regular',
};

export const ORS_BATCH_SIZE  = 5;
export const ORS_MAX_RETRIES = 3;
export const ORS_RETRY_DELAY = 20_000; // 20s entre retries (rate limit ORS)

// Limite de POIs pour /api/chat (timeout 120s)
export const ORS_MAX_POIS_CHAT = 50;
// Limite pour /api/isochrone-battle (timeout étendu, cache prioritaire)
export const ORS_MAX_POIS_ROUTIER = 300;

export interface IsochroneCacheCtx {
  cacheKey: string;
  ville: string;
  categorie?: string;
}

// ── Utilitaires ──────────────────────────────────────────────────────────────
/** Normalise une chaîne pour les clés de cache */
function normKey(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
}

/** Clé de cache : ville__categorie__Xmin__mode[__suffixe] */
export function buildIsochCacheKey(
  ville: string,
  categorie: string | undefined,
  minutes: number,
  mode: string,
  suffix?: string
): string {
  const vk = normKey(ville);
  const ck = normKey(categorie ?? 'all');
  const base = `${vk}__${ck}__${minutes}min__${mode}`;
  return suffix ? `${base}__${normKey(suffix)}` : base;
}

// ── Appel ORS API + cache Supabase ───────────────────────────────────────────
/**
 * Génère les isochrones via ORS pour une liste de POIs.
 * Vérifie le cache Supabase avant tout appel réseau.
 * @param pois          Liste de POIs à traiter
 * @param minutes       Durée en minutes
 * @param mode          Mode de transport ('walk'|'drive'|'bike')
 * @param cacheCtx      Contexte pour la clé de cache
 * @param maxPois       Nombre max de POIs à traiter (tronque si dépassé)
 * @param forceRecalculate  Bypass le cache
 */
export async function fetchIsochrones(
  pois: PoiRow[],
  minutes: number,
  mode: string,
  cacheCtx: IsochroneCacheCtx,
  maxPois = ORS_MAX_POIS_CHAT,
  forceRecalculate = false
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    console.warn('[isochrone] ORS_API_KEY non définie — isochrones ignorés');
    return null;
  }

  const supabase = createAdminClient();

  // ── Cache Supabase ──────────────────────────────────────────────────────
  if (!forceRecalculate) {
    const { data: cached } = await supabase
      .from('isochrones_cache')
      .select('geojson, created_at, poi_count')
      .eq('cache_key', cacheCtx.cacheKey)
      .single();

    if (cached) {
      console.log(`[isochrone] Cache HIT: ${cacheCtx.cacheKey} (calculé le ${cached.created_at})`);
      return {
        ...(cached.geojson as object),
        _fromCache: true,
        _cachedAt:  cached.created_at,
        _poiCount:  cached.poi_count,
      };
    }
    console.log(`[isochrone] Cache MISS: ${cacheCtx.cacheKey} → calcul ORS`);
  } else {
    console.log(`[isochrone] forceRecalculate=true → bypass cache pour ${cacheCtx.cacheKey}`);
  }

  // ── Appel ORS par batches ───────────────────────────────────────────────
  const profile  = ORS_PROFILES[mode] ?? 'foot-walking';
  const rangeSec = minutes * 60;
  const sliced   = pois.slice(0, maxPois);

  if (pois.length > maxPois) {
    console.warn(`[isochrone] Troncature: ${pois.length} POIs → ${maxPois}`);
  }

  const allFeatures: unknown[] = [];

  for (let i = 0; i < sliced.length; i += ORS_BATCH_SIZE) {
    const batch    = sliced.slice(i, i + ORS_BATCH_SIZE);
    const locations = batch.map(p => [p.lng, p.lat]);
    const batchNum  = Math.floor(i / ORS_BATCH_SIZE) + 1;

    let success = false;
    for (let attempt = 0; attempt < ORS_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch(
          `https://api.openrouteservice.org/v2/isochrones/${profile}`,
          {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Authorization':  apiKey,
              'Content-Type':   'application/json',
              'Accept':         'application/json, application/geo+json',
            },
            body: JSON.stringify({ locations, range: [rangeSec], range_type: 'time' }),
          }
        );
        clearTimeout(timer);

        if (res.status === 429) {
          console.warn(`[isochrone] Rate limit batch ${batchNum} (tentative ${attempt + 1}/${ORS_MAX_RETRIES}), attente ${ORS_RETRY_DELAY / 1000}s...`);
          await new Promise(r => setTimeout(r, ORS_RETRY_DELAY));
          continue;
        }

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[isochrone] ORS HTTP ${res.status} batch ${batchNum}: ${errText}`);
          break;
        }

        const data = await res.json();
        if (Array.isArray(data.features)) {
          allFeatures.push(...data.features);
        }
        success = true;
        console.log(`[isochrone] Batch ${batchNum}: ${data.features?.length ?? 0} polygones`);
        break;
      } catch (e: unknown) {
        clearTimeout(timer);
        const isTimeout = e instanceof Error && e.name === 'AbortError';
        console.error(
          `[isochrone] ${isTimeout ? 'Timeout 12s' : 'Fetch error'} batch ${batchNum} (tentative ${attempt + 1}):`,
          e instanceof Error ? e.message : e
        );
        if (attempt < ORS_MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, isTimeout ? 5_000 : ORS_RETRY_DELAY));
        }
      }
    }

    if (!success) {
      console.warn(`[isochrone] Batch ${batchNum} échoué après ${ORS_MAX_RETRIES} tentatives`);
    }
  }

  if (allFeatures.length === 0) return null;

  const geojson = { type: 'FeatureCollection', features: allFeatures };

  // ── Sauvegarde en cache ─────────────────────────────────────────────────
  const { error: cacheErr } = await supabase
    .from('isochrones_cache')
    .upsert(
      {
        cache_key:  cacheCtx.cacheKey,
        ville:      cacheCtx.ville,
        categorie:  cacheCtx.categorie ?? null,
        minutes,
        mode,
        geojson,
        poi_count:  sliced.length,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' }
    );

  if (cacheErr) {
    console.error('[isochrone] Erreur sauvegarde cache:', cacheErr.message);
  } else {
    console.log(`[isochrone] Cache sauvegardé: ${cacheCtx.cacheKey} (${allFeatures.length} polygones)`);
  }

  console.log(`[isochrone] Total: ${allFeatures.length} polygones (${minutes}min, ${mode})`);
  return geojson;
}
