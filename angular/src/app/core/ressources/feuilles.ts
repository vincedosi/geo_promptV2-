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
 * - `@property` réécrites, voir `proprietesEnVariables` ;
 * - `rem` convertis en px, voir `remEnPx`.
 */
export function preparerFeuilleOmbre(css: string): string {
  return remEnPx(proprietesEnVariables(css.replace(/@import[^;]+;/g, '')));
}

/**
 * `rem` renvoie à la taille de police de `<html>` — l'élément du SHELL. Un
 * shell qui la change (`html { font-size: 62.5% }`, courant) redimensionnerait
 * tout MAGELIAN : Tailwind exprime en `rem` espacements, tailles de texte et
 * rayons. Mesuré à la revue de la tâche 8 : un `* { font-size: 20px }` du shell
 * faisait passer le titre de page de 18 à 22,5 px. Chaque `rem` des VALEURS est
 * donc converti en px, base 16 (identique tant que `<html>` reste à 16 px, donc
 * rien ne change en autonome). Seulement devant un séparateur de valeur :
 * un sélecteur échappé (`.p-\[1rem\]`) n'est pas touché.
 */
export function remEnPx(css: string): string {
  return css.replace(/(-?(?:\d+\.?\d*|\.\d+))rem(?=[;}\s),!/])/g, (_, n: string) => `${+(Number(n) * 16).toFixed(4)}px`);
}

/**
 * Chrome ignore `@property` dans une racine d'ombre (mesuré à la tâche 8 :
 * `border-r` y rendait `border-right-style: none`). Tailwind 4 s'y fie pour la
 * valeur initiale ET le non-héritage de ses `--tw-*`. Chaque enregistrement est
 * donc réécrit en déclaration, en couche `properties` (la plus faible) :
 * - `inherits: false` (toutes celles de Tailwind) → posée sur CHAQUE élément
 *   (`*`, `:before`, `:after`, `::backdrop`) : un enfant a sa propre valeur et
 *   ne reçoit jamais celle de son parent — exactement le repli que Tailwind émet
 *   déjà, sous `@supports`, pour les navigateurs sans `@property` ;
 * - `inherits: true` → posée sur `:host` seul, d'où elle descend.
 * Les règles `@property` d'origine sont RETIRÉES : un navigateur qui les
 * honorerait depuis une racine d'ombre les enregistrerait pour TOUT le
 * document, donc pour le shell. La liste vient de la feuille elle-même :
 * s'adapte seule aux utilitaires ajoutés.
 */
export function proprietesEnVariables(css: string): string {
  const locales: string[] = [];
  const heritees: string[] = [];
  const motif = /@property\s+(--[\w-]+)\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(motif)) {
    const initiale = /initial-value\s*:\s*([^;]+)/.exec(m[2]);
    const declaration = `${m[1]}:${initiale ? initiale[1].trim() : 'initial'}`;
    (/inherits\s*:\s*true/.test(m[2]) ? heritees : locales).push(declaration);
  }
  if (!locales.length && !heritees.length) return css;
  const blocs = [
    heritees.length ? `:host{${heritees.join(';')}}` : '',
    locales.length ? `*,:before,:after,::backdrop{${locales.join(';')}}` : '',
  ].join('');
  return `${css.replace(motif, '')}\n@layer properties{${blocs}}`;
}
