/**
 * Logique PURE du lien `?customZone=<id>` — portage de `app/map/page.tsx:771-839` (lot 4, T14).
 *
 * La zone ouverte par le lien alimente le CRÉNEAU DE BATAILLE, pour que les analyses (corrélation, capture) la
 * traitent exactement comme une bataille d'isochrones : un groupe unique, palier 1, un « POI » au centre de son
 * emprise, une clé de cache `cg__<id>`. C'est cette clé qui fait apparaître le bouton « Script bidding DV360 ».
 */
import type { PoiBataille } from '../bataille/anneaux';
import { type Bbox, bboxDeGeometrie } from './zones-affichees';

/** Le paramètre de requête du lien (`searchParams.get('customZone')`). */
export const PARAM_ZONE_LIEN = 'customZone';
/** La clé de cache d'une zone enregistrée dans le créneau de bataille (`setBattleCacheKey(\`cg__${cid}\`)`). */
export const PREFIXE_CLE_ZONE = 'cg__';
/** La catégorie de la « bataille » d'une zone (`applyIsochroneBattle(…, 'custom_geo_zone', …)`). */
export const CATEGORIE_ZONE = 'custom_geo_zone';
/** Le nom d'une zone sans nom (`page.tsx:796`). */
const NOM_PAR_DEFAUT = 'Zone personnalisée';
/** Le centre d'une zone sans emprise (`page.tsx:820`). */
const CENTRE_PAR_DEFAUT = { lat: 46.5, lng: 2.5 };

/** Ce que `GET /api/custom-geo/[id]/geometry` rend (`get_custom_geo_zone_feature`). */
export interface EntiteZone {
  type: 'Feature';
  geometry: GeoJSON.Geometry | null;
  properties: { id: string; name?: string | null } & Record<string, unknown>;
}

/** Ce que la zone met dans le créneau de bataille. */
export interface CreneauZone {
  anneaux: GeoJSON.Feature[];
  poi: PoiBataille;
  cle: string;
  /** L'emprise des polygones, `null` sans polygone (aucun recadrage, comme React). */
  bbox: Bbox | null;
}

/**
 * La géométrie lue → le créneau (`page.tsx:790-823`) : un anneau par polygone (un `MultiPolygon` est éclaté, chaque
 * morceau porte `_idx`), ou la géométrie entière quand ce n'est pas un polygone ; l'emprise ne parcourt QUE les
 * polygones. `null` sans géométrie (React s'arrête là, sans rien afficher).
 */
export function creneauDepuisZone(feature: EntiteZone | null | undefined): CreneauZone | null {
  if (!feature?.geometry) return null;
  const geom = feature.geometry;
  const polys: GeoJSON.Position[][][] = geom.type === 'MultiPolygon'
    ? geom.coordinates
    : geom.type === 'Polygon' ? [geom.coordinates] : [];
  const cid = feature.properties.id;
  const nom = feature.properties.name ?? NOM_PAR_DEFAUT;
  const anneaux: GeoJSON.Feature[] = polys.length === 0
    ? [{ type: 'Feature', geometry: geom, properties: { id: cid, cirfa_id: cid, nom, palier: 1 } }]
    : polys.map((coords, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: coords },
      properties: { id: cid, cirfa_id: cid, nom, palier: 1, _idx: i },
    }));
  // L'emprise des seuls polygones (React ne parcourt qu'eux) : le parcours commun de `bboxDeGeometrie`, sans copie.
  const bbox = polys.length ? bboxDeGeometrie(geom) : null;
  const centre = bbox ? { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2 } : CENTRE_PAR_DEFAUT;
  return { anneaux, poi: { id: cid, nom, ...centre }, cle: `${PREFIXE_CLE_ZONE}${cid}`, bbox };
}

/** L'id de zone porté par une clé de créneau `cg__<id>`, `null` pour toute autre clé (une vraie bataille). */
export function zoneDeCle(cle: string | null | undefined): string | null {
  return cle?.startsWith(PREFIXE_CLE_ZONE) ? cle.slice(PREFIXE_CLE_ZONE.length) : null;
}
