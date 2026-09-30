/**
 * Ferme un panneau ouvert (menu déroulant, tiroir) sur Échap ou sur un appui
 * HORS de ses éléments. Rend la fonction qui retire les écouteurs.
 *
 * ⚠ `composedPath()` et non `event.target` : l'écouteur est posé sur le
 * DOCUMENT, et un événement né dans la racine d'ombre y arrive RECIBLÉ sur
 * l'élément hôte de la racine — `contains(event.target)` répondrait « dehors »
 * pour un clic dans le menu lui-même. Le chemin composé, lui, traverse l'ombre.
 * Le document entier et non la racine : un appui dans le shell AIDA, hors de
 * la remote, doit fermer aussi (comme `document.addEventListener('mousedown')`
 * de `SessionBadge.tsx:33`).
 */
export function ecouterFermeture(
  doc: Document,
  dedans: () => readonly (Element | null | undefined)[],
  fermer: (raison: 'echap' | 'exterieur') => void,
): () => void {
  const appui = (e: Event) => {
    const chemin = e.composedPath();
    if (!dedans().some((el) => !!el && chemin.includes(el))) fermer('exterieur');
  };
  const clavier = (e: KeyboardEvent) => {
    if (e.key === 'Escape') fermer('echap');
  };
  doc.addEventListener('mousedown', appui);
  doc.addEventListener('keydown', clavier);
  return () => {
    doc.removeEventListener('mousedown', appui);
    doc.removeEventListener('keydown', clavier);
  };
}
