import type maplibregl from 'maplibre-gl';
import { avantDe } from '../logique/ordre-couches';

/**
 * La pose et le retrait d'un APERÇU sur la carte — un remplissage teal translucide et son contour pointillé (`[2, 2]`,
 * la convention d'une forme CALCULÉE, `lib/carte/nature-zone.ts`). Partagés par l'aperçu du rayon (`apercu-rayon.ts`,
 * lot 4) et celui d'une zone à recette (`apercu-zone.ts`, lot 3 du parcours) : seuls les identifiants et l'opacité du
 * remplissage diffèrent.
 *
 * Couleur passée calculée (`CouleursService`) : MapLibre ne résout pas `var()` dans `paint`. Le teal est invariant
 * entre les thèmes (DESIGN_SYSTEM § 3) : une mise à jour ne repeint donc que les données, comme l'aperçu du rayon.
 */
export interface IdsApercu {
  readonly source: string;
  readonly remplissage: string;
  readonly contour: string;
}

export type CarteApercu = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'removeLayer' | 'removeSource' | 'getStyle'>;

/** Pose (idempotente) ou met à jour l'aperçu, à son rang (`avantDe` : sous le tracé libre, sur tout le reste). */
export function poserApercu(
  carte: CarteApercu, ids: IdsApercu, donnees: GeoJSON.Feature | GeoJSON.Geometry, teal: string, opaciteRemplissage: number,
): void {
  const source = carte.getSource(ids.source) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(donnees);
    return;
  }
  carte.addSource(ids.source, { type: 'geojson', data: donnees });
  carte.addLayer({
    id: ids.remplissage, type: 'fill', source: ids.source, paint: { 'fill-color': teal, 'fill-opacity': opaciteRemplissage },
  }, avantDe(carte, ids.remplissage));
  carte.addLayer({
    id: ids.contour, type: 'line', source: ids.source,
    paint: { 'line-color': teal, 'line-width': 1.5, 'line-dasharray': [2, 2] },
  }, avantDe(carte, ids.contour));
}

/** Retire l'aperçu ; une carte déjà détruite (changement de fond) est ignorée. */
export function retirerApercu(carte: CarteApercu, ids: IdsApercu): void {
  try {
    if (carte.getLayer(ids.contour)) carte.removeLayer(ids.contour);
    if (carte.getLayer(ids.remplissage)) carte.removeLayer(ids.remplissage);
    if (carte.getSource(ids.source)) carte.removeSource(ids.source);
  } catch {
    // Ses couches sont parties avec elle.
  }
}
