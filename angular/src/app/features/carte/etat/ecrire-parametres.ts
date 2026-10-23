import { untracked } from '@angular/core';
import { UrlTree, type ActivatedRoute, type Params, type Router } from '@angular/router';

/**
 * Écrit des paramètres de requête de la carte SANS perdre ceux qu'une autre écriture du même tick vient de poser
 * (piège P-g du lot 4). SEUL écrivain de paramètres de la carte : toute navigation qui fusionne des paramètres passe ici.
 *
 * Le défaut corrigé : `queryParamsHandling: 'merge'` fusionne avec `router.currentUrlTree`, l'URL de la DERNIÈRE
 * navigation aboutie. Deux `navigate` dans le même tick : le second annule le premier (`SupersededByNewNavigation`) et
 * repart de l'ancienne URL — le paramètre du premier disparaît, sans erreur. Ici, quand une navigation est EN VOL
 * (`router.currentNavigation()`, posé de façon synchrone par `navigate`), on part de SES paramètres, nuls retirés, et
 * sur SON arbre d'URL : la navigation qui l'annule porte aussi ce qu'elle écrivait, vers là où elle allait (jamais
 * l'ancien chemin). Sans navigation en vol, c'est exactement le `merge` d'avant.
 *
 * Sans `chemin`, un réglage de la page : `replaceUrl` (pas une entrée d'historique) et RELATIF (le préfixe du shell est
 * inconnu). Avec un `chemin` (ouvrir un module), une vraie page de l'historique, relative à `relativeTo`.
 */
export function ecrireParametres(
  router: Router, relativeTo: ActivatedRoute, params: Params, chemin: readonly string[] = [],
): Promise<boolean> {
  const page = chemin.length === 0;
  const enVol = untracked(router.currentNavigation);
  if (!enVol) {
    return router.navigate([...chemin], { relativeTo, queryParams: params, queryParamsHandling: 'merge', replaceUrl: page });
  }
  const fusion: Params = { ...enVol.extractedUrl.queryParams, ...params };
  for (const cle of Object.keys(fusion)) if (fusion[cle] === null || fusion[cle] === undefined) delete fusion[cle];
  if (!page) return router.navigate([...chemin], { relativeTo, queryParams: fusion });
  return router.navigateByUrl(new UrlTree(enVol.extractedUrl.root, fusion, enVol.extractedUrl.fragment), { replaceUrl: true });
}
