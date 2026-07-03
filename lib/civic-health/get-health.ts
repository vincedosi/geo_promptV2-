/**
 * Pipeline partagé de récupération d'un indicateur santé environnementale
 * (air ATMO + pollen) pour une commune : cache fresh (< 24h) → provider →
 * upsert cache → fallback stale (< 48h). Extrait de la route
 * /api/civic-indicators/health/[code_insee] pour être réutilisé par la
 * carte des allergènes (/api/civic-indicators/pollen-map).
 */
import { getProvider } from './provider';
import { getFreshCachedHealth, getStaleCachedHealth, upsertCachedHealth } from './cache';
import type { HealthIndicator, HealthProviderName } from './types';

export interface HealthLookupResult {
  data: HealthIndicator | null;
  provider: HealthProviderName;
}

export async function getHealthWithCache(codeInsee: string): Promise<HealthLookupResult> {
  const provider = getProvider();

  // 1. Cache fresh (< 24h)
  try {
    const fresh = await getFreshCachedHealth(codeInsee);
    if (fresh) return { data: fresh, provider: provider.name };
  } catch (err) {
    console.warn('[civic-health/get-health] cache lookup failed', err);
  }

  // 2. Provider
  let payload: HealthIndicator | null = null;
  try {
    payload = await provider.fetchHealth(codeInsee);
  } catch (err) {
    console.warn('[civic-health/get-health] provider error', err);
  }
  if (payload) {
    upsertCachedHealth(codeInsee, payload, provider.name).catch(err => {
      console.warn('[civic-health/get-health] cache upsert failed', err);
    });
    return { data: payload, provider: provider.name };
  }

  // 3. Fallback stale (< 48h)
  const stale = await getStaleCachedHealth(codeInsee).catch(() => null);
  return { data: stale, provider: provider.name };
}
