'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MagelianDeepLinkRequest } from './deep-link';
import type { FiltreActif } from '@/lib/carte/filtre';

/**
 * Campagne actuellement en contexte dans l'overlay MAGELIAN — celle
 * consultée (Suivi/Aperçu) ou éditée (Stratégie). Contexte GLOBAL (Tâche 9) :
 * affichée dans `MapTopBar` et dans `CampagneActiveCard` (carte flottante
 * haut-gauche de la carte), et PERSISTE à la fermeture de l'overlay — c'est
 * `MagelianOverlay.tsx` (jamais démonté, seulement masqué) qui la dérive des
 * listes déjà chargées, sans fetch dédié.
 */
export interface CampagneActive {
  id: string;
  nom: string;
  annonceur: string | null;
}

interface MagelianOverlayState {
  open: boolean;
  /** Demande d'ouverture ciblée (deep-link) — consommée puis effacée par l'overlay. */
  request: MagelianDeepLinkRequest | null;
  /** Campagne active globale (Tâche 9). Reste renseignée quand `open` repasse à `false`. */
  campagneActive: CampagneActive | null;
  /**
   * Miroir du filtre carte (lib/carte/filtre.ts, état réel dans `app/map/page.tsx`) :
   * l'onglet Stratégie de l'overlay n'a pas d'autre moyen de savoir qu'un filtre
   * est actif pour afficher sa note de périmètre (spec §3 — un filtre de carte
   * ne restreint jamais le périmètre d'une stratégie).
   */
  filtreActif: FiltreActif | null;
  openOverlay: (options?: MagelianDeepLinkRequest) => void;
  closeOverlay: () => void;
  clearRequest: () => void;
  setCampagneActive: (campagne: CampagneActive | null) => void;
  setFiltreActif: (filtre: FiltreActif | null) => void;
}

const MagelianOverlayContext = createContext<MagelianOverlayState | null>(null);

export function MagelianOverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<MagelianDeepLinkRequest | null>(null);
  const [campagneActive, setCampagneActive] = useState<CampagneActive | null>(null);
  const [filtreActif, setFiltreActif] = useState<FiltreActif | null>(null);

  const openOverlay = useCallback((options?: MagelianDeepLinkRequest) => {
    setRequest(options ?? null);
    setOpen(true);
  }, []);
  // Ne touche jamais `campagneActive` : elle doit rester active au retour à
  // la carte (Tâche 9, étape 3).
  const closeOverlay = useCallback(() => {
    setOpen(false);
    setRequest(null);
  }, []);
  const clearRequest = useCallback(() => setRequest(null), []);

  const value = useMemo(
    () => ({
      open, request, campagneActive, filtreActif,
      openOverlay, closeOverlay, clearRequest, setCampagneActive, setFiltreActif,
    }),
    [open, request, campagneActive, filtreActif, openOverlay, closeOverlay, clearRequest]
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
