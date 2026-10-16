/**
 * Le seuil saisi dans un formulaire « Par seuil » de ③ (carreaux et territoires — revue finale du lot 3, X5), lu
 * AVANT conversion : un champ vide n'est pas 0 (`+''` vaut 0 et passait la garde) — il rend `NaN`, que la garde de
 * chaque formulaire refuse. Logique PURE, partagée par les deux formulaires.
 */
export function lireSeuil(texte: string): number {
  const t = texte.trim();
  return t === '' ? Number.NaN : Number(t);
}
