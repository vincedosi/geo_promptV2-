import type maplibregl from 'maplibre-gl';
import { avantDe } from '../logique/ordre-couches';
import { TRAITS_BATAILLE } from '../logique/palettes-donnees-carte';

export const SOURCE_ANNEAUX = 'battle-rings';
export const SOURCE_POINTS = 'battle-pois';
export const COUCHE_APLAT = 'battle-fill';
export const COUCHE_TRAIT = 'battle-ring-line';
export const COUCHE_POINTS = 'battle-pois-circle';
export const COUCHE_HALO = 'battle-pois-halo';
/** Du dessous vers le dessus, une fois posées (le halo passe SOUS le point, `useMapInit.ts:1051-1055`). */
export const COUCHES_BATAILLE = [COUCHE_APLAT, COUCHE_TRAIT, COUCHE_HALO, COUCHE_POINTS] as const;

/** La surface de carte que ce fichier emploie (la carte factice des specs la porte aussi). */
type CarteBataille = Pick<maplibregl.Map, 'addSource' | 'addLayer' | 'getSource' | 'getLayer' | 'removeLayer' | 'removeSource'>;

/** Les entités d'une bordure CIRFA ne sont jamais rendues en aplat (`useMapInit.ts:1004-1005`). */
const SANS_BORDURE = ['!=', ['get', 'feature_type'], 'border'] as unknown as maplibregl.FilterSpecification;

const collection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

/**
 * Pose ou met à jour le rendu d'une bataille — sources `battle-rings` / `battle-pois` et leurs quatre couches, aux
 * littéraux de `useMapInit.ts:996-1060` (`TRAITS_BATAILLE`, B12). React créait ces couches cachées au `load` et ne
 * faisait que `setData` ; ici elles naissent au premier rendu, à leur place dans `ORDRE_COUCHES` (`avantDe`), et les
 * rendus suivants ne font que `setData`. La teinte de chaque anneau est dans ses propriétés (`battle_color`).
 *
 * Pas encore portés (T17) : la source `battle-borders`, le filtre de palier maximum et les popups au clic.
 */
export function poserBataille(carte: CarteBataille, anneaux: GeoJSON.Feature[], points: GeoJSON.Feature[]): void {
  const t = TRAITS_BATAILLE;
  const sourceAnneaux = carte.getSource(SOURCE_ANNEAUX) as maplibregl.GeoJSONSource | undefined;
  if (sourceAnneaux) sourceAnneaux.setData(collection(anneaux));
  else carte.addSource(SOURCE_ANNEAUX, { type: 'geojson', data: collection(anneaux), generateId: true });
  if (!carte.getLayer(COUCHE_APLAT)) {
    carte.addLayer({
      id: COUCHE_APLAT, type: 'fill', source: SOURCE_ANNEAUX, filter: SANS_BORDURE,
      paint: {
        'fill-color': ['coalesce', ['get', 'battle_color'], t.aplatRepli] as unknown as maplibregl.ExpressionSpecification,
        'fill-opacity': ['coalesce', ['get', 'battle_opacity'], t.opaciteRepli] as unknown as maplibregl.ExpressionSpecification,
      },
    }, avantDe(carte, COUCHE_APLAT));
  }
  if (!carte.getLayer(COUCHE_TRAIT)) {
    carte.addLayer({
      id: COUCHE_TRAIT, type: 'line', source: SOURCE_ANNEAUX, filter: SANS_BORDURE,
      paint: { 'line-color': t.trait.couleur, 'line-width': t.trait.largeur, 'line-opacity': t.trait.opacite },
    }, avantDe(carte, COUCHE_TRAIT));
  }

  const sourcePoints = carte.getSource(SOURCE_POINTS) as maplibregl.GeoJSONSource | undefined;
  if (sourcePoints) sourcePoints.setData(collection(points));
  else carte.addSource(SOURCE_POINTS, { type: 'geojson', data: collection(points), generateId: true });
  if (!carte.getLayer(COUCHE_POINTS)) {
    carte.addLayer({
      id: COUCHE_POINTS, type: 'circle', source: SOURCE_POINTS,
      paint: {
        'circle-radius': t.point.rayon, 'circle-color': t.point.couleur, 'circle-stroke-width': t.point.largeurCerne,
        'circle-stroke-color': t.point.cerne, 'circle-opacity': 1, 'circle-pitch-alignment': 'map',
      },
    }, avantDe(carte, COUCHE_POINTS));
  }
  if (!carte.getLayer(COUCHE_HALO)) {
    carte.addLayer({
      id: COUCHE_HALO, type: 'circle', source: SOURCE_POINTS,
      paint: {
        'circle-radius': t.halo.rayon, 'circle-color': t.halo.couleur, 'circle-opacity': t.halo.opacite,
        'circle-blur': t.halo.flou, 'circle-pitch-alignment': 'map',
      },
    }, COUCHE_POINTS);
  }
}

/** Retire les quatre couches PUIS les deux sources (MapLibre lève si une couche emploie encore sa source). */
export function retirerBataille(carte: CarteBataille): void {
  for (const id of COUCHES_BATAILLE) if (carte.getLayer(id)) carte.removeLayer(id);
  for (const id of [SOURCE_ANNEAUX, SOURCE_POINTS]) if (carte.getSource(id)) carte.removeSource(id);
}
