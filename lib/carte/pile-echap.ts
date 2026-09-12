/**
 * @file lib/carte/pile-echap.ts — un seul Echap, un ordre garanti
 *
 * Quatre listeners keydown concurrents ecoutaient Escape (page.tsx:147,
 * OverlayPanel.tsx:74, MagelianOverlay.tsx:241, ClusterPanel.tsx:243) sans
 * ordre impose : le commentaire de page.tsx:146 assumait une priorite que
 * rien ne garantissait. Ici, dernier ouvert = premier ferme.
 */
interface Entree { id: string; fermer: () => void; }

const pile: Entree[] = [];

/** Expose la pile pour les tests. Ne pas muter ailleurs. */
export function etatPile(): Entree[] { return pile; }

export function empiler(id: string, fermer: () => void): void {
  depiler(id);
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
