'use client';

/**
 * Hook de personnalisation de la carte Pilotage ML.
 *
 * Préférences persistées en localStorage entre les sessions :
 *   - palette du fond (chaleur, teal, ratio…)
 *   - inversion de la palette
 *   - opacité du fond
 *   - couleurs des bulles (sans algo / avec algo) + opacité + stroke
 *   - granularité (CP / Département / Région)
 *   - mode de vue (carte unique avec toggle / côte à côte)
 *   - 3D
 */
import { useEffect, useState } from 'react';

export type PaletteId = 'chaleur' | 'teal' | 'rouge' | 'vert' | 'bleu' | 'plasma' | 'turbo';
export type Granularity = 'cp' | 'dept' | 'region';
export type ViewMode = 'single' | 'side_by_side';

export interface MapCustomization {
  bgPalette: PaletteId;
  bgPaletteInverted: boolean;
  bgOpacity: number;          // 0..1
  bubbleColorBefore: string;  // hex
  bubbleColorAfter: string;   // hex
  bubbleOpacity: number;      // 0..1
  bubbleStroke: number;       // px
  granularity: Granularity;
  viewMode: ViewMode;
  is3D: boolean;
}

export const PALETTES: Record<PaletteId, { label: string; stops: string[] }> = {
  chaleur: { label: 'Chaleur', stops: ['#fff5b8', '#ffd84d', '#ff8c1a', '#e63946', '#9d0208'] },
  teal:    { label: 'Teal',    stops: ['#e8fffd', '#7eddd5', '#4ecdc4', '#1e8a7a', '#0a3d39'] },
  rouge:   { label: 'Rouge',   stops: ['#fff5f0', '#fcbba1', '#fc9272', '#de2d26', '#a50f15'] },
  vert:    { label: 'Vert',    stops: ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'] },
  bleu:    { label: 'Bleu',    stops: ['#f7fbff', '#9ecae1', '#4292c6', '#2171b5', '#08306b'] },
  plasma:  { label: 'Plasma',  stops: ['#0d0887', '#6a00a8', '#b12a90', '#fca636', '#f0f921'] },
  turbo:   { label: 'Turbo',   stops: ['#30123b', '#4675ed', '#1bcfd4', '#f6a91b', '#c42503'] },
};

export const BUBBLE_SWATCHES: { label: string; value: string }[] = [
  { label: 'Gris',    value: '#a0a0a0' },
  { label: 'Teal',    value: '#06d6a0' },
  { label: 'Vert',    value: '#22c55e' },
  { label: 'Bleu',    value: '#3b82f6' },
  { label: 'Jaune',   value: '#facc15' },
  { label: 'Orange',  value: '#fb923c' },
  { label: 'Rouge',   value: '#ef4444' },
  { label: 'Violet',  value: '#a855f7' },
];

export const DEFAULTS: MapCustomization = {
  bgPalette: 'chaleur',
  bgPaletteInverted: false,
  bgOpacity: 0.75,
  bubbleColorBefore: '#a0a0a0',
  bubbleColorAfter: '#06d6a0',
  bubbleOpacity: 0.78,
  bubbleStroke: 1.5,
  granularity: 'dept',
  viewMode: 'single',
  is3D: false,
};

const STORAGE_KEY = 'geomatik:pilotage-ml:customization:v1';

function loadFromStorage(): MapCustomization {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<MapCustomization>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

export function useMapCustomization() {
  const [config, setConfig] = useState<MapCustomization>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setConfig(loadFromStorage());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch { /* ignore */ }
  }, [config, hydrated]);

  const update = <K extends keyof MapCustomization>(key: K, value: MapCustomization[K]) => {
    setConfig(c => ({ ...c, [key]: value }));
  };
  const reset = () => setConfig(DEFAULTS);

  /** Stops effectifs (palette + inversion). */
  const effectiveStops = (() => {
    const stops = PALETTES[config.bgPalette].stops;
    return config.bgPaletteInverted ? [...stops].reverse() : stops;
  })();

  return { config, update, reset, effectiveStops };
}
