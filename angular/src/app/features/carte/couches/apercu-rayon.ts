import type maplibregl from 'maplibre-gl';
import { avantDe } from '../logique/ordre-couches';

/**
 * L'aperçu du cercle de « Zone par rayon » sur la carte — les trois identifiants et la pose de
 * `CreerZoneRayon.tsx:118-161` (lot 4, T16). Un disque teal translucide et son contour pointillé : c'est le cercle
 * ENTIER, la zone enregistrée n'en gardera que la part terrestre.
 *
 * Couleur passée calculée (`CouleursService`) : MapLibre ne résout pas `var()` dans `paint`.
 */
export const SOURCE_APERCU_RAYON = 'apercu-rayon';
export const REMPLISSAGE_APERCU_RAYON = 'apercu-rayon-fill';
export const CONTOUR_APERCU_RAYON = 'apercu-rayon-line';

type CarteApercu = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'removeLayer' | 'removeSource' | 'getStyle'>;

/** Pose (idempotente) ou met à jour l'aperçu, à son rang de React (`avantDe` : sous le tracé libre, sur tout le reste). */
export function poserApercuRayon(carte: CarteApercu, cercle: GeoJSON.Feature, teal: string): void {
  const source = carte.getSource(SOURCE_APERCU_RAYON) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(cercle);
    return;
  }
  carte.addSource(SOURCE_APERCU_RAYON, { type: 'geojson', data: cercle });
  carte.addLayer({ id: REMPLISSAGE_APERCU_RAYON, type: 'fill', source: SOURCE_APERCU_RAYON, paint: { 'fill-color': teal, 'fill-opacity': 0.12 } }, avantDe(carte, REMPLISSAGE_APERCU_RAYON));
  carte.addLayer({
    id: CONTOUR_APERCU_RAYON, type: 'line', source: SOURCE_APERCU_RAYON,
    paint: { 'line-color': teal, 'line-width': 1.5, 'line-dasharray': [2, 2] },
  }, avantDe(carte, CONTOUR_APERCU_RAYON));
}

/** Retire l'aperçu ; une carte déjà détruite (changement de fond) est ignorée. */
export function retirerApercuRayon(carte: CarteApercu): void {
  try {
    if (carte.getLayer(CONTOUR_APERCU_RAYON)) carte.removeLayer(CONTOUR_APERCU_RAYON);
    if (carte.getLayer(REMPLISSAGE_APERCU_RAYON)) carte.removeLayer(REMPLISSAGE_APERCU_RAYON);
    if (carte.getSource(SOURCE_APERCU_RAYON)) carte.removeSource(SOURCE_APERCU_RAYON);
  } catch {
    // Ses couches sont parties avec elle.
  }
}
