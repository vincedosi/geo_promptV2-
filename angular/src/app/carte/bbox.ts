import type maplibregl from 'maplibre-gl';

/** [ouest, sud, est, nord], en degrés WGS84. */
export type Bbox = readonly [ouest: number, sud: number, est: number, nord: number];

/** La bbox métropole de CLAUDE.md — un CADRAGE, jamais une zone de requête par défaut. */
export const CADRE_METROPOLE: Bbox = [-5.5, 41.2, 9.8, 51.2];

export function bboxDeCarte(carte: Pick<maplibregl.Map, 'getBounds'>): Bbox {
  const b = carte.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

/** Format attendu par les routes `?bbox=` du projet (même arrondi que côté React). */
export function bboxEnParametre(b: Bbox): string {
  return b.map((v) => v.toFixed(4)).join(',');
}
