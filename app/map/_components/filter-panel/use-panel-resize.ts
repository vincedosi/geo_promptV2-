/**
 * @file filter-panel/use-panel-resize.ts — largeur redimensionnable du panneau
 *
 * Extrait de FilterPanel.tsx (2026-09-08). Drag horizontal sur la poignee de
 * droite, borne a [260, 720] px. Les listeners sont poses sur `document` le
 * temps du drag puis retires au mouseup — pas de state par mousemove ailleurs
 * que la largeur, pour ne pas re-rendre le panneau a chaque pixel.
 *
 * Utilise uniquement hors mode overlay (l'overlay impose sa propre largeur).
 */
import { useCallback, useRef, useState } from 'react';
import type React from 'react';

export interface PanelResize {
  /** Largeur courante du panneau, en pixels. */
  panelWidth: number;
  /** Setter direct — utilise par le double-clic (toggle 320 / 560). */
  setPanelWidth: React.Dispatch<React.SetStateAction<number>>;
  /** A brancher sur `onMouseDown` de la poignee de resize. */
  onResizeMouseDown: (e: React.MouseEvent) => void;
}

export function usePanelResize(initialWidth = 320): PanelResize {
  const [panelWidth, setPanelWidth] = useState(initialWidth);
  const isResizingRef   = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWRef = useRef(0);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    isResizingRef.current   = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWRef.current = panelWidth;
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newW = Math.max(260, Math.min(720, resizeStartWRef.current + ev.clientX - resizeStartXRef.current));
      setPanelWidth(newW);
    };
    const onMouseUp = () => {
      isResizingRef.current          = false;
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  }, [panelWidth]);

  return { panelWidth, setPanelWidth, onResizeMouseDown };
}
