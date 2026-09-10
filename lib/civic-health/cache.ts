/**
 * Cache Supabase pour les indicateurs civiques de santé.
 *
 * Lecture : SELECT (RLS public). Écriture : service role (bypass RLS).
 * On utilise createAdminClient() pour les deux par cohérence avec le reste
 * du code, et parce que le SELECT depuis le serveur est plus rapide sans
 * l'overhead du JWT user.
 */
import { createAdminClient } from '@/lib/auth';
import { toJson } from '@/lib/supabase/rpc-json';
import type { HealthIndicator, HealthProviderName } from './types';

const TABLE = 'civic_health_cache';

interface CacheRow {
  code_insee: string;
  payload: HealthIndicator;
  fetched_at: string;
  provider: HealthProviderName;
}

/**
 * Renvoie le payload caché si fetched_at > now() - maxAgeHours.
 * Renvoie null sinon.
 */
export async function getFreshCachedHealth(
  codeInsee: string,
  maxAgeHours = 24,
): Promise<HealthIndicator | null> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .select('code_insee, payload, fetched_at, provider')
    .eq('code_insee', codeInsee)
    .gte('fetched_at', cutoff)
    .maybeSingle<CacheRow>();
  if (error) {
    console.warn('[civic-health/cache] read error', error.message);
    return null;
  }
  return data?.payload ?? null;
}

/**
 * Renvoie le payload caché même périmé (jusqu'à maxAgeHours), avec stale=true.
 * Sert de fallback offline quand le provider échoue.
 */
export async function getStaleCachedHealth(
  codeInsee: string,
  maxAgeHours = 48,
): Promise<HealthIndicator | null> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .select('code_insee, payload, fetched_at, provider')
    .eq('code_insee', codeInsee)
    .gte('fetched_at', cutoff)
    .maybeSingle<CacheRow>();
  if (error) {
    console.warn('[civic-health/cache] stale read error', error.message);
    return null;
  }
  if (!data) return null;
  return { ...data.payload, stale: true };
}

/**
 * Upsert atomique du payload pour un code_insee donné.
 * Les écritures concurrentes pour le même code se résolvent par "last writer wins"
 * (pas critique : la valeur finale convergera après le prochain refresh).
 */
export async function upsertCachedHealth(
  codeInsee: string,
  payload: HealthIndicator,
  provider: HealthProviderName,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from(TABLE)
    .upsert({
      code_insee: codeInsee,
      payload: toJson(payload),
      fetched_at: new Date().toISOString(),
      provider,
    });
  if (error) {
    // Non bloquant : un échec d'écriture cache ne doit pas casser la réponse.
    console.warn('[civic-health/cache] upsert error', error.message);
  }
}
