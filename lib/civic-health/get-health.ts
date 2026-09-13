/**
 * Pipeline partagé de récupération d'un indicateur santé environnementale
 * (air ATMO + pollen) pour une commune : cache fresh (< 24h) → provider →
 * upsert cache → fallback stale (< 48h). Extrait de la route
 * /api/civic-indicators/health/[code_insee].
 *
 * `getHealthEnMasse` est la même chaîne pour N communes, avec le cache lu et
 * écrit PAR LOTS : c'est ce que consomme la carte départementale
 * (/api/civic-indicators/health-map, scale=departement, 104 communes).
 */
import { getProvider } from './provider';
import {
  getCachedHealthMany, getFreshCachedHealth, getStaleCachedHealth,
  upsertCachedHealth, upsertCachedHealthMany,
} from './cache';
import { logger } from '@/lib/logger';
import type { HealthIndicator, HealthProvider, HealthProviderName } from './types';

export interface HealthLookupResult {
  data: HealthIndicator | null;
  provider: HealthProviderName;
}

const FRAICHEUR_H = 24;
const PERIME_H = 48;

export async function getHealthWithCache(codeInsee: string): Promise<HealthLookupResult> {
  const provider = getProvider();

  // 1. Cache fresh (< 24h)
  try {
    const fresh = await getFreshCachedHealth(codeInsee, FRAICHEUR_H);
    if (fresh) return { data: fresh, provider: provider.name };
  } catch (err) {
    logger.warn('civic-health/get-health', 'cache lookup failed', err instanceof Error ? err.message : err);
  }

  // 2. Provider
  let payload: HealthIndicator | null = null;
  try {
    payload = await provider.fetchHealth(codeInsee);
  } catch (err) {
    logger.warn('civic-health/get-health', 'provider error', err instanceof Error ? err.message : err);
  }
  if (payload) {
    upsertCachedHealth(codeInsee, payload, provider.name).catch(err => {
      logger.warn('civic-health/get-health', 'cache upsert failed', err instanceof Error ? err.message : err);
    });
    return { data: payload, provider: provider.name };
  }

  // 3. Fallback stale (< 48h)
  const stale = await getStaleCachedHealth(codeInsee, PERIME_H).catch(() => null);
  return { data: stale, provider: provider.name };
}

export interface OptionsEnMasse {
  /** Appels provider simultanés (tiers externe, pas la base). 3 par défaut. */
  concurrence?: number;
  /** Appelé dès qu'un code est résolu — permet à une route de STREAMER sans attendre la fin. */
  surResultat?: (codeInsee: string, data: HealthIndicator | null) => void;
  /** Injectable pour les tests. */
  provider?: HealthProvider;
}

/**
 * Même chaîne que `getHealthWithCache`, pour N communes, en ≤ 1 + ⌈n/50⌉ + 1
 * requêtes de base au lieu de jusqu'à 3 × n :
 *   1. UNE lecture groupée du cache frais (< 24 h) ;
 *   2. le provider pour les seuls codes manquants, `concurrence` appels à la
 *      fois (c'est un tiers HTTP, pas la base : la limite Nano ne s'applique
 *      pas, celle du tiers si) ;
 *   3. UNE écriture groupée des payloads obtenus (lots de 50) ;
 *   4. UNE lecture groupée du cache périmé (< 48 h) pour les codes que le
 *      provider n'a pas su servir, rendus avec `stale: true`.
 *
 * Rend une Map code → payload (ou null si rien nulle part). Les codes sont
 * dédoublonnés ; l'ordre de `surResultat` n'est pas garanti.
 */
export async function getHealthEnMasse(
  codes: readonly string[],
  options: OptionsEnMasse = {},
): Promise<Map<string, HealthIndicator | null>> {
  const provider = options.provider ?? getProvider();
  const concurrence = Math.max(1, options.concurrence ?? 3);
  const emettre = options.surResultat ?? (() => {});
  const uniques = [...new Set(codes)];
  const resultat = new Map<string, HealthIndicator | null>();

  // 1. Cache frais, groupé
  const frais = await getCachedHealthMany(uniques, FRAICHEUR_H);
  for (const [code, payload] of frais) {
    resultat.set(code, payload);
    emettre(code, payload);
  }

  // 2. Provider sur les manquants, en pool borné
  const manquants = uniques.filter((c) => !frais.has(c));
  const obtenus: { codeInsee: string; payload: HealthIndicator }[] = [];
  const echecs: string[] = [];
  let curseur = 0;
  const ouvrier = async () => {
    while (curseur < manquants.length) {
      const code = manquants[curseur++];
      let payload: HealthIndicator | null = null;
      try {
        payload = await provider.fetchHealth(code);
      } catch (err) {
        logger.warn('civic-health/get-health', `provider ${code} : ${err instanceof Error ? err.message : err}`);
      }
      if (payload) {
        obtenus.push({ codeInsee: code, payload });
        resultat.set(code, payload);
        emettre(code, payload);
      } else {
        echecs.push(code);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrence, manquants.length) }, ouvrier));

  // 3. Écriture groupée — après la boucle, jamais pendant (une seule famille
  //    de requêtes DB à la fois vers Nano)
  if (obtenus.length > 0) {
    await upsertCachedHealthMany(obtenus, provider.name).catch((err) => {
      logger.warn('civic-health/get-health', `upsert groupé : ${err instanceof Error ? err.message : err}`);
    });
  }

  // 4. Repli périmé, groupé, pour les échecs seulement
  if (echecs.length > 0) {
    const perimes = await getCachedHealthMany(echecs, PERIME_H).catch(() => new Map<string, HealthIndicator>());
    for (const code of echecs) {
      const p = perimes.get(code);
      const data = p ? { ...p, stale: true } : null;
      resultat.set(code, data);
      emettre(code, data);
    }
  }

  return resultat;
}
