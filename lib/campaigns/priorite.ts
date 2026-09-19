/**
 * @file lib/campaigns/priorite.ts — ordre de priorité des zones cibles
 * (Tâche 21, 2026-09-13).
 *
 * L'ordre des zones cibles n'est pas décoratif : c'est lui qui décide quelle
 * zone l'emporte quand deux se recouvrent, et donc quel multiplicateur
 * d'enchère s'applique à un code postal partagé. Le réordonnancement doit être
 * exact : perdre ou dupliquer une zone dans la manœuvre change le ciblage
 * poussé au DSP.
 *
 * **Aucune dépendance de glisser-déposer ajoutée** : l'API HTML5 `draggable`
 * suffit pour une liste de quelques lignes, et une bibliothèque de plus dans
 * `/map` se paierait au chargement.
 *
 * Logique PURE, testée sans monter React.
 */

/**
 * Déplace l'élément de la position `de` vers la position `vers`.
 *
 * Rend un NOUVEAU tableau — un réordonnancement qui mute son entrée casserait
 * la détection de changement de React, et la liste ne se redessinerait pas.
 *
 * **Tout index invalide rend le tableau inchangé**, plutôt qu'un tableau
 * amputé ou une exception. Un glisser-déposer relâché au-dessus de la liste
 * donne un index négatif, relâché en dessous un index au-delà de la dernière
 * ligne : les deux sont des gestes ordinaires, pas des erreurs. Ne rien faire
 * est le seul comportement qui ne risque pas de perdre une zone.
 */
export function deplacer<T>(liste: readonly T[], de: number, vers: number): T[] {
  const copie = [...liste];

  if (!Number.isInteger(de) || !Number.isInteger(vers)) return copie;
  if (de < 0 || de >= copie.length) return copie;
  if (vers < 0 || vers >= copie.length) return copie;
  if (de === vers) return copie;

  const [element] = copie.splice(de, 1);
  copie.splice(vers, 0, element);
  return copie;
}
