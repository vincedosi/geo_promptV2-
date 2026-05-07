'use client';

/**
 * Hook de gestion du mode de vue de l'overlay Pilotage ML.
 *
 *   - 'simple' : vue simplifiée pour pitch / découverte (par défaut)
 *   - 'expert' : vue complète avec tous les outils opérationnels
 *
 * Persistance localStorage. Toggle switchable à tout moment.
 */
import { useEffect, useState } from 'react';

export type ViewMode = 'simple' | 'expert';

const STORAGE_KEY = 'geomatik:pilotage-ml:view-mode:v1';

function loadFromStorage(): ViewMode {
  if (typeof window === 'undefined') return 'simple';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'expert' || raw === 'simple') return raw;
  } catch { /* ignore */ }
  return 'simple';
}

export function useViewMode() {
  const [mode, setMode] = useState<ViewMode>('simple');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setMode(loadFromStorage());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode, hydrated]);

  const toggle = () => setMode(m => m === 'simple' ? 'expert' : 'simple');

  return { mode, setMode, toggle };
}
