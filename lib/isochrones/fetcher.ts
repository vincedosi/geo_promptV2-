/**
 * lib/isochrones/fetcher.ts
 * Module partagé : appel ORS API + cache Supabase pour les isochrones.
 * Réutilisé par /api/chat/route.ts et /api/isochrone-battle/route.ts
 */

import { createAdminClient } from '@/lib/auth';
import { logger } from '@/lib/logger';
import type { PoiRow } from '@/types/poi';
import { toJson } from '@/lib/supabase/rpc-json';
import { fetchLectureAvecReprise } from '@/lib/http/lecture-avec-reprise';

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
/** Délai par tentative. ORS répond en 1-4 s pour 5 points ; au-delà de 12 s il ne répondra pas. */
export const ORS_DELAI_MS    = 12_000;
/** Une expiration se rejoue vite : le service est en général déjà revenu. */
const ORS_ATTENTE_DELAI_MS   = 5_000;
const ORS_URL = 'https://api.openrouteservice.org/v2/isochrones';

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
    logger.warn('isochrone', 'ORS_API_KEY non définie — isochrones ignorés');
    return null;
  }

  const supabase = createAdminClient();

  // ── Cache Supabase ──────────────────────────────────────────────────────
  if (!forceRecalculate) {
    // maybeSingle : l'absence de ligne est un cas NORMAL (cache froid), pas
    // une erreur PGRST116 à ignorer.
    const { data: cached } = await supabase
      .from('isochrones_cache')
      .select('geojson, created_at, poi_count')
      .eq('cache_key', cacheCtx.cacheKey)
      .maybeSingle();

    if (cached) {
      logger.debug('isochrone', `Cache HIT: ${cacheCtx.cacheKey} (calculé le ${cached.created_at})`);
      return {
        ...(cached.geojson as object),
        _fromCache: true,
        _cachedAt:  cached.created_at,
        _poiCount:  cached.poi_count,
      };
    }
    logger.debug('isochrone', `Cache MISS: ${cacheCtx.cacheKey} → calcul ORS`);
  } else {
    logger.debug('isochrone', `forceRecalculate=true → bypass cache pour ${cacheCtx.cacheKey}`);
  }

  // ── Appel ORS par batches ───────────────────────────────────────────────
  const profile  = ORS_PROFILES[mode] ?? 'foot-walking';
  const rangeSec = minutes * 60;
  const sliced   = pois.slice(0, maxPois);

  if (pois.length > maxPois) {
    logger.warn('isochrone', `Troncature: ${pois.length} POIs → ${maxPois}`);
  }

  const allFeatures: unknown[] = [];

  for (let i = 0; i < sliced.length; i += ORS_BATCH_SIZE) {
    const batch    = sliced.slice(i, i + ORS_BATCH_SIZE);
    const locations = batch.map(p => [p.lng, p.lat]);
    const batchNum  = Math.floor(i / ORS_BATCH_SIZE) + 1;

    // Un isochrone est un CALCUL : rejouer la demande est sans effet de bord.
    // Reprise : 429 → 20 s (quota ORS par minute) ; 5xx et erreur réseau →
    // 20 s ; expiration → 5 s. Un 4xx autre que 429 n'est pas rejoué.
    let success = false;
    try {
      const res = await fetchLectureAvecReprise(`${ORS_URL}/${profile}`, {
        method: 'POST',
        headers: {
          'Authorization':  `Bearer ${apiKey}`,
          'Content-Type':   'application/json',
          'Accept':         'application/geo+json',
        },
        body: JSON.stringify({ locations, range: [rangeSec], range_type: 'time' }),
      }, {
        delaiMs: ORS_DELAI_MS,
        tentatives: ORS_MAX_RETRIES,
        attente: (tentative, cause) => {
          if (cause.type === 'delai') {
            logger.warn('isochrone', `Expiration ${ORS_DELAI_MS / 1000}s batch ${batchNum} (tentative ${tentative + 1}/${ORS_MAX_RETRIES})`);
            return ORS_ATTENTE_DELAI_MS;
          }
          if (cause.type === 'reseau') {
            logger.warn('isochrone', `Erreur réseau batch ${batchNum} (tentative ${tentative + 1}/${ORS_MAX_RETRIES}) : ${cause.erreur.message}`);
            return ORS_RETRY_DELAY;
          }
          const statut = cause.reponse.status;
          if (statut !== 429 && statut < 500) return null;
          logger.warn('isochrone', `ORS HTTP ${statut} batch ${batchNum} (tentative ${tentative + 1}/${ORS_MAX_RETRIES}), attente ${ORS_RETRY_DELAY / 1000}s`);
          return ORS_RETRY_DELAY;
        },
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        logger.error('isochrone', `ORS HTTP ${res.status} batch ${batchNum}: ${errText.slice(0, 300)}`);
      } else {
        const data = await res.json();
        if (Array.isArray(data.features)) {
          allFeatures.push(...data.features);
        }
        success = true;
        logger.debug('isochrone', `Batch ${batchNum}: ${data.features?.length ?? 0} polygones`);
      }
    } catch (e: unknown) {
      logger.error('isochrone', `Batch ${batchNum} injoignable : ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!success) {
      logger.warn('isochrone', `Batch ${batchNum} échoué après ${ORS_MAX_RETRIES} tentatives`);
    }
  }

  if (allFeatures.length === 0) return null;

  const rawGeojson = { type: 'FeatureCollection', features: allFeatures };

  // ── Clip aux frontières françaises ──────────────────────────────────────
  let geojson: typeof rawGeojson = rawGeojson;
  {
    const { data: clipped, error: clipErr } = await supabase.rpc(
      'clip_geojson_to_france',
      { p_fc: toJson(rawGeojson) }
    );
    if (clipErr) {
      logger.warn('isochrone', `clip_geojson_to_france error (fallback brut): ${clipErr.message}`);
    } else if (clipped) {
      geojson = clipped as typeof rawGeojson;
      const nb = (geojson as { features?: unknown[] }).features?.length ?? 0;
      logger.debug('isochrone', `Clip France OK → ${nb} polygones retenus`);
    }
  }

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
        geojson: toJson(geojson),
        poi_count:  sliced.length,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' }
    );

  if (cacheErr) {
    logger.error('isochrone', `Erreur sauvegarde cache: ${cacheErr.message}`);
  } else {
    logger.debug('isochrone', `Cache sauvegardé: ${cacheCtx.cacheKey} (${allFeatures.length} polygones)`);
  }

  logger.debug('isochrone', `Total: ${allFeatures.length} polygones (${minutes}min, ${mode})`);
  return geojson;
}
