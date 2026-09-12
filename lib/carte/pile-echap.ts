/**
 * @file lib/carte/pile-echap.ts — un seul Echap, un ordre garanti
 *
 * Quatre listeners keydown concurrents ecoutaient Escape (page.tsx:147,
 * OverlayPanel.tsx:74, MagelianOverlay.tsx:241, ClusterPanel.tsx:243) sans
 * ordre impose : le commentaire de page.tsx:146 assumait une priorite que
 * rien ne garantissait. Ici, dernier ouvert = premier ferme.
 *
 * Round de correction 1 (2026-09-12) : `empiler` faisait `depiler(id)` puis
 * repoussait l'entree — donc RE-empiler un id deja present le faisait
 * remonter au sommet. Or les composants appelants passent une fonction de
 * fermeture dont l'identite change a chaque rendu (`onClose` inline,
 * `handleClose` qui en depend) et re-empilent a chaque effet. Concretement :
 * Assistant ouvert (re-rendu a chaque jeton de streaming), Campagne ouverte
 * par-dessus — a chaque jeton, `'assistant'` repassait au sommet et Echap
 * fermait l'Assistant au lieu de l'overlay reellement au-dessus. Desormais,
 * ré-empiler un id EXISTANT met a jour sa fonction de fermeture SANS changer
 * sa position ; seul un id NOUVEAU part au sommet.
 */
interface Entree { id: string; fermer: () => void; }

const pile: Entree[] = [];

/** Expose la pile pour les tests. Ne pas muter ailleurs. */
export function etatPile(): Entree[] { return pile; }

export function empiler(id: string, fermer: () => void): void {
  const existante = pile.find(e => e.id === id);
  if (existante) {
    existante.fermer = fermer;
    return;
  }
  pile.push({ id, fermer });
}

export function depiler(id: string): void {
  const i = pile.findIndex(e => e.id === id);
  if (i !== -1) pile.splice(i, 1);
}

/** Ferme l'entree la plus haute. Sans effet si la pile est vide. */
export function fermerLePlusHaut(): void {
  const haut = pile.pop();
  haut?.fermer();
}
