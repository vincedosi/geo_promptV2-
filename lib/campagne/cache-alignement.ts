'use client';

/**
 * Cache PARTAGÉ (module, pas `useRef`) du score d'alignement d'une campagne
 * — Ruling T15-2 (relecture Tâche 15). `BarreContexteCampagne` (montée à
 * deux endroits sans ancêtre commun : `app/map/page.tsx` en vue carte,
 * `SuiviV2` en vue suivi) et `SuiviV2` lui-même ont tous deux besoin de CE
 * MÊME score (`GET /api/campaigns/[id]/alignement`) — un `useRef` par
 * composant les aurait laissés dupliquer l'appel, constaté à l'écran (3
 * requêtes réseau à `/alignement` à l'ouverture d'un seul écran). CLAUDE.md
 * « cache client `useRef` — vérifier AVANT tout fetch » : l'intention (ne
 * jamais refetcher sans avoir vérifié un cache d'abord) est ici servie par
 * une portée MODULE, seule à survivre entre deux montages indépendants.
 *
 * Le score ne dépend JAMAIS de la maille ni du fil d'Ariane (`ScoreAlignement` :
 * « Toujours calculé au code postal, quelle que soit la maille affichée ») —
 * la clé de cache est donc `campaignId` seul, jamais invalidée par un
 * drill-down.
 *
 * L'appel réseau lui-même passe par `semaphoreEcranSuivi` (Ruling T15-1) —
 * ICI, dans la fonction qui émet réellement la requête, pas dans chaque
 * appelant : un appelant qui oublierait de l'envelopper romprait la garantie
 * de concurrence sans qu'aucun test ne puisse le voir depuis l'extérieur.
 */
import { adminFetch } from '@/lib/admin-fetch';
import { semaphoreEcranSuivi } from './semaphore-suivi';
import type { ReponseAlignement } from '@/components/campagne/suivi-v2/ScoreAlignement';

export interface ResultatAlignement {
  data: ReponseAlignement | null;
  erreurMessage: string | null;
  /**
   * Raison MÉTIER d'un refus de calcul, telle que la route la nomme
   * (`raison` du corps 404 — aujourd'hui `'aucune_donnee'`). `null` pour une
   * panne : 500, réseau, droits.
   *
   * Existe parce qu'une campagne qui n'a pas encore diffusé n'est PAS une
   * panne : la rendre comme telle affiche « Cette campagne n'est pas
   * consultable » sur une campagne créée le matin, qui va très bien. Le
   * message seul ne permet pas de faire la différence sans comparer des
   * phrases françaises — l'écran a besoin du code, pas du texte.
   */
  raison: string | null;
}

const cache = new Map<string, Promise<ResultatAlignement>>();

async function corpsErreur(res: Response): Promise<{ message: string | null; raison: string | null }> {
  try {
    const corps = (await res.json()) as { error?: string; raison?: string };
    return { message: corps?.error ?? null, raison: corps?.raison ?? null };
  } catch {
    return { message: null, raison: null };
  }
}

function demarrer(campaignId: string): Promise<ResultatAlignement> {
  const promesse = (async (): Promise<ResultatAlignement> => {
    const liberer = await semaphoreEcranSuivi.acquerir();
    try {
      const res = await adminFetch(`/api/campaigns/${campaignId}/alignement`, { cache: 'no-store' });
      if (!res.ok) {
        const { message, raison } = await corpsErreur(res);
        return { data: null, erreurMessage: message ?? 'Erreur base de données.', raison };
      }
      return { data: await res.json() as ReponseAlignement, erreurMessage: null, raison: null };
    } catch (e) {
      return { data: null, erreurMessage: e instanceof Error ? e.message : 'Erreur réseau.', raison: null };
    } finally {
      liberer();
    }
  })();
  cache.set(campaignId, promesse);
  // Un ÉCHEC n'est jamais mis en cache durablement. La promesse y entre avant
  // que son issue soit connue — c'est ce qui déduplique les appels en vol —
  // mais un cold start Supabase, un 500 passager ou une coupure réseau
  // laissait sinon « Cette campagne n'est pas consultable pour le moment »
  // pour TOUTE la vie de l'onglet : le cache est de portée module, changer de
  // campagne et revenir ne le purge pas, `invaliderAlignementPartage` n'a
  // aucun appelant et l'écran n'expose pas de bouton « réessayer ». Seul un
  // rechargement complet du navigateur débloquait l'utilisateur.
  //
  // Le cache voisin (`cache-campagnes.ts`) avait déjà la bonne politique — se
  // purger dans un `finally` — et c'est le mauvais des deux qui gardait
  // l'erreur. Ici, on garde la dédup en vol ET on retire l'entrée quand la
  // requête a échoué, pour que la tentative suivante reparte.
  void promesse.then((r) => {
    if (r.erreurMessage !== null && cache.get(campaignId) === promesse) {
      cache.delete(campaignId);
    }
  });
  return promesse;
}

/**
 * Rend la promesse EN VOL si une requête pour cette campagne est déjà
 * partie (le deuxième appelant ne déclenche JAMAIS un second appel réseau),
 * sinon en démarre une et la met en cache.
 */
export function obtenirAlignementPartage(campaignId: string): Promise<ResultatAlignement> {
  const existante = cache.get(campaignId);
  if (existante) return existante;
  return demarrer(campaignId);
}

/** Force un rechargement au prochain appel — inutilisé aujourd'hui (le score
 *  ne se périme pas avec la navigation, et un ÉCHEC se purge désormais tout
 *  seul dans `demarrer`), gardé pour un rafraîchissement volontaire futur
 *  plutôt que de réinventer le cache à ce moment-là. */
export function invaliderAlignementPartage(campaignId: string): void {
  cache.delete(campaignId);
}
