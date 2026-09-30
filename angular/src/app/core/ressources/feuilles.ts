/** Chargement en cours ou fait, par lien posé — un lien, une promesse. */
const chargements = new WeakMap<HTMLLinkElement, Promise<void>>();

/**
 * Pose une feuille de style dans `<head>`, UNE fois, et attend qu'elle soit
 * appliquée.
 *
 * - Repérée par `attribut` : dix appels (dix navigations, deux cartes) ne
 *   posent qu'un lien et partagent la même promesse.
 * - Résout au `load`, REJETTE au `error` avec un message français qui nomme
 *   le fichier — un « échec de chargement » sans nom ne dit pas quoi chercher.
 * - Un lien en échec est RETIRÉ : l'appel suivant retente au lieu de
 *   ressortir un échec gardé en cache.
 * - Un lien porteur de l'attribut mais posé par quelqu'un d'autre (donc sans
 *   promesse connue) est tenu pour chargé : on ne le double pas.
 */
export function chargerFeuille(doc: Document, attribut: string, href: string): Promise<void> {
  const existant = doc.head.querySelector<HTMLLinkElement>(`link[${attribut}]`);
  if (existant) return chargements.get(existant) ?? Promise.resolve();

  const lien = doc.createElement('link');
  lien.rel = 'stylesheet';
  lien.href = href;
  lien.setAttribute(attribut, '');
  const promesse = new Promise<void>((resoudre, rejeter) => {
    lien.addEventListener('load', () => resoudre(), { once: true });
    lien.addEventListener('error', () => {
      lien.remove();
      rejeter(new Error(`La feuille de style ${nomDeFichier(href)} n'a pas pu être chargée.`));
    }, { once: true });
  });
  chargements.set(lien, promesse);
  doc.head.appendChild(lien);
  return promesse;
}

function nomDeFichier(href: string): string {
  const chemin = href.split(/[?#]/)[0];
  return chemin.slice(chemin.lastIndexOf('/') + 1) || href;
}
