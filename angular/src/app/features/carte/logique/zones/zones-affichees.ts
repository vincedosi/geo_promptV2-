/**
 * Logique PURE des zones enregistrées affichées sur la carte — portage des aides de
 * `components/map/overlays/ZonesOverlay.tsx:57-85` (lot 4, T14). Aucune dépendance Angular ni MapLibre :
 * le service de couche (`couches/zones-custom.service.ts`) et la carte de zone du panneau s'en servent.
 */
import { PALETTE_ZONES } from '../palettes-donnees-carte';

/** Préfixe des sources des zones affichées : `custom-zone-<id>` (`ZonesOverlay.tsx:83`). « Tout effacer » le connaît. */
export const PREFIXE_SOURCE_ZONE = 'custom-zone-';

/** Les trois identifiants MapLibre d'une zone affichée — source, aplat, contour (`ZonesOverlay.tsx:83-85`). */
export function idsZone(zoneId: string): { source: string; aplat: string; contour: string } {
  return {
    source: `${PREFIXE_SOURCE_ZONE}${zoneId}`,
    aplat: `custom-zone-fill-${zoneId}`,
    contour: `custom-zone-line-${zoneId}`,
  };
}

/**
 * La couleur de la prochaine zone : la palette en cycle sur le nombre de zones DÉJÀ affichées
 * (`ZONE_PALETTE[loadedZones.size % length]`, `ZonesOverlay.tsx:214`). Comme React, masquer puis ré-afficher peut
 * donner deux fois la même teinte : c'est le rang au moment du geste qui compte, pas une teinte réservée par zone.
 */
export function couleurZone(dejaAffichees: number): string {
  return PALETTE_ZONES[dejaAffichees % PALETTE_ZONES.length];
}

export type Bbox = [number, number, number, number];

/**
 * L'emprise d'une géométrie GeoJSON, `null` sans coordonnée — `bboxFromGeometry` (`ZonesOverlay.tsx:66-81`) :
 * parcours récursif des tableaux de coordonnées, quel que soit le type (Polygon, MultiPolygon, LineString…).
 */
export function bboxDeGeometrie(geom: object | null | undefined): Bbox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const parcourir = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      const [x, y] = c as [number, number];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      return;
    }
    c.forEach(parcourir);
  };
  if (geom && 'coordinates' in geom) parcourir((geom as { coordinates: unknown }).coordinates);
  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

/**
 * L'emprise du recadrage : celle que la liste a déjà calculée (`zone.bbox`, quatre nombres), sinon celle de la
 * géométrie lue (`ZonesOverlay.tsx:243`).
 */
export function bboxDeZone(bboxListe: readonly number[] | null | undefined, geom: object | null): Bbox | null {
  return bboxListe && bboxListe.length === 4 ? [bboxListe[0], bboxListe[1], bboxListe[2], bboxListe[3]] : bboxDeGeometrie(geom);
}

/** La date de création d'une carte de zone — `fmtDate` (`ZonesOverlay.tsx:62-64`) : « 03 sept. 2026 ». */
export function dateZone(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Le message d'une lecture en échec, comme React l'écrit (`throw new Error(\`HTTP ${res.status}\`)`, `ZonesOverlay.tsx`) :
 * « HTTP 404 » quand le serveur a répondu, le message de l'erreur sinon, `repli` en dernier recours.
 */
export function messageHttp(erreur: unknown, repli: string): string {
  const statut = (erreur as { status?: unknown } | null)?.status;
  if (typeof statut === 'number' && statut > 0) return `HTTP ${statut}`;
  return erreur instanceof Error && erreur.message ? erreur.message : repli;
}

/**
 * Les types de source présents dans la liste, triés, pour les puces de filtre (`availableSourceTypes`,
 * `ZonesOverlay.tsx:196-200`). Les puces n'apparaissent qu'à partir de DEUX types (`> 1`, l.359).
 */
export function typesDeSource(zones: readonly { source_type: string }[]): string[] {
  return [...new Set(zones.map((z) => z.source_type))].sort();
}
