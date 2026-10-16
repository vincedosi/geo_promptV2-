import { type Injector, afterNextRender, effect, untracked } from '@angular/core';

/**
 * Le RETOUR DU FOCUS sur l'hôte de la carte (extrait de `CartePage`, revue finale des lots 1-2 du parcours).
 *
 * La page n'a qu'un écouteur clavier, sur son hôte (arbitrage B10) : un élément qui portait le focus et se retire, ou
 * devient inerte, le laisserait sur `<body>` du document — Alt+1..8 et Échap ne répondraient plus. Aucun écouteur
 * `window`/`document` ici (ceux du shell AIDA) : seulement des `effect` liés à l'injecteur de la page et un
 * `afterNextRender`, qui vivent et meurent avec elle.
 */

/** L'élément focalisé, lu dans la racine qui porte la page (`document.activeElement` y serait l'hôte d'ombre). */
export function elementActif(hote: HTMLElement): Element | null {
  return (hote.getRootNode() as Document | ShadowRoot).activeElement;
}

/**
 * Rend le focus à l'hôte s'il n'est plus nulle part dans la page (élément retiré pendant qu'il le portait), ou s'il
 * est resté sur un élément devenu inatteignable : dans l'étape quittée (`inert`) ou dans le panneau caché.
 */
export function rendreFocus(hote: HTMLElement): void {
  const actif = elementActif(hote);
  const cache = !!actif && actif !== hote && (actif.closest('[inert]') !== null || getComputedStyle(actif).visibility === 'hidden');
  if (!actif || !hote.contains(actif) || cache) hote.focus({ preventScroll: true });
}

/** À chaque passage de `ouvert` de vrai à faux, le focus revient à l'hôte s'il n'est plus dans la page. */
export function rendreFocusALaFermeture(hote: HTMLElement, injecteur: Injector, ouvert: () => boolean): void {
  let etaitOuvert = false;
  effect(() => {
    const o = ouvert();
    if (etaitOuvert && !o) afterNextRender(() => rendreFocus(hote), { injector: injecteur });
    etaitOuvert = o;
  }, { injector: injecteur });
}

/**
 * Le focus sur l'hôte à l'ouverture (sans lui, aucun raccourci ne l'atteint avant le premier clic), puis après chaque
 * geste qui CACHE ce qui le portait — `gestes` lit les signaux de ces gestes (étape quittée devenue inerte, panneau
 * replié, barre de l'immersif disparue). Seulement si le focus était DANS la page au moment du geste (relevé avant le
 * rendu) : un `?etape=` écrit de l'extérieur pendant que le focus est dans le shell AIDA ne le lui vole pas (relecture
 * T4, m3).
 */
export function rendreFocusApresGeste(hote: HTMLElement, injecteur: Injector, gestes: () => void): void {
  let ouverture = true;
  effect(() => {
    gestes();
    const actif = untracked(() => elementActif(hote));
    const dansLaPage = ouverture || (!!actif && hote.contains(actif));
    ouverture = false;
    if (dansLaPage) afterNextRender(() => rendreFocus(hote), { injector: injecteur });
  }, { injector: injecteur });
}
