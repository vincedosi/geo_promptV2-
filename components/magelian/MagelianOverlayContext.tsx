'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MagelianDeepLinkRequest } from './deep-link';

interface MagelianOverlayState {
  open: boolean;
  /** Demande d'ouverture ciblée (deep-link) — consommée puis effacée par l'overlay. */
  request: MagelianDeepLinkRequest | null;
  openOverlay: (options?: MagelianDeepLinkRequest) => void;
  closeOverlay: () => void;
  clearRequest: () => void;
}

const MagelianOverlayContext = createContext<MagelianOverlayState | null>(null);

export function MagelianOverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<MagelianDeepLinkRequest | null>(null);

  const openOverlay = useCallback((options?: MagelianDeepLinkRequest) => {
    setRequest(options ?? null);
    setOpen(true);
  }, []);
  const closeOverlay = useCallback(() => {
    setOpen(false);
    setRequest(null);
  }, []);
  const clearRequest = useCallback(() => setRequest(null), []);

  const value = useMemo(
    () => ({ open, request, openOverlay, closeOverlay, clearRequest }),
    [open, request, openOverlay, closeOverlay, clearRequest]
  );

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
