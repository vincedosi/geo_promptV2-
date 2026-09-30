/** Chargement en cours ou fait, par lien posé — un lien, une promesse. */
const chargements = new WeakMap<HTMLLinkElement, Promise<void>>();

/**
 * Pose une feuille de style, UNE fois, et attend qu'elle soit appliquée —
 * dans le `<head>` d'un document, ou DANS une racine d'ombre (`mg-carte` y
 * pose `maplibre.css` : une feuille du document n'atteindrait pas la carte).
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
export function chargerFeuille(cible: Document | ShadowRoot, attribut: string, href: string): Promise<void> {
  const doc = estDocument(cible) ? cible : cible.ownerDocument;
  const parent: ParentNode = estDocument(cible) ? cible.head : cible;
  const existant = parent.querySelector<HTMLLinkElement>(`link[${attribut}]`);
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
  parent.appendChild(lien);
  return promesse;
}

function estDocument(cible: Document | ShadowRoot): cible is Document {
  return cible.nodeType === 9; // Node.DOCUMENT_NODE — `instanceof` échoue d'un document à l'autre
}

function nomDeFichier(href: string): string {
  const chemin = href.split(/[?#]/)[0];
  return chemin.slice(chemin.lastIndexOf('/') + 1) || href;
}

/** Lecture de la feuille : `fetch` en vrai, un faux dans les specs. */
export type LireFeuille = (href: string) => Promise<{ ok: boolean; text(): Promise<string> }>;
/** Construction d'une `CSSStyleSheet` (`replace`), résolue contre `href`. */
export type ConstruireFeuille = (texte: string, href: string) => Promise<CSSStyleSheet>;

/**
 * La feuille globale sous forme CONSTRUITE, pour `adoptedStyleSheets` : lue
 * avant que la racine d'ombre n'existe, adoptée par elle de façon synchrone —
 * aucun instant sans style, et rien n'est posé dans le document.
 * Tout échec (réseau, réponse, construction) rejette en NOMMANT le fichier.
 */
export async function chargerFeuilleConstruite(
  href: string, lire: LireFeuille, construire: ConstruireFeuille,
): Promise<CSSStyleSheet> {
  const echec = () => new Error(`La feuille de style ${nomDeFichier(href)} n'a pas pu être chargée.`);
  let texte: string;
  try {
    const reponse = await lire(href);
    if (!reponse.ok) throw echec();
    texte = await reponse.text();
  } catch {
    throw echec();
  }
  try {
    return await construire(preparerFeuilleOmbre(texte), href);
  } catch {
    throw echec();
  }
}

/**
 * Ce qu'il faut changer à une feuille pour qu'elle vive dans une racine
 * d'ombre :
 * - `@import` retirés : `CSSStyleSheet.replace()` les refuse. Les polices, seul
 *   `@import` du projet, sont dans `magelian-polices.css`, posée au niveau du
 *   DOCUMENT (une `@font-face` est ignorée dans une racine d'ombre).
 * - `@property` réécrites, voir `proprietesEnVariables`.
 */
export function preparerFeuilleOmbre(css: string): string {
  return proprietesEnVariables(css.replace(/@import[^;]+;/g, ''));
}

/**
 * Chrome ignore `@property` dans une racine d'ombre (mesuré à la tâche 8 :
 * `border-r` y rendait `border-right-style: none`). Tailwind 4 s'y fie pour la
 * valeur initiale ET le non-héritage de ses `--tw-*`. Chaque enregistrement est
 * donc réécrit en déclaration posée sur CHAQUE élément — exactement le repli
 * que Tailwind émet déjà, sous `@supports`, pour les navigateurs sans
 * `@property` — en couche `properties`, la plus faible. S'adapte seul aux
 * utilitaires ajoutés : la liste vient de la feuille elle-même.
 */
export function proprietesEnVariables(css: string): string {
  const declarations: string[] = [];
  for (const m of css.matchAll(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g)) {
    const initiale = /initial-value\s*:\s*([^;]+)/.exec(m[2]);
    declarations.push(`${m[1]}:${initiale ? initiale[1].trim() : 'initial'}`);
  }
  if (!declarations.length) return css;
  return `${css}\n@layer properties{*,:before,:after,::backdrop{${declarations.join(';')}}}`;
}
