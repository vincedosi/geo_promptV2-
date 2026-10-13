/**
 * @file lib/http/fetch-avec-delai.ts
 *
 * Appel HTTP sortant borné dans le temps.
 *
 * ── Pourquoi ce module ──────────────────────────────────────────────────────
 *
 * L'audit du 2026-09-11 (`ECH-002`) a relevé **13 appels vers des tiers sans
 * aucun délai d'expiration** : 11 vers `displayvideo.googleapis.com`
 * (`lib/dsp/dv360/client.ts`), 2 vers `business-api.tiktok.com`
 * (`lib/dsp/tiktok/client.ts`), 1 vers un serverless Python (ML Modal, retiré le
 * 2026-10-12 avec le reste de l'IA).
 *
 * Sur une plateforme serverless, un tiers qui ne répond pas ne rend pas la main :
 * l'invocation reste bloquée jusqu'au délai de la plateforme. Une lenteur de
 * Google bloque un push de ciblage sans que l'utilisateur sache pourquoi.
 *
 * Le savoir-faire existait déjà dans le projet — `lib/isochrones/fetcher.ts` et
 * `lib/civic-health/utils.ts` bornent correctement leurs appels. Ce module ne
 * fait que le rendre disponible ailleurs plutôt que de le réécrire une
 * quatorzième fois.
 *
 * ── Un délai, PAS de reprise. C'est délibéré ────────────────────────────────
 *
 * Il aurait été tentant d'ajouter un rejeu automatique. On ne le fait pas :
 * la plupart de ces appels ne sont **pas idempotents**. Rejouer un
 * `bulkEditAssignedTargetingOptions` sur DV360 ou une création de liste de
 * ciblage peut produire deux fois l'effet. Un rejeu aveugle transformerait un
 * problème de latence en problème de données.
 *
 * Le délai, lui, ne change qu'une chose : un appel qui pendait indéfiniment
 * échoue désormais proprement. Un appel qui réussissait continue de réussir.
 *
 * Là où une reprise est sûre et utile — lectures pures, limitation de débit du
 * tiers — `lib/isochrones/fetcher.ts` montre le patron complet avec attente
 * entre tentatives.
 */

/**
 * Délai par défaut, en millisecondes.
 *
 * 15 s : assez pour les appels DV360 les plus lourds observés (assignation en
 * masse de plusieurs centaines d'identifiants géographiques), et bien en deçà
 * du délai d'une fonction serverless — l'appel doit échouer AVANT la plateforme,
 * sinon on perd le message d'erreur.
 */
export const DELAI_DEFAUT_MS = 15_000;

/** Erreur levée quand le tiers n'a pas répondu dans le temps imparti. */
export class DelaiDepasseError extends Error {
  constructor(public readonly url: string, public readonly delaiMs: number) {
    super(`Pas de réponse de ${url} après ${delaiMs} ms`);
    this.name = 'DelaiDepasseError';
  }
}

/**
 * `fetch` borné dans le temps.
 *
 * Distingue l'expiration des autres échecs réseau : un `AbortError` provoqué
 * par notre propre minuteur devient une `DelaiDepasseError` nommant l'hôte et
 * le délai. Sans cette distinction, le journal dirait seulement « The operation
 * was aborted », ce qui n'aide personne à 3 h du matin.
 *
 * @param url      adresse appelée
 * @param init     options `fetch` habituelles ; un `signal` fourni est respecté
 * @param delaiMs  délai d'expiration, `DELAI_DEFAUT_MS` par défaut
 */
export async function fetchAvecDelai(
  url: string,
  init: RequestInit = {},
  delaiMs: number = DELAI_DEFAUT_MS,
): Promise<Response> {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), delaiMs);

  // Un appelant qui fournit déjà son propre signal garde la main : on annule
  // dès que l'un OU l'autre se déclenche.
  if (init.signal) {
    init.signal.addEventListener('abort', () => controleur.abort(), { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controleur.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError' && !init.signal?.aborted) {
      throw new DelaiDepasseError(url, delaiMs);
    }
    throw e;
  } finally {
    clearTimeout(minuteur);
  }
}
