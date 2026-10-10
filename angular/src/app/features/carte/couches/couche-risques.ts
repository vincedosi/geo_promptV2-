import type maplibregl from 'maplibre-gl';
import type { CollectionSitesRisque } from '../../risques/data/sites-risque.api';
import { LARGEUR_TRAIT_ZONE, TIRETE_ZONE_CALCULEE } from '../../risques/logique/nature-zone';
import { LARGEUR_TRAIT_PPRT } from '../logique/pprt';
import { JETON_TYPE } from '../logique/types-risque';

/**
 * Les couches MapLibre des sites ICPE et des périmètres PPRT de la carte principale — fonctions PURES, portage du
 * rendu de `app/map/_components/RisqueIndustrielLayer.tsx` et `PprtLayer.tsx` (lot 4, T12).
 *
 * ⚠ Jamais `var()` dans `paint` (`addLayer` LÈVE, la couche n'existe pas, et le compte « N sites » resterait juste) :
 * les teintes arrivent RÉSOLUES par `CouleursService`. Les popups (DOM, où `var(--x)` est résolu) vivent à part, dans
 * `popups-risques.ts`.
 */

export const SOURCE_RISQUES_POINTS = 'risques-industriels-src';
export const SOURCE_RISQUES_ZONES = 'risques-industriels-zones-src';
export const COUCHE_RISQUES_ZONE = 'risques-zone';
export const COUCHE_RISQUES_ZONE_CONTOUR = 'risques-zone-contour';
export const COUCHE_RISQUES_HALO = 'risques-halo';
export const COUCHE_RISQUES_POINT = 'risques-point';

export const SOURCE_PPRT = 'pprt-perimetres';
export const COUCHE_PPRT_FOND = 'pprt-fond';
export const COUCHE_PPRT_CONTOUR = 'pprt-contour';

/** Littéraux de `RisqueIndustrielLayer.tsx:349-393`, verrouillés par `tests/unit/angular/carte-couches-paritaire.test.ts`. */
export const OPACITE_ZONE_RISQUE = 0.18;
export const OPACITE_CONTOUR_ZONE_RISQUE = 0.7;
export const RAYON_HALO_RISQUE = ['interpolate', ['linear'], ['zoom'], 4, 6, 8, 14, 12, 26] as const;
export const FLOU_HALO_RISQUE = 1;
export const OPACITE_HALO_RISQUE = 0.35;
export const RAYON_POINT_RISQUE = ['interpolate', ['linear'], ['zoom'], 4, 3, 8, 5, 12, 7] as const;
export const TRAIT_POINT_RISQUE = 1;

/** Les jetons lus par `CouleursService` : un par type de risque, et le cerne du point (INVERSÉ entre thèmes). */
export const JETONS_RISQUES = { ...JETON_TYPE, contour: 'contour-point' } as const;
export type TeintesRisques = Record<keyof typeof JETONS_RISQUES, string>;

/** `expressionCouleurRisque(theme)` (`palette-risques.ts:188-199`), teintes résolues. */
export function expressionCouleurRisque(t: TeintesRisques): unknown[] {
  return [
    'match', ['get', 'type_risque'],
    'toxique', t.toxique,
    'inflammable', t.inflammable,
    'pollution', t.pollution,
    'autres', t.autres,
    t.non_precise,
  ];
}

const VIDE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

type CarteCouches = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'setPaintProperty'>;

/** Les zones calculées : un jeu SÉPARÉ de polygones, pour que le point reste un point (`RisqueIndustrielLayer.tsx:318-327`). */
export function zonesDesSites(charge: CollectionSitesRisque): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: charge.features
      .filter((f) => f.properties['zone'])
      .map((f) => ({
        type: 'Feature' as const,
        geometry: f.properties['zone'] as GeoJSON.Geometry,
        properties: { type_risque: f.properties['type_risque'], id: f.properties['id'] },
      })),
  };
}

/**
 * Sources et couches des sites, IDEMPOTENT (`getSource`/`getLayer` sur l'instance), au SOMMET comme React (aucun
 * `beforeId` : ces couches naissent après le chargement de la carte, hors de `ORDRE_COUCHES`) : zone, contour tireté,
 * halo, point.
 */
export function poserCouchesRisques(carte: CarteCouches, t: TeintesRisques): void {
  const couleur = expressionCouleurRisque(t) as maplibregl.ExpressionSpecification;
  if (!carte.getSource(SOURCE_RISQUES_ZONES)) carte.addSource(SOURCE_RISQUES_ZONES, { type: 'geojson', data: VIDE });
  if (!carte.getSource(SOURCE_RISQUES_POINTS)) carte.addSource(SOURCE_RISQUES_POINTS, { type: 'geojson', data: VIDE });
  if (!carte.getLayer(COUCHE_RISQUES_ZONE)) {
    carte.addLayer({
      id: COUCHE_RISQUES_ZONE, type: 'fill', source: SOURCE_RISQUES_ZONES,
      paint: { 'fill-color': couleur, 'fill-opacity': OPACITE_ZONE_RISQUE },
    });
    carte.addLayer({
      id: COUCHE_RISQUES_ZONE_CONTOUR, type: 'line', source: SOURCE_RISQUES_ZONES,
      paint: {
        'line-color': couleur,
        // TIRETÉ et fin : cette zone est CALCULÉE par nous (`nature-zone.ts`) ; le périmètre PPRT est plein et plus épais.
        'line-width': LARGEUR_TRAIT_ZONE,
        'line-opacity': OPACITE_CONTOUR_ZONE_RISQUE,
        'line-dasharray': [...TIRETE_ZONE_CALCULEE],
      },
    });
  }
  if (!carte.getLayer(COUCHE_RISQUES_HALO)) {
    carte.addLayer({
      id: COUCHE_RISQUES_HALO, type: 'circle', source: SOURCE_RISQUES_POINTS,
      paint: {
        'circle-color': couleur,
        // Rayon en PIXELS : une aide de lecture, pas une mesure (la mesure, c'est la zone).
        'circle-radius': [...RAYON_HALO_RISQUE] as unknown as maplibregl.ExpressionSpecification,
        'circle-blur': FLOU_HALO_RISQUE,
        'circle-opacity': OPACITE_HALO_RISQUE,
      },
    });
  }
  if (!carte.getLayer(COUCHE_RISQUES_POINT)) {
    carte.addLayer({
      id: COUCHE_RISQUES_POINT, type: 'circle', source: SOURCE_RISQUES_POINTS,
      paint: {
        'circle-color': couleur,
        'circle-radius': [...RAYON_POINT_RISQUE] as unknown as maplibregl.ExpressionSpecification,
        'circle-stroke-width': TRAIT_POINT_RISQUE,
        'circle-stroke-color': t.contour,
      },
    });
  }
}

/** Bascule de thème : les quatre couleurs et le cerne REPEINTS, sans recréer ni source ni couche, ni relire. */
export function repeindreCouchesRisques(carte: CarteCouches, t: TeintesRisques): void {
  const couleur = expressionCouleurRisque(t);
  const peindre = (id: string, propriete: string, valeur: unknown) => {
    if (carte.getLayer(id)) carte.setPaintProperty(id, propriete, valeur);
  };
  peindre(COUCHE_RISQUES_ZONE, 'fill-color', couleur);
  peindre(COUCHE_RISQUES_ZONE_CONTOUR, 'line-color', couleur);
  peindre(COUCHE_RISQUES_HALO, 'circle-color', couleur);
  peindre(COUCHE_RISQUES_POINT, 'circle-color', couleur);
  peindre(COUCHE_RISQUES_POINT, 'circle-stroke-color', t.contour);
}

/** Retrait dans l'ordre inverse de l'ajout (`RisqueIndustrielLayer.tsx:228-239`). */
export function retirerCouchesRisques(carte: Pick<maplibregl.Map, 'getLayer' | 'removeLayer' | 'getSource' | 'removeSource'>): void {
  for (const id of [COUCHE_RISQUES_POINT, COUCHE_RISQUES_HALO, COUCHE_RISQUES_ZONE_CONTOUR, COUCHE_RISQUES_ZONE]) {
    if (carte.getLayer(id)) carte.removeLayer(id);
  }
  for (const s of [SOURCE_RISQUES_POINTS, SOURCE_RISQUES_ZONES]) if (carte.getSource(s)) carte.removeSource(s);
}

/** Les teintes du périmètre PPRT (`--pprt-contour`, `--pprt-fond`) : ACHROMATIQUES, le trait porte l'autorité. */
export interface TeintesPprt {
  contour: string;
  fond: string;
}

/** `line-width` du périmètre (`PprtLayer.tsx:190-200`) : plein, et le plus épais des deux traits. */
export const LARGEUR_CONTOUR_PPRT = [
  'interpolate', ['linear'], ['zoom'],
  8, LARGEUR_TRAIT_PPRT * 0.8,
  12, LARGEUR_TRAIT_PPRT,
  16, LARGEUR_TRAIT_PPRT * 1.4,
] as const;

/** Source et couches des périmètres, IDEMPOTENT, au sommet (`PprtLayer.tsx:161-203`). */
export function poserCouchesPprt(carte: CarteCouches, t: TeintesPprt): void {
  if (!carte.getSource(SOURCE_PPRT)) carte.addSource(SOURCE_PPRT, { type: 'geojson', data: VIDE });
  if (!carte.getLayer(COUCHE_PPRT_FOND)) {
    carte.addLayer({
      id: COUCHE_PPRT_FOND, type: 'fill', source: SOURCE_PPRT,
      // Le fond n'est presque pas visible : il sert surtout de cible de clic.
      paint: { 'fill-color': t.fond, 'fill-opacity': 1 },
    });
  }
  if (!carte.getLayer(COUCHE_PPRT_CONTOUR)) {
    carte.addLayer({
      id: COUCHE_PPRT_CONTOUR, type: 'line', source: SOURCE_PPRT,
      paint: {
        'line-color': t.contour,
        'line-width': [...LARGEUR_CONTOUR_PPRT] as unknown as maplibregl.ExpressionSpecification,
      },
    });
  }
}

export function repeindreCouchesPprt(carte: CarteCouches, t: TeintesPprt): void {
  if (carte.getLayer(COUCHE_PPRT_FOND)) carte.setPaintProperty(COUCHE_PPRT_FOND, 'fill-color', t.fond);
  if (carte.getLayer(COUCHE_PPRT_CONTOUR)) carte.setPaintProperty(COUCHE_PPRT_CONTOUR, 'line-color', t.contour);
}

export function retirerCouchesPprt(carte: Pick<maplibregl.Map, 'getLayer' | 'removeLayer' | 'getSource' | 'removeSource'>): void {
  for (const id of [COUCHE_PPRT_CONTOUR, COUCHE_PPRT_FOND]) if (carte.getLayer(id)) carte.removeLayer(id);
  if (carte.getSource(SOURCE_PPRT)) carte.removeSource(SOURCE_PPRT);
}
