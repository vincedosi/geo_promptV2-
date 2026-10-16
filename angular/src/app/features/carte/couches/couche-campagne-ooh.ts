/**
 * Rendu MapLibre PUR des emplacements d'une campagne OOH (spec 2026-10-16-ooh-campagnes § 6.3) : une source GeoJSON,
 * un calque de cercles coloré PAR LIGNE (`--ligne-media-*`, valeurs calculées), cerne `--poi-contour`, et un calque
 * `symbol` qui pose un ANNEAU POINTILLÉ sur les points à vérifier — un cercle MapLibre n'a pas de trait pointillé.
 * Couche DÉDIÉE (pas la zone partagée de `PoisService`), patron de `couche-zones-custom.ts`. Pose idempotente : une
 * source déjà là reçoit ses données (`setData`), une couche déjà là sa peinture (changement de thème).
 */
import type maplibregl from 'maplibre-gl';
import { avantDe } from '../logique/ordre-couches';

export const SOURCE_CAMPAGNE_OOH = 'campagne-ooh-source';
export const COUCHE_CAMPAGNE_OOH_POINTS = 'campagne-ooh-points';
export const COUCHE_CAMPAGNE_OOH_A_VERIFIER = 'campagne-ooh-a-verifier';
export const IMAGE_ANNEAU_A_VERIFIER = 'campagne-ooh-anneau-pointille';

/** Côté de l'image de l'anneau, en pixels : un cercle de 6 px de rayon et son anneau à 9 px. */
const TAILLE_ANNEAU = 22;
const SEGMENTS_ANNEAU = 16;

type CarteCampagne = Pick<maplibregl.Map,
  'addSource' | 'getSource' | 'addLayer' | 'getLayer' | 'removeLayer' | 'removeSource' | 'setPaintProperty' | 'getStyle'
  | 'hasImage' | 'addImage' | 'removeImage'>;
type CarteEcoute = Pick<maplibregl.Map, 'on' | 'off' | 'getCanvas'>;

/** Les couleurs CALCULÉES : huit teintes de ligne, dans l'ordre des rangs, et le cerne. */
export interface PeintureCampagneOoh {
  lignes: readonly string[];
  contour: string;
}

/** `['match', ['get', 'rang'], 1, c1, …, 8, c8, c1]`. */
export function expressionCouleurLigne(lignes: readonly string[]): maplibregl.ExpressionSpecification {
  return ['match', ['get', 'rang'], ...lignes.flatMap((c, i) => [i + 1, c]), lignes[0]] as unknown as maplibregl.ExpressionSpecification;
}

/** Une couleur CSS calculée (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`) en `[r, g, b, a]` ; lève sur tout autre forme. */
export function couleurEnRgba(couleur: string): [number, number, number, number] {
  const t = couleur.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  throw new Error(`Couleur illisible pour l'anneau pointillé : ${couleur}`);
}

/** L'image d'un anneau pointillé (16 segments, un sur deux plein), pixel par pixel : aucun canevas. */
export function imageAnneauPointille(couleur: string, taille = TAILLE_ANNEAU): { width: number; height: number; data: Uint8Array } {
  const [r, g, b, a] = couleurEnRgba(couleur);
  const data = new Uint8Array(taille * taille * 4);
  const centre = taille / 2;
  const rayon = centre - 2;
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      if (Math.abs(Math.hypot(dx, dy) - rayon) > 1) continue;
      const angle = Math.atan2(dy, dx) + Math.PI;
      if (Math.floor((angle / (2 * Math.PI)) * SEGMENTS_ANNEAU) % 2 === 1) continue;
      const i = (y * taille + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return { width: taille, height: taille, data };
}

/** Pose (ou met à jour) la source, l'image et les deux couches. */
export function poserCoucheCampagneOoh(carte: CarteCampagne, donnees: GeoJSON.FeatureCollection<GeoJSON.Point>, peinture: PeintureCampagneOoh): void {
  const source = carte.getSource(SOURCE_CAMPAGNE_OOH) as maplibregl.GeoJSONSource | undefined;
  if (source) source.setData(donnees);
  else carte.addSource(SOURCE_CAMPAGNE_OOH, { type: 'geojson', data: donnees });
  // Image posée une fois, jamais repeinte au changement de thème : on s'appuie sur `--poi-contour` INVARIANT (#ffffff).
  if (!carte.hasImage(IMAGE_ANNEAU_A_VERIFIER)) carte.addImage(IMAGE_ANNEAU_A_VERIFIER, imageAnneauPointille(peinture.contour));

  const couleur = expressionCouleurLigne(peinture.lignes);
  if (!carte.getLayer(COUCHE_CAMPAGNE_OOH_POINTS)) {
    carte.addLayer({
      id: COUCHE_CAMPAGNE_OOH_POINTS, type: 'circle', source: SOURCE_CAMPAGNE_OOH,
      paint: {
        'circle-color': couleur,
        'circle-radius': 6,
        'circle-opacity': 0.92,
        'circle-stroke-color': peinture.contour,
        'circle-stroke-width': ['case', ['==', ['get', 'qualite'], 'a_verifier'], 0, 1.5],
      },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_CAMPAGNE_OOH_POINTS));
  } else {
    carte.setPaintProperty(COUCHE_CAMPAGNE_OOH_POINTS, 'circle-color', couleur);
    carte.setPaintProperty(COUCHE_CAMPAGNE_OOH_POINTS, 'circle-stroke-color', peinture.contour);
  }
  if (!carte.getLayer(COUCHE_CAMPAGNE_OOH_A_VERIFIER)) {
    carte.addLayer({
      id: COUCHE_CAMPAGNE_OOH_A_VERIFIER, type: 'symbol', source: SOURCE_CAMPAGNE_OOH,
      filter: ['==', ['get', 'qualite'], 'a_verifier'],
      layout: { 'icon-image': IMAGE_ANNEAU_A_VERIFIER, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_CAMPAGNE_OOH_A_VERIFIER));
  }
}

/** Retire les couches PUIS la source (MapLibre lève si une couche l'emploie encore), puis l'image. */
export function retirerCoucheCampagneOoh(carte: CarteCampagne): void {
  if (carte.getLayer(COUCHE_CAMPAGNE_OOH_A_VERIFIER)) carte.removeLayer(COUCHE_CAMPAGNE_OOH_A_VERIFIER);
  if (carte.getLayer(COUCHE_CAMPAGNE_OOH_POINTS)) carte.removeLayer(COUCHE_CAMPAGNE_OOH_POINTS);
  if (carte.getSource(SOURCE_CAMPAGNE_OOH)) carte.removeSource(SOURCE_CAMPAGNE_OOH);
  if (carte.hasImage(IMAGE_ANNEAU_A_VERIFIER)) carte.removeImage(IMAGE_ANNEAU_A_VERIFIER);
}

/** Clic (identifiant du point) et curseur sur les cercles ; rend la fonction qui retire les écoutes. */
export function ecouterCampagneOoh(carte: CarteEcoute, surClic: (id: string) => void): () => void {
  const clic = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
    const id = e.features?.[0]?.properties?.['id'];
    if (typeof id === 'string') surClic(id);
  };
  const entrer = () => { carte.getCanvas().style.cursor = 'pointer'; };
  const sortir = () => { carte.getCanvas().style.cursor = ''; };
  carte.on('click', COUCHE_CAMPAGNE_OOH_POINTS, clic);
  carte.on('mouseenter', COUCHE_CAMPAGNE_OOH_POINTS, entrer);
  carte.on('mouseleave', COUCHE_CAMPAGNE_OOH_POINTS, sortir);
  return () => {
    carte.off('click', COUCHE_CAMPAGNE_OOH_POINTS, clic);
    carte.off('mouseenter', COUCHE_CAMPAGNE_OOH_POINTS, entrer);
    carte.off('mouseleave', COUCHE_CAMPAGNE_OOH_POINTS, sortir);
  };
}
