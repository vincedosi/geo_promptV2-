/**
 * Les cinq étapes du module « Population à risque industriel ».
 *
 * ── CE QUE CE MODÈLE REMPLACE ─────────────────────────────────────────────
 *
 * Trois onglets — `rayons`, `territoires`, `zones` — qui se lisaient comme des
 * vues alternatives du même écran, alors qu'ils forment un PARCOURS : je
 * choisis mes sites, je règle le rayon, je vérifie la couverture par
 * territoire, j'enregistre un jeu de zones. Le jeu de zones est l'objet final.
 *
 * Un onglet dit « regarde ailleurs » ; une étape dit « voici où tu en es ».
 *
 * ── CE N'EST PAS UN TUNNEL ────────────────────────────────────────────────
 *
 * Chaque étape reste atteignable dans les deux sens, à tout moment. On revient
 * sans arrêt du ③ au ② — c'est même le geste central du module : on lit une
 * couverture, elle ne convient pas, on élargit le rayon. Rien ici ne vérifie
 * qu'une étape est « validée » avant d'autoriser la suivante, et rien ne doit
 * le faire.
 */
import { anneauxDuNiveau, NIVEAUX, type ProfilRayons } from '@/lib/risques/profil';

/**
 * Les cinq étapes, dans l'ordre du parcours. L'ordre EST la numérotation.
 *
 * ⑤ Campagne (2026-09-24) : on fait diffuser une campagne sur le plan d'une
 * extraction du jeu, puis on la recale. C'est la suite naturelle du parcours —
 * le jeu de zones n'est pas l'objet final, ce qu'on en fait diffuser l'est.
 */
export const ETAPES = ['sites', 'rayon', 'couverture', 'zones', 'campagne'] as const;

export type Etape = (typeof ETAPES)[number];

/**
 * Le libellé de chaque étape, tel qu'il s'affiche dans le fil d'Ariane.
 *
 * Un mot chacun, au singulier : le fil doit tenir sur une ligne à côté du reste
 * de l'en-tête, et « Couverture par territoire » y prendrait la place de deux
 * étapes.
 */
export const LIBELLE_ETAPE: Record<Etape, string> = {
  sites: 'Sites',
  rayon: 'Rayon',
  couverture: 'Couverture',
  zones: 'Zones',
  campagne: 'Campagne',
};

/**
 * Ce qu'un ancien lien portait, et l'étape qu'il ouvre aujourd'hui.
 *
 * ⚠ Ces alias ne sont PAS décoratifs. Un lien partagé avant le 2026-09-21
 * porte `onglet=territoires` ; le traiter comme une valeur invalide le
 * renverrait sur la première étape, donc ailleurs que là où son auteur
 * regardait — et sans rien dire. Même raisonnement que l'alias `tab=creation`
 * de l'overlay MAGELIAN.
 *
 * `diffusion` était déjà un alias hérité vers `zones` (onglet retiré le
 * 2026-09-20) : on ne perd pas un alias en en introduisant un autre, sans quoi
 * les liens les plus anciens seraient les premiers cassés.
 */
export const ETAPES_HERITEES: Record<string, Etape> = {
  rayons: 'rayon',
  territoires: 'couverture',
  zones: 'zones',
  diffusion: 'zones',
};

/**
 * Le numéro affiché d'une étape, à partir de 1.
 *
 * Dérivé de l'ordre du tableau et jamais écrit à la main : une étape insérée
 * au milieu renumérote tout le reste toute seule.
 *
 * @param e - L'étape.
 * @returns Son rang, de 1 à 5.
 */
export function rangEtape(e: Etape): number {
  return ETAPES.indexOf(e) + 1;
}

/**
 * Ce dont chaque étape a besoin pour dire qu'elle porte un choix.
 *
 * Volontairement réduit à ce qui décide : le fil d'Ariane ne doit pas se
 * redessiner parce qu'un chargement s'est terminé.
 */
export interface EtatParcours {
  gravites: string[];
  profil: ProfilRayons;
  chemin: string[];
  jeu: string | null;
  /** Une campagne a été simulée sur le jeu ouvert (étape ⑤). */
  simulation?: boolean;
}

/**
 * L'étape porte-t-elle un choix explicite de l'utilisateur ?
 *
 * ── CE QUE LA MARQUE VEUT DIRE, ET CE QU'ELLE NE VEUT PAS DIRE ────────────
 *
 * Elle dit « tu as posé quelque chose ici », jamais « cette étape est
 * validée » : il n'y a rien à valider, et une coche de validation sur un
 * parcours libre laisserait croire qu'on ne peut pas avancer sans elle.
 *
 * ⚠ L'étape ③ Couverture est une LECTURE, pas un réglage : elle n'a pas de
 * choix propre à porter, sauf celui du territoire qu'on est allé regarder. La
 * marquer sur l'existence d'un résultat aurait fait clignoter le fil d'Ariane
 * à chaque recalcul, et surtout : un résultat arrive tout seul, ce n'est pas
 * un choix.
 *
 * @param etape - L'étape à qualifier.
 * @param e - L'état du parcours.
 * @returns `true` si l'utilisateur y a posé un choix.
 */
export function etapeRenseignee(etape: Etape, e: EtatParcours): boolean {
  switch (etape) {
    // Au moins un régime retenu. À zéro, aucun site n'entre dans le calcul et
    // tout l'écran est vide — l'étape n'est alors pas « renseignée », elle est
    // vidée.
    case 'sites':
      return e.gravites.length > 0;
    // Au moins un anneau, sur n'importe quel niveau. Sans anneau, aucun carreau
    // n'est classé : `hors_zone` vaut la France entière, ce qui est l'inverse
    // de « personne n'est exposé ».
    case 'rayon':
      return NIVEAUX.some((n) => anneauxDuNiveau(e.profil, n).length > 0);
    case 'couverture':
      return e.chemin.length > 0;
    // Un jeu ENREGISTRÉ, pas un brouillon : c'est l'objet que le module produit,
    // et le seul qui survive à la fermeture de l'écran.
    case 'zones':
      return e.jeu !== null;
    // Une campagne simulée : c'est le seul geste de l'étape, et il écrit en base.
    case 'campagne':
      return e.simulation === true;
  }
}
