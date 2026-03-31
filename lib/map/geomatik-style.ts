/**
 * GEOMATIK dark map style — runtime layer overrides for OpenFreeMap
 *
 * Applied on top of any OpenFreeMap style (Liberty/Bright/Positron)
 * to match the GEOMATIK design system colors.
 */

import type maplibregl from 'maplibre-gl';

/** Color overrides for GEOMATIK dark theme */
const GEOMATIK_OVERRIDES = {
  // Backgrounds
  background: '#0a0a0a',
  water: '#050505',
  waterStroke: '#1a1a1a',
  // Land
  land: '#0a0a0a',
  landuse: '#0d0d0d',
  park: '#0a0a0a',
  // Buildings
  building: '#111111',
  buildingStroke: '#1a1a1a',
  // Roads
  roadMajor: '#262626',
  roadMinor: '#1a1a1a',
  roadHighway: '#333333',
  // Borders
  border: '#262626',
  // Labels
  labelCity: '#666666',
  labelRegion: 'rgba(78,205,196,0.35)',
  labelHalo: '#050505',
  labelMinor: '#333333',
} as const;

/**
 * Apply GEOMATIK dark overrides to all layers of an already-loaded map.
 * Call this inside map.on('load') or after map.setStyle().
 */
export function applyGeomatikStyle(map: maplibregl.Map): void {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    const id = layer.id.toLowerCase();
    const type = layer.type;

    try {
      // Background
      if (type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', GEOMATIK_OVERRIDES.background);
        continue;
      }

      // Water
      if (type === 'fill' && (id.includes('water') || id.includes('ocean') || id.includes('sea'))) {
        map.setPaintProperty(layer.id, 'fill-color', GEOMATIK_OVERRIDES.water);
        if (id.includes('pattern')) continue;
        continue;
      }
      if (type === 'line' && id.includes('water')) {
        map.setPaintProperty(layer.id, 'line-color', GEOMATIK_OVERRIDES.waterStroke);
        continue;
      }

      // Land / landuse / park
      if (type === 'fill' && (id.includes('land') || id.includes('park') || id.includes('grass') || id.includes('wood') || id.includes('green'))) {
        map.setPaintProperty(layer.id, 'fill-color', id.includes('use') ? GEOMATIK_OVERRIDES.landuse : GEOMATIK_OVERRIDES.land);
        continue;
      }

      // Buildings
      if (type === 'fill' && id.includes('building')) {
        map.setPaintProperty(layer.id, 'fill-color', GEOMATIK_OVERRIDES.building);
        continue;
      }
      if (type === 'line' && id.includes('building')) {
        map.setPaintProperty(layer.id, 'line-color', GEOMATIK_OVERRIDES.buildingStroke);
        continue;
      }

      // Roads
      if (type === 'line' && (id.includes('road') || id.includes('highway') || id.includes('street') || id.includes('trunk') || id.includes('motorway') || id.includes('path') || id.includes('track'))) {
        if (id.includes('highway') || id.includes('motorway') || id.includes('trunk')) {
          map.setPaintProperty(layer.id, 'line-color', GEOMATIK_OVERRIDES.roadHighway);
        } else if (id.includes('major') || id.includes('primary') || id.includes('secondary')) {
          map.setPaintProperty(layer.id, 'line-color', GEOMATIK_OVERRIDES.roadMajor);
        } else {
          map.setPaintProperty(layer.id, 'line-color', GEOMATIK_OVERRIDES.roadMinor);
        }
        continue;
      }

      // Fill for roads (casing)
      if (type === 'fill' && (id.includes('road') || id.includes('highway'))) {
        map.setPaintProperty(layer.id, 'fill-color', GEOMATIK_OVERRIDES.roadMinor);
        continue;
      }

      // Borders
      if (type === 'line' && (id.includes('boundary') || id.includes('border') || id.includes('admin'))) {
        map.setPaintProperty(layer.id, 'line-color', GEOMATIK_OVERRIDES.border);
        map.setPaintProperty(layer.id, 'line-dasharray', [4, 2]);
        continue;
      }

      // Labels — text color + halo
      if (type === 'symbol') {
        if (id.includes('country') || id.includes('state') || id.includes('region') || id.includes('province')) {
          map.setPaintProperty(layer.id, 'text-color', GEOMATIK_OVERRIDES.labelRegion);
        } else if (id.includes('city') || id.includes('town') || id.includes('place') || id.includes('capital')) {
          map.setPaintProperty(layer.id, 'text-color', GEOMATIK_OVERRIDES.labelCity);
        } else {
          map.setPaintProperty(layer.id, 'text-color', GEOMATIK_OVERRIDES.labelMinor);
        }
        map.setPaintProperty(layer.id, 'text-halo-color', GEOMATIK_OVERRIDES.labelHalo);
        map.setPaintProperty(layer.id, 'text-halo-width', 1.5);
        continue;
      }

      // Catch-all fills — darken everything else
      if (type === 'fill' && !id.includes('isochrone') && !id.includes('voronoi') && !id.includes('battle') && !id.includes('zone') && !id.includes('carreaux') && !id.includes('iris') && !id.includes('cluster') && !id.includes('poi')) {
        map.setPaintProperty(layer.id, 'fill-color', GEOMATIK_OVERRIDES.land);
      }
    } catch {
      // Some properties may not exist on certain layers — skip silently
    }
  }
}
