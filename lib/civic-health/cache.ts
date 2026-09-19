/**
 * Cache Supabase pour les indicateurs civiques de santé.
 *
 * Lecture : SELECT (RLS public). Écriture : service role (bypass RLS).
 * On utilise createAdminClient() pour les deux par cohérence avec le reste
 * du code, et parce que le SELECT depuis le serveur est plus rapide sans
 * l'overhead du JWT user.
 *
 * Deux jeux d'accès : unitaire (fiche d'une commune) et **groupé** (carte
 * départementale, 104 communes). Le groupé existe parce que la carte faisait
 * une lecture PAR commune — 104 requêtes, plus une écriture par commune en
 * cache froid, soit jusqu'à 312 allers-retours vers un Nano à 250 IOPS pour
 * peindre 104 polygones. Il en fait désormais 1 + ⌈n/50⌉ + 1 au pire.
 */
import { createAdminClient } from '@/lib/auth';
import { toJson } from '@/lib/supabase/rpc-json';
import { logger } from '@/lib/logger';
import type { HealthIndicator, HealthProviderName } from './types';

const TABLE = 'civic_health_cache';
/** Taille d'un `.in()` : 5 chars par code + encodage, loin de la limite d'URL de 16 kB. */
const TAILLE_LOT_LECTURE = 200;
/** Règle projet : 50 lignes par requête d'écriture au plus (CLAUDE.md). */
const TAILLE_LOT_ECRITURE = 50;

interface CacheRow {
  code_insee: string;
  payload: HealthIndicator;
  fetched_at: string;
  provider: HealthProviderName;
}

function cutoffIso(maxAgeHours: number): string {
  return new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
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
  const { data, error } = await supabase
    .from(TABLE)
    .select('code_insee, payload, fetched_at, provider')
    .eq('code_insee', codeInsee)
    .gte('fetched_at', cutoffIso(maxAgeHours))
    .maybeSingle<CacheRow>();
  if (error) {
    logger.warn('civic-health/cache', `lecture : ${error.message}`);
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
  const { data, error } = await supabase
    .from(TABLE)
    .select('code_insee, payload, fetched_at, provider')
    .eq('code_insee', codeInsee)
    .gte('fetched_at', cutoffIso(maxAgeHours))
    .maybeSingle<CacheRow>();
  if (error) {
    logger.warn('civic-health/cache', `lecture périmée : ${error.message}`);
    return null;
  }
  if (!data) return null;
  return { ...data.payload, stale: true };
}

/**
 * Lecture GROUPÉE : les payloads de plusieurs communes en une requête par lot
 * de 200 codes. Rend une Map code → payload ; les codes absents ou trop vieux
 * n'y figurent pas. Une erreur de base rend une Map vide (l'appelant retombe
 * sur le provider), jamais une exception.
 */
export async function getCachedHealthMany(
  codes: readonly string[],
  maxAgeHours: number,
): Promise<Map<string, HealthIndicator>> {
  const out = new Map<string, HealthIndicator>();
  if (codes.length === 0) return out;
  const supabase = createAdminClient();
  const cutoff = cutoffIso(maxAgeHours);
  for (let i = 0; i < codes.length; i += TAILLE_LOT_LECTURE) {
    const lot = codes.slice(i, i + TAILLE_LOT_LECTURE);
    const { data, error } = await supabase
      .from(TABLE)
      .select('code_insee, payload, fetched_at, provider')
      .in('code_insee', lot)
      .gte('fetched_at', cutoff)
      .returns<CacheRow[]>();
    if (error) {
      logger.warn('civic-health/cache', `lecture groupée : ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      if (row.payload) out.set(row.code_insee, row.payload);
    }
  }
  return out;
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
  await upsertCachedHealthMany([{ codeInsee, payload }], provider);
}

/**
 * Upsert GROUPÉ, par lots de 50 (règle projet). Non bloquant : un échec
 * d'écriture est journalisé, jamais relevé — la réponse est déjà connue.
 */
export async function upsertCachedHealthMany(
  entrees: ReadonlyArray<{ codeInsee: string; payload: HealthIndicator }>,
  provider: HealthProviderName,
): Promise<void> {
  if (entrees.length === 0) return;
  const supabase = createAdminClient();
  const fetchedAt = new Date().toISOString();
  for (let i = 0; i < entrees.length; i += TAILLE_LOT_ECRITURE) {
    const lot = entrees.slice(i, i + TAILLE_LOT_ECRITURE).map((e) => ({
      code_insee: e.codeInsee,
      payload: toJson(e.payload),
      fetched_at: fetchedAt,
      provider,
    }));
    const { error } = await supabase.from(TABLE).upsert(lot, { onConflict: 'code_insee' });
    if (error) logger.warn('civic-health/cache', `upsert (${lot.length} lignes) : ${error.message}`);
  }
}
