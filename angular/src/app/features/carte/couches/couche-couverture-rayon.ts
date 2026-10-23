import { APERCU_SITES_MAX } from '../../risques/cartes/couches-sites';
import { cercleGeoJSON } from '../../risques/logique/cercle';
import { avantDe } from '../logique/ordre-couches';
import { type CarteApercu, poserApercu, retirerApercu } from './apercu-forme';

/**
 * ④ Analyse — la couverture par rayon sur LA carte (lot 4, T12) : les POI retenus et, au rayon lu sur la courbe, un
 * cercle autour de chacun. Les cercles prennent la pose d'un aperçu (`apercu-forme.ts` : remplissage teal translucide,
 * contour pointillé — une forme CALCULÉE) ; les POI, un cercle teal cerné de `--poi-contour`, sur la même source.
 *
 * Couleurs passées calculées (`CouleursService`) : MapLibre ne résout pas `var()` dans `paint`.
 */
const IDS = { source: 'couverture-rayon', remplissage: 'couverture-rayon-fill', contour: 'couverture-rayon-line' } as const;
export const COUCHE_POI_RAYON = 'couverture-rayon-poi';
export const JETONS_RAYON = { teal: 'brand-teal', contour: 'poi-contour' } as const;
type PaletteRayon = Record<keyof typeof JETONS_RAYON, string>;

/**
 * Les cercles (un MultiPolygon) puis un point par POI. Les cercles sont reconstruits à chaque cran du curseur : bornés
 * aux `APERCU_SITES_MAX` premiers POI, la borne mesurée du module risque ; les points, tous.
 */
export function entitesRayon(poi: readonly (readonly [number, number])[], rayonM: number): GeoJSON.FeatureCollection {
  const cercles: GeoJSON.Feature = {
    type: 'Feature', properties: {},
    geometry: { type: 'MultiPolygon', coordinates: poi.slice(0, APERCU_SITES_MAX).map(([lon, lat]) => cercleGeoJSON(lon, lat, rayonM).geometry.coordinates) },
  };
  const points = poi.map(([lon, lat]): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }));
  return { type: 'FeatureCollection', features: [cercles, ...points] };
}

/** Pose (idempotente) ou met à jour la couche, à son rang (`ORDRE_COUCHES`). */
export function poserCoucheRayon(carte: CarteApercu, donnees: GeoJSON.FeatureCollection, p: PaletteRayon): void {
  poserApercu(carte, IDS, donnees, p.teal, 0.08);
  if (carte.getLayer(COUCHE_POI_RAYON)) return;
  carte.addLayer({
    id: COUCHE_POI_RAYON, type: 'circle', source: IDS.source,
    // Un `circle` sur un polygone peindrait chacun de ses sommets.
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 4, 'circle-color': p.teal, 'circle-stroke-color': p.contour, 'circle-stroke-width': 1.5 },
  }, avantDe(carte, COUCHE_POI_RAYON));
}

/** Retire la couche ; une carte déjà détruite (changement de fond) est ignorée. */
export function retirerCoucheRayon(carte: CarteApercu): void {
  try {
    if (carte.getLayer(COUCHE_POI_RAYON)) carte.removeLayer(COUCHE_POI_RAYON);
  } catch {
    // Ses couches sont parties avec elle.
  }
  retirerApercu(carte, IDS);
}
