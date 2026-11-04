/**
 * @file lib/optimisation/client.ts — le client UNIQUE de Next vers le service d'optimisation Python (tâche 1.6).
 *
 * Plan § 5 : Next reste le point d'entrée authentifié ; le service n'est jamais joint par le navigateur. Ce module
 * est le seul à le joindre :
 * - adresse `OPTIMISATION_URL` (`http://127.0.0.1:8090` en local), clé `OPTIMISATION_CLE_INTERNE` envoyée dans
 *   l'en-tête `X-Optimisation-Cle` (comparée à temps constant côté service) ;
 * - délai par `fetchAvecDelai` (`lib/http/fetch-avec-delai.ts`), AUCUNE reprise : un calcul relancé en aveugle
 *   doublerait la charge d'une base déjà lente au moment où le service ne répond plus ;
 * - réponse VALIDÉE par Zod (`schemas.ts`, typé par l'OpenAPI généré) : une réponse d'une autre forme est une erreur,
 *   jamais une donnée ;
 * - toute défaillance devient une `ErreurOptimisation` au message FRANÇAIS, sans URL ni clé, avec un `motif` stable
 *   pour le journal. Aucun repli silencieux : c'est l'appelant (mode ombre, `ombre.ts`) qui décide qu'une panne ne
 *   doit pas l'interrompre.
 */
import type { z } from 'zod';
import { DelaiDepasseError, fetchAvecDelai } from '@/lib/http/fetch-avec-delai';
import {
  SchemaCatalogueAlgos, SchemaSortiePlanRisque, SchemaSortiePlanZone, SchemaSortieRecaler,
  type CatalogueAlgos, type FamilleAlgo, type EntreePlanRisque, type EntreePlanZone, type EntreeRecaler,
  type SortiePlanRisque, type SortiePlanZone, type SortieRecaler,
} from '@/lib/optimisation/schemas';

/**
 * 30 s : le plan § 5 (« délai 30 s »). Un plan national se calcule en ≈ 1 s (6 075 unités, mesuré le 04/11) ; le
 * service fait attendre un second calcul jusqu'à 30 s avant de répondre 503 (`verrou_calcul`).
 */
export const DELAI_OPTIMISATION_MS = 30_000;

export type MotifErreur =
  | 'configuration' // OPTIMISATION_URL ou OPTIMISATION_CLE_INTERNE absente
  | 'delai' // pas de réponse dans le délai
  | 'reseau' // service injoignable
  | 'refus' // 4xx : entrée refusée (422), clé refusée (401), corps trop gros (413)
  | 'indisponible' // 503 : base illisible ou calcul occupé
  | 'serveur' // autre 5xx
  | 'reponse'; // corps illisible ou d'une autre forme que l'OpenAPI

/** Une défaillance du service, dite en français. `statut` : le code HTTP reçu, s'il y en a eu un. */
export class ErreurOptimisation extends Error {
  constructor(
    message: string,
    public readonly motif: MotifErreur,
    public readonly statut?: number,
    /** Le `detail.refus` du service (`registre`, `validation`, `taille`), pour un 4xx. */
    public readonly refus?: string,
  ) {
    super(message);
    this.name = 'ErreurOptimisation';
  }
}

interface Config { url: string; cle: string }

/** Lit la configuration à CHAQUE appel (les tests changent l'environnement) ; blancs retirés comme côté service. */
function config(): Config {
  const url = process.env.OPTIMISATION_URL?.trim().replace(/\/+$/, '');
  const cle = process.env.OPTIMISATION_CLE_INTERNE?.trim();
  if (!url || !cle) {
    const manque = [!url && 'OPTIMISATION_URL', !cle && 'OPTIMISATION_CLE_INTERNE'].filter(Boolean).join(' et ');
    throw new ErreurOptimisation(`Service d'optimisation non configuré : ${manque} absente.`, 'configuration');
  }
  return { url, cle };
}

/** Le message d'un corps d'erreur du service : `{detail: "phrase"}` ou `{detail: {message, refus?}}`. */
function lireDetail(corps: unknown): { message?: string; refus?: string } {
  if (!corps || typeof corps !== 'object' || !('detail' in corps)) return {};
  const d = (corps as { detail: unknown }).detail;
  if (typeof d === 'string') return { message: d };
  if (d && typeof d === 'object') {
    const o = d as { message?: unknown; refus?: unknown };
    return {
      message: typeof o.message === 'string' ? o.message : undefined,
      refus: typeof o.refus === 'string' ? o.refus : undefined,
    };
  }
  return {};
}

/**
 * POST d'un calcul, réponse validée. Exporté pour les tests ; les appelants passent par les fonctions nommées.
 *
 * @param chemin  route du service (`/v1/plans/zone`…)
 * @param corps   entrée, sérialisée telle quelle
 * @param schema  Zod de la sortie attendue
 * @param delaiMs délai, `DELAI_OPTIMISATION_MS` par défaut
 */
export function appelerOptimisation<T>(
  chemin: string, corps: unknown, schema: z.ZodType<T>, delaiMs: number = DELAI_OPTIMISATION_MS,
): Promise<T> {
  return requeter(chemin, { method: 'POST', body: JSON.stringify(corps) }, schema, delaiMs);
}

/**
 * GET d'une lecture du service (sans corps), réponse validée — mêmes erreurs, même délai, aucune reprise.
 *
 * @param chemin  route du service, paramètres de requête compris (`/v1/algos?famille=correction`)
 */
function lireOptimisation<T>(
  chemin: string, schema: z.ZodType<T>, delaiMs: number = DELAI_OPTIMISATION_MS,
): Promise<T> {
  return requeter(chemin, { method: 'GET' }, schema, delaiMs);
}

async function requeter<T>(
  chemin: string, envoi: { method: 'GET' | 'POST'; body?: string }, schema: z.ZodType<T>, delaiMs: number,
): Promise<T> {
  const { url, cle } = config();
  let reponse: Response;
  try {
    reponse = await fetchAvecDelai(`${url}${chemin}`, {
      method: envoi.method,
      headers: envoi.body === undefined
        ? { 'X-Optimisation-Cle': cle }
        : { 'Content-Type': 'application/json', 'X-Optimisation-Cle': cle },
      ...(envoi.body === undefined ? {} : { body: envoi.body }),
      cache: 'no-store',
    }, delaiMs);
  } catch (e) {
    if (e instanceof DelaiDepasseError) {
      throw new ErreurOptimisation(
        `Le service d'optimisation n'a pas répondu en ${Math.round(delaiMs / 1000)} s.`, 'delai');
    }
    throw new ErreurOptimisation("Le service d'optimisation est injoignable.", 'reseau');
  }

  let lu: unknown;
  try {
    lu = await reponse.json();
  } catch {
    lu = undefined;
  }

  if (!reponse.ok) {
    const { message, refus } = lireDetail(lu);
    const s = reponse.status;
    if (s === 503) {
      throw new ErreurOptimisation(message ?? "Le service d'optimisation est indisponible.", 'indisponible', s);
    }
    if (s === 401) {
      // Jamais la clé dans le message : seulement le fait.
      throw new ErreurOptimisation("Le service d'optimisation a refusé la clé interne.", 'refus', s);
    }
    if (s >= 400 && s < 500) {
      throw new ErreurOptimisation(
        message ?? `Le service d'optimisation a refusé la requête (${s}).`, 'refus', s, refus);
    }
    throw new ErreurOptimisation(
      message ?? `Erreur du service d'optimisation (${s}) : le calcul n'a pas abouti.`, 'serveur', s);
  }

  const valide = schema.safeParse(lu);
  if (!valide.success) {
    const premiere = valide.error.issues[0];
    const ou = premiere?.path.join('.') || 'corps';
    throw new ErreurOptimisation(
      `Réponse du service d'optimisation illisible (${ou} : ${premiere?.message ?? 'forme inattendue'}).`,
      'reponse', reponse.status);
  }
  return valide.data;
}

/** Filtres de `GET /v1/algos` : famille et/ou « proposable à l'écran ⑦ ». */
export interface FiltresAlgos { famille?: FamilleAlgo; proposable?: boolean }

/** `GET /v1/algos` — le catalogue d'algorithmes du service (tâche 2.6), sans lecture en base côté service. */
export function lireCatalogueAlgos(filtres: FiltresAlgos = {}, delaiMs?: number): Promise<CatalogueAlgos> {
  const q = new URLSearchParams();
  if (filtres.famille) q.set('famille', filtres.famille);
  if (filtres.proposable !== undefined) q.set('proposable', String(filtres.proposable));
  const suite = q.toString();
  return lireOptimisation(`/v1/algos${suite ? `?${suite}` : ''}`, SchemaCatalogueAlgos, delaiMs);
}

/** `POST /v1/plans/zone` — plan commun, plans par plateforme, sorties de poids, `algo`. */
export function calculerPlanZone(entree: EntreePlanZone, delaiMs?: number): Promise<SortiePlanZone> {
  return appelerOptimisation('/v1/plans/zone', entree, SchemaSortiePlanZone, delaiMs);
}

/** `POST /v1/plans/risque` — plan d'un jeu risque (`genererPlanCp`, sémantique `repartition`), `algo`. */
export function calculerPlanRisque(entree: EntreePlanRisque, delaiMs?: number): Promise<SortiePlanRisque> {
  return appelerOptimisation('/v1/plans/risque', entree, SchemaSortiePlanRisque, delaiMs);
}

/** `POST /v1/historique/recaler` — recalage amorti v1 → v2 (`recaler`), `Map` en listes de paires. */
export function calculerRecalage(entree: EntreeRecaler, delaiMs?: number): Promise<SortieRecaler> {
  return appelerOptimisation('/v1/historique/recaler', entree, SchemaSortieRecaler, delaiMs);
}
