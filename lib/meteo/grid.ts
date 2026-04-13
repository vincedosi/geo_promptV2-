import type { GridPoint } from './types';

export function computeSquareId(point: GridPoint): string {
  const lon = point.lon.toFixed(3);
  const lat = point.lat.toFixed(3);
  return `${lon}_${lat}`;
}

export function generateGrid(
  bbox: [number, number, number, number],
  resolution: number,
): GridPoint[] {
  const [west, south, east, north] = bbox;
  const points: GridPoint[] = [];
  const epsilon = resolution / 1e6;
  for (let lat = south; lat <= north + epsilon; lat += resolution) {
    for (let lon = west; lon <= east + epsilon; lon += resolution) {
      points.push({
        lon: Math.round(lon * 1e6) / 1e6,
        lat: Math.round(lat * 1e6) / 1e6,
      });
    }
  }
  return points;
}

export function buildSquarePolygon(
  point: GridPoint,
  resolution: number,
): GeoJSON.Polygon {
  const half = resolution / 2;
  const west = point.lon - half;
  const east = point.lon + half;
  const south = point.lat - half;
  const north = point.lat + half;
  return {
    type: 'Polygon',
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

export function adaptiveResolution(
  bbox: [number, number, number, number],
  defaultResolution: number,
  maxPoints: number,
): number {
  let resolution = defaultResolution;
  let count = generateGrid(bbox, resolution).length;
  while (count > maxPoints) {
    resolution *= 2;
    count = generateGrid(bbox, resolution).length;
  }
  return resolution;
}
