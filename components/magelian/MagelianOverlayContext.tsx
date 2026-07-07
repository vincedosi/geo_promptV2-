'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface MagelianOverlayState {
  open: boolean;
  openOverlay: () => void;
  closeOverlay: () => void;
}

const MagelianOverlayContext = createContext<MagelianOverlayState | null>(null);

export function MagelianOverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openOverlay = useCallback(() => setOpen(true), []);
  const closeOverlay = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({ open, openOverlay, closeOverlay }), [open, openOverlay, closeOverlay]);

  return (
    <MagelianOverlayContext.Provider value={value}>
      {children}
    </MagelianOverlayContext.Provider>
  );
}

export function useMagelianOverlay() {
  const ctx = useContext(MagelianOverlayContext);
  if (!ctx) {
    throw new Error('useMagelianOverlay must be used within a MagelianOverlayProvider');
  }
  return ctx;
}
