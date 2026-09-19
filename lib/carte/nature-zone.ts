/**
 * @file lib/carte/nature-zone.ts
 *
 * LA question que l'utilisateur doit trancher d'un coup d'œil sur la carte
 * des risques industriels : **cette zone, on l'a calculée, ou l'État l'a
 * publiée ?**
 *
 * ── Pourquoi un fichier pour ça ───────────────────────────────────────────
 *
 * Parce que la réponse se lit à quatre endroits — le contour du périmètre
 * PPRT, le contour de la zone calculée, la popup d'un site, la légende — et
 * que ces quatre endroits vivent dans quatre fichiers différents. Tant que la
 * convention n'était écrite nulle part, chacun l'a appliquée à sa façon : le
 * périmètre officiel se dessinait en TIRETÉ et notre cercle calculé en trait
 * PLEIN, soit exactement l'inverse de ce qu'un lecteur de carte attend.
 *
 * ── La convention, et pourquoi elle est dans ce sens ──────────────────────
 *
 *   TRAIT PLEIN    = zone réglementaire, publiée par l'État
 *   TRAIT TIRETÉ   = zone calculée par MAGELIAN, aucune valeur opposable
 *
 * C'est la convention cartographique usuelle : un tracé continu affirme une
 * limite qui fait foi, un tracé discontinu signale une limite approximative,
 * provisoire ou indicative. Une frontière contestée, une courbe de niveau
 * interpolée, un tracé de projet se dessinent en tirets depuis toujours.
 *
 * L'en-tête de `palette-pprt.ts` défendait jusqu'au 2026-09-18 la convention
 * inverse — « c'est le TRAIT qui porte l'autorité : net, tireté, appuyé ».
 * L'intention était juste (distinguer deux objets de nature différente), le
 * sens ne l'était pas : rien ne permettait de deviner lequel des deux était
 * officiel, et un cercle de notre invention se lisait comme une servitude.
 *
 * ── Les quatre statuts ────────────────────────────────────────────────────
 *
 * Ils sont calculés EN BASE (`risques_industriels_carte`, sql/179) et jamais
 * redevinés ici : la couche, la popup et la légende doivent lire la même
 * règle. Ce module ne porte que leur mise en mots.
 */

/** Motif du contour d'une zone que MAGELIAN calcule, en multiples de la largeur du trait. */
export const TIRETE_ZONE_CALCULEE = [2, 2] as const;

/**
 * Largeur du contour d'une zone calculee, en pixels.
 *
 * Plus fine que `LARGEUR_TRAIT_PPRT` (1,5) a dessein : le perimetre
 * reglementaire doit primer visuellement sur un cercle que nous avons
 * choisi. Elle etait ecrite en dur des deux cotes — `line-width: 1` dans la
 * couche, et une bordure CSS dans la legende, qui pouvaient deriver sans
 * que rien ne le signale.
 */
export const LARGEUR_TRAIT_ZONE = 1;

/**
 * Statut de zone d'un site, tel que `risques_industriels_carte` le rend.
 *
 * `sans_pprt` et `non_soumis` sont volontairement DISTINCTS : le premier est
 * une donnée qui manque (seuil haut dont le PPRT n'est pas publié — 137 sites
 * mesurés le 2026-09-18), le second une zone qui n'existe pas en droit (le
 * PPRT ne s'applique qu'au seuil haut). Les réunir sous un « aucune zone »
 * unique ferait passer une règle de droit pour une lacune de notre import.
 */
export type StatutZone = 'pprt' | 'sans_pprt' | 'non_soumis' | 'non_concerne';

export interface DescriptionStatut {
  /** Libellé court, pour une pastille ou une ligne de popup. */
  libelle: string;
  /** La phrase qui explique, affichée sous le libellé. */
  explication: string;
  /** Vrai si le site dispose d'une zone publiée par l'État. */
  reglementaire: boolean;
}

export const STATUT_ZONE: Record<StatutZone, DescriptionStatut> = {
  pprt: {
    libelle: 'Périmètre PPRT',
    explication:
      "Servitude d'utilité publique PM3, opposable en urbanisme. Source : Géoplateforme IGN, déposée par la DDT.",
    reglementaire: true,
  },
  sans_pprt: {
    libelle: 'Aucun périmètre PPRT publié',
    explication:
      "Établissement Seveso seuil haut : un PPRT est attendu, mais aucune servitude n'est publiée à ce jour (plan prescrit non approuvé, ou non déposé au Géoportail de l'Urbanisme).",
    reglementaire: false,
  },
  non_soumis: {
    libelle: 'Non soumis à PPRT',
    explication:
      "Établissement Seveso seuil bas : le PPRT ne s'applique qu'au seuil haut. L'absence de périmètre est la règle, pas une donnée manquante.",
    reglementaire: false,
  },
  non_concerne: {
    libelle: 'Hors champ PPRT',
    explication:
      "Installation classée non Seveso : elle ne relève pas du dispositif PPRT.",
    reglementaire: false,
  },
};

/** Tolère une valeur inconnue venue de la base plutôt que de rendre `undefined`. */
export function descriptionStatut(valeur: string | null | undefined): DescriptionStatut {
  return STATUT_ZONE[(valeur ?? 'non_concerne') as StatutZone] ?? STATUT_ZONE.non_concerne;
}

/**
 * Les deux natures de zone, pour la légende.
 *
 * Exportées plutôt qu'écrites dans le composant : c'est CETTE liste qui est la
 * réponse à « calculée ou réelle ? », et elle ne doit exister qu'une fois.
 */
export const NATURES_ZONE = [
  {
    cle: 'reglementaire' as const,
    libelle: 'Zone réglementaire',
    detail: 'Périmètre PPRT publié par l’État (servitude PM3)',
    trait: 'plein' as const,
  },
  {
    cle: 'calculee' as const,
    libelle: 'Zone calculée',
    detail: 'Rayon indicatif choisi dans le panneau — aucune valeur réglementaire',
    trait: 'tirete' as const,
  },
];
