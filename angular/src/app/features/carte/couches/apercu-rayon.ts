import { type CarteApercu, poserApercu, retirerApercu } from './apercu-forme';

/**
 * L'aperçu du cercle de « Zone par rayon » sur la carte — les trois identifiants et la pose de
 * `CreerZoneRayon.tsx:118-161` (lot 4, T16). Un disque teal translucide et son contour pointillé : c'est le cercle
 * ENTIER, la zone enregistrée n'en gardera que la part terrestre. Pose et retrait communs à l'aperçu de zone
 * (`apercu-forme.ts`, lot 3 du parcours).
 *
 * Couleur passée calculée (`CouleursService`) : MapLibre ne résout pas `var()` dans `paint`.
 */
export const SOURCE_APERCU_RAYON = 'apercu-rayon';
export const REMPLISSAGE_APERCU_RAYON = 'apercu-rayon-fill';
export const CONTOUR_APERCU_RAYON = 'apercu-rayon-line';

const IDS = { source: SOURCE_APERCU_RAYON, remplissage: REMPLISSAGE_APERCU_RAYON, contour: CONTOUR_APERCU_RAYON } as const;

/** Pose (idempotente) ou met à jour l'aperçu, à son rang de React (`avantDe` : sous le tracé libre, sur tout le reste). */
export function poserApercuRayon(carte: CarteApercu, cercle: GeoJSON.Feature, teal: string): void {
  poserApercu(carte, IDS, cercle, teal, 0.12);
}

/** Retire l'aperçu ; une carte déjà détruite (changement de fond) est ignorée. */
export function retirerApercuRayon(carte: CarteApercu): void {
  retirerApercu(carte, IDS);
}
