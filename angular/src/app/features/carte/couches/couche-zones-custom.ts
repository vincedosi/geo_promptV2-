import type maplibregl from 'maplibre-gl';
import { avantDe } from '../logique/ordre-couches';
import { RENDU_ZONE } from '../logique/palettes-donnees-carte';
import { idsZone } from '../logique/zones/zones-affichees';

/** La surface de carte que ce fichier emploie (la carte factice des specs la porte aussi). */
type CarteZones = Pick<maplibregl.Map, 'addSource' | 'addLayer' | 'getSource' | 'getLayer' | 'removeLayer' | 'removeSource' | 'getStyle'>;

/**
 * Pose UNE zone enregistrée : sa source GeoJSON et ses deux couches, aplat 25 % et contour 2,5 px dans la teinte de la
 * zone (`ZonesOverlay.tsx:216-240`). Au sommet du groupe des zones enregistrées, comme React au moment du clic, mais
 * SOUS l'aperçu du rayon et le tracé libre, et AU-DESSUS de toute couche de données même allumée après (`avantDe`,
 * revue finale I-1). Idempotent :
 * une zone déjà posée sur cette instance n'est pas reposée.
 *
 * La teinte est une donnée de `PALETTE_ZONES` (B12), la même dans les deux thèmes : aucune repeinture au thème.
 */
export function poserZoneCustom(carte: CarteZones, id: string, entite: GeoJSON.Feature, couleur: string): void {
  const ids = idsZone(id);
  if (carte.getSource(ids.source)) return;
  carte.addSource(ids.source, { type: 'geojson', data: entite });
  carte.addLayer({ id: ids.aplat, type: 'fill', source: ids.source, paint: { 'fill-color': couleur, 'fill-opacity': RENDU_ZONE.opaciteAplat } }, avantDe(carte, ids.aplat));
  carte.addLayer({ id: ids.contour, type: 'line', source: ids.source, paint: { 'line-color': couleur, 'line-width': RENDU_ZONE.largeurContour } }, avantDe(carte, ids.contour));
}

/** Retire une zone : ses deux couches PUIS sa source (MapLibre lève si une couche l'emploie encore). */
export function retirerZoneCustom(carte: CarteZones, id: string): void {
  const ids = idsZone(id);
  if (carte.getLayer(ids.aplat)) carte.removeLayer(ids.aplat);
  if (carte.getLayer(ids.contour)) carte.removeLayer(ids.contour);
  if (carte.getSource(ids.source)) carte.removeSource(ids.source);
}
