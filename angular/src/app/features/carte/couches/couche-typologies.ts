import type maplibregl from 'maplibre-gl';
import { avantDe } from '../logique/ordre-couches';

/**
 * ④ Analyse — les POI typés de la zone sur LA carte (④ finitions, T8) : un cercle par POI, dans la teinte de sa
 * typologie (propriété `couleur`, CALCULÉE par `CouleursService` : jamais `var()` dans `paint`), cerné de
 * `--poi-contour` ; au survol d'une ligne du tableau, les POI de cette typologie grossissent (`…-survol`, filtré).
 */
const SOURCE = 'couverture-typologies';
export const COUCHE_TYPOLOGIES = 'couverture-typologies-poi';
export const COUCHE_TYPOLOGIES_SURVOL = 'couverture-typologies-survol';
const AUCUN: maplibregl.FilterSpecification = ['==', ['get', 'cluster_id'], -1];

type CarteTypologies = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'removeLayer' | 'removeSource' | 'setFilter' | 'getStyle'>;

/** Pose (idempotente) ou met à jour la source et les deux couches, à leur rang (`ORDRE_COUCHES`). */
export function poserCoucheTypologies(carte: CarteTypologies, donnees: GeoJSON.FeatureCollection, contour: string): void {
  const source = carte.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (source) source.setData(donnees);
  else carte.addSource(SOURCE, { type: 'geojson', data: donnees });
  if (!carte.getLayer(COUCHE_TYPOLOGIES)) {
    carte.addLayer({
      id: COUCHE_TYPOLOGIES, type: 'circle', source: SOURCE,
      paint: { 'circle-radius': 5, 'circle-color': ['get', 'couleur'], 'circle-stroke-color': contour, 'circle-stroke-width': 1.5 },
    }, avantDe(carte, COUCHE_TYPOLOGIES));
  }
  if (!carte.getLayer(COUCHE_TYPOLOGIES_SURVOL)) {
    carte.addLayer({
      id: COUCHE_TYPOLOGIES_SURVOL, type: 'circle', source: SOURCE, filter: AUCUN,
      paint: { 'circle-radius': 8, 'circle-color': ['get', 'couleur'], 'circle-stroke-color': contour, 'circle-stroke-width': 2.5 },
    }, avantDe(carte, COUCHE_TYPOLOGIES_SURVOL));
  }
}

/** Grossit les POI de la typologie survolée ; `null` n'en grossit aucun. */
export function surlignerTypologie(carte: CarteTypologies, clusterId: number | null): void {
  if (!carte.getLayer(COUCHE_TYPOLOGIES_SURVOL)) return;
  carte.setFilter(COUCHE_TYPOLOGIES_SURVOL, clusterId === null ? AUCUN : ['==', ['get', 'cluster_id'], clusterId]);
}

/** Retire couches et source ; une carte déjà détruite (changement de fond) est ignorée. */
export function retirerCoucheTypologies(carte: CarteTypologies): void {
  try {
    for (const id of [COUCHE_TYPOLOGIES_SURVOL, COUCHE_TYPOLOGIES]) if (carte.getLayer(id)) carte.removeLayer(id);
    if (carte.getSource(SOURCE)) carte.removeSource(SOURCE);
  } catch {
    // Ses couches sont parties avec elle.
  }
}
