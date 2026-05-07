/**
 * MAGELIAN map style — theme-aware runtime layer overrides for OpenFreeMap
 *
 * Applied on top of any OpenFreeMap style (Liberty/Bright/Positron)
 * to match the MAGELIAN design system colors, both in dark and light mode.
 *
 * Why a palette map: the basemap (Positron) is light by default; in light
 * mode we still apply a MAGELIAN-flavored light palette for brand consistency.
 * In dark mode we invert the basemap toward near-black surfaces.
 */

import type maplibregl from 'maplibre-gl';

type MagelianTheme = 'dark' | 'light';

type PaletteShape = {
  background: string;
  water: string;
  waterStroke: string;
  land: string;
  landuse: string;
  park: string;
  building: string;
  buildingStroke: string;
  roadMajor: string;
  roadMinor: string;
  roadHighway: string;
  border: string;
  labelCity: string;
  labelRegion: string;
  labelHalo: string;
  labelMinor: string;
};

/** Palette switched at runtime based on the active theme */
const MAGELIAN_PALETTE: Record<MagelianTheme, PaletteShape> = {
  dark: {
    background: '#0a0a0a',
    water: '#050505',
    waterStroke: '#1a1a1a',
    land: '#0a0a0a',
    landuse: '#0d0d0d',
    park: '#0a0a0a',
    building: '#111111',
    buildingStroke: '#1a1a1a',
    roadMajor: '#262626',
    roadMinor: '#1a1a1a',
    roadHighway: '#333333',
    border: '#262626',
    labelCity: '#666666',
    labelRegion: 'rgba(78,205,196,0.35)',
    labelHalo: '#050505',
    labelMinor: '#333333',
  },
  light: {
    background: '#f5f5f5',
    water: '#e6eff5',
    waterStroke: '#c8d8e3',
    land: '#f5f5f5',
    landuse: '#eeeeee',
    park: '#eaf0e6',
    building: '#e2e2e2',
    buildingStroke: '#d0d0d0',
    roadMajor: '#c4c4c4',
    roadMinor: '#dcdcdc',
    roadHighway: '#a6a6a6',
    border: '#bbbbbb',
    labelCity: '#4a4a4a',
    labelRegion: 'rgba(78,205,196,0.6)',
    labelHalo: '#ffffff',
    labelMinor: '#8a8a8a',
  },
};

/**
 * Apply MAGELIAN theme overrides to all layers of an already-loaded map.
 * Call inside map.on('load') initially, then again from a useEffect([theme])
 * so the basemap follows the theme toggle.
 */
export function applyMagelianStyle(
  map: maplibregl.Map,
  theme: MagelianTheme = 'dark',
): void {
  const style = map.getStyle();
  if (!style?.layers) return;

  const palette = MAGELIAN_PALETTE[theme];

  for (const layer of style.layers) {
    const id = layer.id.toLowerCase();
    const type = layer.type;

    try {
      // Background
      if (type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', palette.background);
        continue;
      }

      // Water
      if (type === 'fill' && (id.includes('water') || id.includes('ocean') || id.includes('sea'))) {
        map.setPaintProperty(layer.id, 'fill-color', palette.water);
        if (id.includes('pattern')) continue;
        continue;
      }
      if (type === 'line' && id.includes('water')) {
        map.setPaintProperty(layer.id, 'line-color', palette.waterStroke);
        continue;
      }

      // Land / landuse / park
      if (type === 'fill' && (id.includes('land') || id.includes('park') || id.includes('grass') || id.includes('wood') || id.includes('green'))) {
        map.setPaintProperty(layer.id, 'fill-color', id.includes('use') ? palette.landuse : palette.land);
        continue;
      }

      // Buildings
      if (type === 'fill' && id.includes('building')) {
        map.setPaintProperty(layer.id, 'fill-color', palette.building);
        continue;
      }
      if (type === 'line' && id.includes('building')) {
        map.setPaintProperty(layer.id, 'line-color', palette.buildingStroke);
        continue;
      }

      // Roads
      if (type === 'line' && (id.includes('road') || id.includes('highway') || id.includes('street') || id.includes('trunk') || id.includes('motorway') || id.includes('path') || id.includes('track'))) {
        if (id.includes('highway') || id.includes('motorway') || id.includes('trunk')) {
          map.setPaintProperty(layer.id, 'line-color', palette.roadHighway);
        } else if (id.includes('major') || id.includes('primary') || id.includes('secondary')) {
          map.setPaintProperty(layer.id, 'line-color', palette.roadMajor);
        } else {
          map.setPaintProperty(layer.id, 'line-color', palette.roadMinor);
        }
        continue;
      }

      // Fill for roads (casing)
      if (type === 'fill' && (id.includes('road') || id.includes('highway'))) {
        map.setPaintProperty(layer.id, 'fill-color', palette.roadMinor);
        continue;
      }

      // Borders
      if (type === 'line' && (id.includes('boundary') || id.includes('border') || id.includes('admin'))) {
        map.setPaintProperty(layer.id, 'line-color', palette.border);
        map.setPaintProperty(layer.id, 'line-dasharray', [4, 2]);
        continue;
      }

      // Labels — text color + halo
      if (type === 'symbol') {
        if (id.includes('country') || id.includes('state') || id.includes('region') || id.includes('province')) {
          map.setPaintProperty(layer.id, 'text-color', palette.labelRegion);
        } else if (id.includes('city') || id.includes('town') || id.includes('place') || id.includes('capital')) {
          map.setPaintProperty(layer.id, 'text-color', palette.labelCity);
        } else {
          map.setPaintProperty(layer.id, 'text-color', palette.labelMinor);
        }
        map.setPaintProperty(layer.id, 'text-halo-color', palette.labelHalo);
        map.setPaintProperty(layer.id, 'text-halo-width', 1.5);
        continue;
      }

      // Catch-all fills — align with land color
      if (type === 'fill' && !id.includes('isochrone') && !id.includes('voronoi') && !id.includes('battle') && !id.includes('zone') && !id.includes('carreaux') && !id.includes('iris') && !id.includes('cluster') && !id.includes('poi')) {
        map.setPaintProperty(layer.id, 'fill-color', palette.land);
      }
    } catch {
      // Some properties may not exist on certain layers — skip silently
    }
  }
}

export type { MagelianTheme };
