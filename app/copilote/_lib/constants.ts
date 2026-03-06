/**
 * GENESIS — Copilote shared constants & pure helpers
 * No React, no side-effects — safe to import anywhere.
 */
import maplibregl from 'maplibre-gl';

// ---------------------------------------------------------------------------
// Pure geometry helpers
// ---------------------------------------------------------------------------

export function circleGeoJSON(
  lng: number,
  lat: number,
  radiusM: number,
  steps = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
  const R = 6371000;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dx = radiusM * Math.cos(a);
    const dy = radiusM * Math.sin(a);
    const dLng = (dx / R) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);
    const dLat = (dy / R) * (180 / Math.PI);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

export function applyChoropleth(map: maplibregl.Map, features: GeoJSON.Feature[], metricKey: string) {
  console.log('[applyChoropleth] metricKey:', metricKey, 'features:', features.length);
  const vals = features
    .map(f => Number((f.properties as Record<string, unknown>)?.[metricKey]))
    .filter(n => !isNaN(n) && n > 0);
  console.log('[applyChoropleth] non-zero values:', vals.length);
  if (vals.length === 0) { console.warn('[applyChoropleth] NO values, aborting'); return; }
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  console.log('[applyChoropleth] min:', mn, 'max:', mx);
  if (mx <= mn) { console.warn('[applyChoropleth] max <= min, aborting'); return; }
  const step = (mx - mn) / 4;
  map.setPaintProperty('carreaux-fill', 'fill-color', [
    'interpolate', ['linear'],
    ['case', ['>', ['coalesce', ['to-number', ['get', metricKey], 0], 0], 0],
      ['coalesce', ['to-number', ['get', metricKey], 0], 0], 0],
    0,        'rgba(0,0,0,0)',
    mn,       '#f7fbff',
    mn + step, '#9ecae1',
    mn + 2 * step, '#4292c6',
    mn + 3 * step, '#2171b5',
    mx,       '#08306b',
  ] as unknown as maplibregl.ExpressionSpecification);
  map.setPaintProperty('carreaux-fill', 'fill-opacity', [
    'case',
    ['>', ['coalesce', ['to-number', ['get', metricKey], 0], 0], 0], 0.7,
    0,
  ] as unknown as maplibregl.ExpressionSpecification);
}

// ---------------------------------------------------------------------------
// Category colors (cohérent avec MapContainer.tsx)
// ---------------------------------------------------------------------------

export const CATEGORY_COLORS: Record<string, string> = {
  lycee:   '#6366f1',
  college: '#3b82f6',
  cirfa:   '#ef4444',
  gare:    '#10b981',
  sport:   '#f59e0b',
  default: '#8b5cf6',
};

export function getCatColor(cat: string): string {
  return CATEGORY_COLORS[cat?.toLowerCase()] || CATEGORY_COLORS.default;
}

// ---------------------------------------------------------------------------
// Isochrone
// ---------------------------------------------------------------------------

export const ISOCHRONE_COLORS: Record<string, { fill: string; line: string }> = {
  walk:    { fill: '#22c55e', line: '#16a34a' },
  drive:   { fill: '#f97316', line: '#ea580c' },
  bike:    { fill: '#3b82f6', line: '#2563eb' },
  network: { fill: '#6366f1', line: '#4f46e5' },
};

export const ISOCHRONE_MODE_LABELS: Record<string, string> = {
  walk:  'À pied',
  drive: 'Voiture',
  bike:  'Vélo',
};

// ---------------------------------------------------------------------------
// Voronoï
// ---------------------------------------------------------------------------

export const VORONOI_PALETTE = [
  '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
  '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac',
  '#86bcb6','#d4a6c8','#8cd17d','#499894','#f1ce63',
  '#d37295','#fabfd2','#b6992d','#79706e','#7a9cc0',
];

// ---------------------------------------------------------------------------
// Bataille d'Isochrones
// ---------------------------------------------------------------------------

export const BATTLE_PALIER_OPACITY: Record<number, number> = {
  10:  0.65,
  30:  0.50,
  60:  0.38,
  90:  0.28,
  120: 0.18,
  150: 0.11,
};

// ---------------------------------------------------------------------------
// Map style (CARTO Light)
// ---------------------------------------------------------------------------

export const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://openstreetmap.org/copyright">OSM</a>',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'carto-bg', type: 'raster', source: 'carto' }],
};
