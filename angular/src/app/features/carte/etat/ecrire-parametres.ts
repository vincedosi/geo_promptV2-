import { untracked } from '@angular/core';
import type { ActivatedRoute, Params, Router } from '@angular/router';

/**
 * Écrit des paramètres de requête de la carte SANS perdre ceux qu'une autre écriture du même tick vient de poser
 * (piège P-g du lot 4).
 *
 * Le défaut corrigé : `queryParamsHandling: 'merge'` fusionne avec `router.currentUrlTree`, l'URL de la DERNIÈRE
 * navigation aboutie. Deux `navigate` dans le même tick : le second annule le premier (`SupersededByNewNavigation`) et
 * repart de l'ancienne URL — le paramètre du premier disparaît, sans erreur. Ici, quand une navigation est EN VOL
 * (`router.currentNavigation()`, posé de façon synchrone par `navigate`), on part de SES paramètres, et l'on remplace
 * l'ensemble (`queryParamsHandling: ''`, nuls retirés) : la navigation qui annule l'autre porte aussi ce qu'elle
 * écrivait. Sans navigation en vol, c'est exactement le `merge` d'avant.
 *
 * Toujours `replaceUrl` (un réglage n'est pas une page de l'historique) et RELATIF (le préfixe du shell est inconnu).
 */
export function ecrireParametres(router: Router, relativeTo: ActivatedRoute, params: Params): void {
  const enVol = untracked(router.currentNavigation);
  if (!enVol) {
    void router.navigate([], { relativeTo, queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
    return;
  }
  const fusion: Params = { ...enVol.extractedUrl.queryParams, ...params };
  for (const cle of Object.keys(fusion)) if (fusion[cle] === null || fusion[cle] === undefined) delete fusion[cle];
  void router.navigate([], { relativeTo, queryParams: fusion, replaceUrl: true });
}
