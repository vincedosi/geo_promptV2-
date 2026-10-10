/**
 * Logique PURE de la zone par rayon — portage de `app/map/_components/panneaux/CreerZoneRayon.tsx` (lot 4, T16).
 *
 * L'aperçu est un disque calculé ICI, sans requête : déplacer le curseur ne doit pas déclencher un appel par pixel. La
 * zone ENREGISTRÉE vient du serveur (`/api/custom-geo/source/rayon`), clippée sur `france_borders` : elle n'en est que
 * la part terrestre — Marseille 20 km n'en garde que 60,5 %, d'où `part_retenue` dans le message de création.
 */

/**
 * Bornes du curseur. Le maximum est celui de la route (100 km) ; le minimum est PLUS HAUT que le sien (500 m contre
 * 100 m) : sous 500 m, un cercle ne contient presque jamais un code postal entier et la zone créée serait vide.
 */
export const RAYON_MIN_M = 500;
export const RAYON_MAX_M = 100_000;
export const PAS_RAYON_M = 500;
export const RAYON_DEFAUT_M = 10_000;

export interface Centre { lon: number; lat: number }

/** Le corps de `POST /api/custom-geo/source/rayon`, rayon ramené dans les bornes du curseur (la route refuserait). */
export function corpsRayon(centre: Centre, rayonM: number): { lon: number; lat: number; rayon_m: number } {
  const rayon = Math.round(Math.min(RAYON_MAX_M, Math.max(RAYON_MIN_M, rayonM)));
  return { lon: centre.lon, lat: centre.lat, rayon_m: rayon };
}

/** Le rayon en kilomètres, au dixième — `Math.round(rayonM / 100) / 10` de React, point décimal compris. */
const enKm = (rayonM: number) => Math.round(rayonM / 100) / 10;

/** Le libellé à droite du curseur : « 20 km », « 1.5 km », « 500 m » (`CreerZoneRayon.tsx:249`). */
export function libelleRayon(rayonM: number): string {
  return rayonM >= 1000 ? `${enKm(rayonM)} km` : `${rayonM} m`;
}

/** Le nom d'une zone laissée sans nom : « Rayon de 20 km ». */
export function nomRayonParDefaut(rayonM: number): string {
  return `Rayon de ${enKm(rayonM)} km`;
}

/**
 * Cercle géodésique approché en 64 segments, pour l'APERÇU seulement (`cercleApercu`, `CreerZoneRayon.tsx:58-71`).
 * La correction en `cos(latitude)` sur la longitude est indispensable : sans elle, le cercle s'étire en ellipse dès
 * qu'on monte vers le nord.
 */
export function cercleApercu(lon: number, lat: number, rayonM: number): GeoJSON.Feature {
  const points: [number, number][] = [];
  const rayonDegLat = rayonM / 111_320;
  const rayonDegLon = rayonM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI;
    points.push([lon + rayonDegLon * Math.cos(angle), lat + rayonDegLat * Math.sin(angle)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [points] } };
}
