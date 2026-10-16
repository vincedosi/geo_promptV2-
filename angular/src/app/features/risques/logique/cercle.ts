/**
 * Un cercle en GeoJSON — copie Angular de `circleGeoJSON`
 * (`app/map/_lib/constants.ts:12-28`), nom francisé, même calcul : le
 * survol d'un site dessine ses anneaux sans aucune requête.
 */
export function cercleGeoJSON(
  lng: number,
  lat: number,
  rayonM: number,
  segments = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const R = 6371000;
  const coords: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    const dx = rayonM * Math.cos(a);
    const dy = rayonM * Math.sin(a);
    const dLng = (dx / R) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);
    const dLat = (dy / R) * (180 / Math.PI);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}
