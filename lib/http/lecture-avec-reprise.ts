/**
 * @file lib/http/lecture-avec-reprise.ts
 *
 * Lecture sortante avec reprise — le complément de `fetchAvecDelai`.
 *
 * ── Pourquoi un second module, et pas une option de plus ───────────────────
 *
 * `fetch-avec-delai.ts` refuse la reprise à dessein : la plupart de ses
 * appelants (DV360, TikTok) ne sont PAS idempotents, et rejouer un
 * push de ciblage peut produire deux fois l'effet. Ce module ne sert QUE les
 * lectures pures, pour lesquelles rejouer est sans conséquence : Open-Meteo,
 * ORS (un isochrone est un calcul, pas une écriture), la BAN, geo.api.gouv.fr,
 * le WFS Atmo. Le choix d'importer l'un ou l'autre EST la déclaration
 * d'idempotence — c'est voulu qu'il faille y penser.
 *
 * ── Ce qu'il corrige (audit du 2026-09-13) ──────────────────────────────────
 *
 * Quatre boucles de reprise recopiées, chacune avec son oubli :
 *   - `app/api/meteo-geo` : `fetch(url)` NU, sans délai — un Open-Meteo muet
 *     figeait le flux NDJSON jusqu'au délai de la plateforme (300 s) ;
 *   - `lib/isochrones/fetcher.ts` : délai posé sur chaque tentative mais une
 *     erreur HTTP non-429 sortait de la boucle sans reprise, un 502 ORS
 *     perdait un lot entier ;
 *   - `lib/import/geocoder.ts` : reprise aveugle sur TOUT échec, y compris un
 *     400 que rejouer ne corrigera jamais ;
 *   - `lib/smart-prompt/geo-resolver.ts` : aucune reprise, aucune lecture de
 *     `Retry-After`.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────
 *
 *   - un délai d'expiration par TENTATIVE (`delaiMs`), via `fetchAvecDelai` ;
 *   - `attente(tentative, cause)` décide s'il faut reprendre et combien de
 *     temps attendre ; `null` arrête net. Par défaut : 429 et 5xx, expiration
 *     et erreur réseau, avec `Retry-After` honoré et plafonné ;
 *   - la DERNIÈRE réponse est rendue telle quelle (corps intact) pour que
 *     l'appelant garde ses propres messages d'erreur ; la dernière EXCEPTION
 *     est relevée telle quelle ;
 *   - une annulation par l'appelant (`init.signal`) ne rejoue jamais.
 */
import { fetchAvecDelai, DelaiDepasseError, DELAI_DEFAUT_MS } from './fetch-avec-delai';

/** Ce qui a fait échouer une tentative. */
export type CauseReprise =
  | { type: 'statut'; reponse: Response }
  | { type: 'delai' }
  | { type: 'reseau'; erreur: Error };

export interface OptionsReprise {
  /** Délai d'expiration de CHAQUE tentative. `DELAI_DEFAUT_MS` par défaut. */
  delaiMs?: number;
  /** Nombre total de tentatives, première comprise. 3 par défaut. */
  tentatives?: number;
  /**
   * Attente avant la tentative suivante, en ms — `null` pour ne pas
   * reprendre. `tentative` vaut 0 pour la première. Peut être asynchrone
   * (lire un corps de réponse pour décider, par exemple).
   */
  attente?: (tentative: number, cause: CauseReprise) => number | null | Promise<number | null>;
  /** Injectable pour les tests. */
  dormir?: (ms: number) => Promise<void>;
}

/** Plafond de l'attente entre deux tentatives : au-delà, l'invocation serverless expirerait avant. */
export const ATTENTE_MAX_MS = 30_000;

const STATUTS_TRANSITOIRES = new Set([429, 502, 503, 504]);

/** Lit `Retry-After` (secondes ou date HTTP). `null` si absent ou illisible. */
function retryAfterMs(reponse: Response): number | null {
  const brut = reponse.headers.get('retry-after');
  if (!brut) return null;
  const secondes = Number(brut);
  if (Number.isFinite(secondes) && secondes >= 0) return secondes * 1_000;
  const date = Date.parse(brut);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * Politique par défaut : reprise sur 429/5xx transitoires, expiration et
 * erreur réseau ; `Retry-After` honoré, sinon 1 s doublée à chaque tentative ;
 * toujours plafonnée à `ATTENTE_MAX_MS`.
 */
export function attenteParDefaut(tentative: number, cause: CauseReprise): number | null {
  if (cause.type === 'statut') {
    if (!STATUTS_TRANSITOIRES.has(cause.reponse.status)) return null;
    const demande = retryAfterMs(cause.reponse);
    if (demande != null) return Math.min(demande, ATTENTE_MAX_MS);
  }
  return Math.min(1_000 * 2 ** tentative, ATTENTE_MAX_MS);
}

const dormirParDefaut = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * `fetch` d'une lecture idempotente, borné dans le temps et repris selon
 * `attente`. Voir l'en-tête du fichier pour le contrat.
 */
export async function fetchLectureAvecReprise(
  url: string,
  init: RequestInit = {},
  options: OptionsReprise = {},
): Promise<Response> {
  const delaiMs = options.delaiMs ?? DELAI_DEFAUT_MS;
  const tentatives = Math.max(1, options.tentatives ?? 3);
  const attente = options.attente ?? attenteParDefaut;
  const dormir = options.dormir ?? dormirParDefaut;

  let derniereReponse: Response | null = null;
  let derniereErreur: unknown = null;

  for (let tentative = 0; tentative < tentatives; tentative++) {
    let cause: CauseReprise;
    try {
      const reponse = await fetchAvecDelai(url, init, delaiMs);
      if (reponse.ok) return reponse;
      derniereReponse = reponse;
      derniereErreur = null;
      cause = { type: 'statut', reponse };
    } catch (e) {
      // Annulé par l'appelant : on ne rejoue pas ce qu'il vient d'abandonner.
      if (init.signal?.aborted) throw e;
      derniereErreur = e;
      derniereReponse = null;
      cause = e instanceof DelaiDepasseError
        ? { type: 'delai' }
        : { type: 'reseau', erreur: e instanceof Error ? e : new Error(String(e)) };
    }

    if (tentative === tentatives - 1) break;
    const ms = await attente(tentative, cause);
    if (ms == null) break;
    if (ms > 0) await dormir(ms);
  }

  if (derniereReponse) return derniereReponse;
  throw derniereErreur;
}
