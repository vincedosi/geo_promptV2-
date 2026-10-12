/**
 * Rendu MapLibre PUR des batailles d'isochrones (lot 4, T17) : sources, couches, visibilité et popups, appelés par
 * `BatailleService`. Séparé du service pour se tester sur une carte factice.
 */
import type maplibregl from 'maplibre-gl';
import { elementTexte } from '../../../carte/contenu-popup';
import { avantDe } from '../logique/ordre-couches';
import { TRAITS_BATAILLE } from '../logique/palettes-donnees-carte';

export const SOURCE_ANNEAUX = 'battle-rings';
export const SOURCE_BORDURES = 'battle-borders';
export const SOURCE_POINTS = 'battle-pois';
export const COUCHE_APLAT = 'battle-fill';
export const COUCHE_TRAIT = 'battle-ring-line';
export const COUCHE_BORDURE = 'battle-cirfa-border';
export const COUCHE_POINTS = 'battle-pois-circle';
export const COUCHE_HALO = 'battle-pois-halo';
/** Du dessous vers le dessus, une fois posées (le halo passe SOUS le point, `useMapInit.ts:1051-1055`). */
export const COUCHES_BATAILLE = [COUCHE_APLAT, COUCHE_TRAIT, COUCHE_BORDURE, COUCHE_HALO, COUCHE_POINTS] as const;

/** La surface de carte que ce fichier emploie (la carte factice des specs la porte aussi). */
type CarteBataille = Pick<maplibregl.Map, 'addSource' | 'addLayer' | 'getSource' | 'getLayer' | 'removeLayer' | 'removeSource'>;

/** Ce que la carte peint d'une bataille : anneaux stylés, bordures CIRFA (après découpe), points des POI. */
export interface RenduBataille {
  anneaux: GeoJSON.Feature[];
  bordures: GeoJSON.Feature[];
  points: GeoJSON.Feature[];
}

const collection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

/** `setData` sur une source existante, sinon création. */
function alimenter(carte: CarteBataille, id: string, features: GeoJSON.Feature[], identifiants: boolean): void {
  const source = carte.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (source) source.setData(collection(features));
  else carte.addSource(id, { type: 'geojson', data: collection(features), ...(identifiants ? { generateId: true } : {}) });
}

/**
 * Pose ou met à jour le rendu d'une bataille — sources `battle-rings` / `battle-borders` / `battle-pois` et leurs cinq
 * couches, aux littéraux de `useMapInit.ts:996-1060` (`TRAITS_BATAILLE`, B12). React créait ces couches cachées au
 * `load` et ne faisait que `setData` ; ici elles naissent au premier rendu, à leur place dans `ORDRE_COUCHES`
 * (`avantDe`), et les rendus suivants ne font que `setData`. Visibilité et filtre : `afficherBataille`.
 */
export function poserBataille(carte: CarteBataille, rendu: RenduBataille, filtre: unknown[]): void {
  const t = TRAITS_BATAILLE;
  const f = filtre as maplibregl.FilterSpecification;
  alimenter(carte, SOURCE_ANNEAUX, rendu.anneaux, true);
  if (!carte.getLayer(COUCHE_APLAT)) {
    carte.addLayer({
      id: COUCHE_APLAT, type: 'fill', source: SOURCE_ANNEAUX, filter: f,
      paint: {
        'fill-color': ['coalesce', ['get', 'battle_color'], t.aplatRepli] as unknown as maplibregl.ExpressionSpecification,
        'fill-opacity': ['coalesce', ['get', 'battle_opacity'], t.opaciteRepli] as unknown as maplibregl.ExpressionSpecification,
      },
    }, avantDe(carte, COUCHE_APLAT));
  }
  if (!carte.getLayer(COUCHE_TRAIT)) {
    carte.addLayer({
      id: COUCHE_TRAIT, type: 'line', source: SOURCE_ANNEAUX, filter: f,
      paint: { 'line-color': t.trait.couleur, 'line-width': t.trait.largeur, 'line-opacity': t.trait.opacite },
    }, avantDe(carte, COUCHE_TRAIT));
  }

  alimenter(carte, SOURCE_BORDURES, rendu.bordures, false);
  if (!carte.getLayer(COUCHE_BORDURE)) {
    carte.addLayer({
      id: COUCHE_BORDURE, type: 'line', source: SOURCE_BORDURES,
      paint: { 'line-color': t.bordure.couleur, 'line-width': t.bordure.largeur, 'line-opacity': t.bordure.opacite },
    }, avantDe(carte, COUCHE_BORDURE));
  }

  alimenter(carte, SOURCE_POINTS, rendu.points, true);
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

/**
 * Visibilité des cinq couches (`useMapLayers.ts:226-238`) et filtre des anneaux (`filtreAnneaux`) — appliqués à
 * chaque bascule sans toucher aux données.
 */
export function afficherBataille(
  carte: Pick<maplibregl.Map, 'getLayer' | 'setLayoutProperty' | 'setFilter'>, visible: boolean, filtre: unknown[],
): void {
  for (const id of COUCHES_BATAILLE) if (carte.getLayer(id)) carte.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  for (const id of [COUCHE_APLAT, COUCHE_TRAIT]) if (carte.getLayer(id)) carte.setFilter(id, filtre as maplibregl.FilterSpecification);
}

/** Retire les cinq couches PUIS les trois sources (MapLibre lève si une couche emploie encore sa source). */
export function retirerBataille(carte: CarteBataille): void {
  for (const id of COUCHES_BATAILLE) if (carte.getLayer(id)) carte.removeLayer(id);
  for (const id of [SOURCE_ANNEAUX, SOURCE_BORDURES, SOURCE_POINTS]) if (carte.getSource(id)) carte.removeSource(id);
}

const texte = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/**
 * La popup d'un anneau ou d'un POI de bataille (`useMapInit.ts:1032-1041,1062-1070`) : nom, adresse, ville, et pour un
 * anneau « ⏱ Anneau N min ». DOM par `elementTexte` (noms et adresses viennent de la base) ; les gris et le vert
 * codés en dur par React deviennent les jetons de texte et `--success`, lisibles dans les deux thèmes.
 */
export function contenuPopupBataille(p: Record<string, unknown>, doc: Document, anneau: boolean): HTMLElement {
  const racine = elementTexte(doc, 'div', { fontFamily: 'sans-serif', fontSize: '12px', lineHeight: '1.6', maxWidth: anneau ? '220px' : '240px' });
  racine.append(
    elementTexte(doc, 'b', { color: 'var(--text-primary)' }, texte(p['nom']) || '—'),
    doc.createElement('br'),
    elementTexte(doc, 'span', { color: 'var(--text-secondary)', fontSize: '11px' }, texte(p['adresse'])),
    elementTexte(doc, 'div', { color: 'var(--text-tertiary)', fontSize: '11px', marginTop: '2px' }, texte(p['ville'])),
  );
  if (anneau) {
    racine.append(elementTexte(doc, 'div', { marginTop: '4px', fontWeight: '600', color: 'var(--success)' }, `⏱ Anneau ${Number(p['palier'] ?? 0)} min`));
  }
  return racine;
}
