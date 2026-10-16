/**
 * Plie un texte pour une recherche « sans casse ni accents » : décomposition NFD, diacritiques combinants retirés
 * (U+0300 à U+036F), minuscules, espaces de bord retirés — « Hélène » → « helene ».
 *
 * Seule définition de l'application : « Chercher un jeu » de ② (`features/carte/logique/rangement-jeux.ts`) et le
 * filtre des comptes d'Accès (`features/admin/espaces/logique/comptes.ts`) en portaient chacun une copie identique
 * jusqu'à la revue finale des lots 1-2 du parcours de la carte (2026-10-15).
 */
export function plierTexte(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
