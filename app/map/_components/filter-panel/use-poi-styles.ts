/**
 * @file filter-panel/use-poi-styles.ts — style des pins POI par categorie
 *
 * Extrait de FilterPanel.tsx (2026-09-08). Taille et couleur du pin, par
 * categorie de POI, remontees au parent (`onPOIStylesChange`) qui les applique
 * aux marqueurs MapLibre via useMapMarkers.
 *
 * La couleur par defaut est une valeur de donnee passee a MapLibre, pas un
 * token CSS : elle doit rester un hex litteral.
 */
import { useEffect, useState } from 'react';
import type { POIStylesMap } from './poi-style';

export interface PoiStyleEntry { size: string; color: string }

const DEFAULT_STYLE: PoiStyleEntry = { size: 'Standard', color: '#a0a0a0' };

export interface PoiStyles {
  poiStyles: Record<string, PoiStyleEntry>;
  setPoiStyles: React.Dispatch<React.SetStateAction<Record<string, PoiStyleEntry>>>;
  getPOIStyle: (poi: string) => PoiStyleEntry;
  setPOIStyle: (poi: string, patch: Partial<PoiStyleEntry>) => void;
}

export function usePoiStyles(onPOIStylesChange?: (styles: POIStylesMap) => void): PoiStyles {
  const [poiStyles, setPoiStyles] = useState<Record<string, PoiStyleEntry>>({});
  const getPOIStyle = (poi: string) => poiStyles[poi] ?? DEFAULT_STYLE;
  const setPOIStyle = (poi: string, patch: Partial<PoiStyleEntry>) =>
    setPoiStyles(prev => ({ ...prev, [poi]: { ...getPOIStyle(poi), ...patch } }));

  useEffect(() => { onPOIStylesChange?.(poiStyles); }, [poiStyles, onPOIStylesChange]);

  return { poiStyles, setPoiStyles, getPOIStyle, setPOIStyle };
}
