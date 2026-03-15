/**
 * lib/chat/tools/_shared.ts
 * Utilitaires partagés entre outils OOH (haversine, bbox, colonnes Filosofi).
 * Élimine la duplication de haversineM + KNOWN_COLS présents 3× dans l'ancien tools.ts.
 */

export const KNOWN_FILOSOFI_COLS = [
  'Ind', 'Ind_0_3', 'Ind_4_5', 'Ind_6_10', 'Ind_11_17', 'ind_18_24',
  'Ind_25_39', 'Ind_40_54', 'Ind_55_64', 'Ind_65_79', 'Ind_80p', 'Men', 'rev_median',
] as const;

const TO_RAD = Math.PI / 180;

/** Distance en mètres entre deux points (formule haversine). */
export function haversineM(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dLat = (lat2 - lat1) * TO_RAD;
  const dLng = (lng2 - lng1) * TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * TO_RAD) * Math.cos(lat2 * TO_RAD) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Bounding-box géographique autour d'un ensemble de points + buffer en mètres. */
export function buildBbox(lats: number[], lngs: number[], rayon_m: number) {
  const bufferDeg = (rayon_m / 111_320) * 1.2;
  const cosLat    = Math.cos(lats[0] * Math.PI / 180);
  return {
    minLat: Math.min(...lats) - bufferDeg,
    maxLat: Math.max(...lats) + bufferDeg,
    minLng: Math.min(...lngs) - bufferDeg / cosLat,
    maxLng: Math.max(...lngs) + bufferDeg / cosLat,
  };
}
