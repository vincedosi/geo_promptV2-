import { type CarteApercu, poserApercu, retirerApercu } from './apercu-forme';

/**
 * L'aperçu d'une zone à recette (étape ③, lot 3 du parcours) : la forme CALCULÉE par `POST /api/zones/apercu`, en teal
 * translucide (0,15) et contour pointillé `[2, 2]` comme l'aperçu du rayon — une forme calculée, pas encore une zone
 * enregistrée. Rang : à côté de l'aperçu du rayon (`logique/ordre-couches.ts`). Posé par `AtelierZoneService`.
 */
export const SOURCE_APERCU_ZONE = 'apercu-zone';
export const REMPLISSAGE_APERCU_ZONE = 'apercu-zone-fill';
export const CONTOUR_APERCU_ZONE = 'apercu-zone-line';

const IDS = { source: SOURCE_APERCU_ZONE, remplissage: REMPLISSAGE_APERCU_ZONE, contour: CONTOUR_APERCU_ZONE } as const;

/** Pose (idempotente) ou met à jour l'aperçu de la forme. */
export function poserApercuZone(carte: CarteApercu, forme: GeoJSON.Geometry, teal: string): void {
  poserApercu(carte, IDS, forme, teal, 0.15);
}

/** Retire l'aperçu ; une carte déjà détruite (changement de fond) est ignorée. */
export function retirerApercuZone(carte: CarteApercu): void {
  retirerApercu(carte, IDS);
}
