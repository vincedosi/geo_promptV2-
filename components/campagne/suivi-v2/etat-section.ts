/**
 * Trois états DISTINCTS pour une section de l'écran de suivi qui charge ses
 * propres données.
 *
 * Constat 15 de la relecture d'interface : un tableau vide (`[]`) servait à la
 * fois d'« état initial », d'« échec silencieux » et de « rien à signaler ».
 * Sur une campagne gravement déréglée dont `/alignement/constats` répond 500,
 * l'écran affichait « Aucun écart notable à ce jour — rien à corriger » : un
 * silence présenté comme une bonne nouvelle, sur l'écran dont le métier est
 * justement d'alerter. Un `[]` ne PEUT pas porter ces trois sens — il faut un
 * état à côté de la donnée, pas à sa place.
 *
 * `'pret'` est le SEUL état qui autorise à conclure quoi que ce soit du
 * contenu de la donnée.
 */
export type EtatSection = 'chargement' | 'echec' | 'pret';
