/**
 * Style du contour d'une zone calculée — copie Angular de `lib/carte/nature-zone.ts:41-52`
 * (constantes, puis les statuts de zone et les deux natures — ajoutés avec la couche ICPE de la carte principale, lot 4,
 * tâche 12, corps VERBATIM ; verrouillé par tests/unit/angular/risques-logique-carte-paritaire.test.ts).
 */

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
