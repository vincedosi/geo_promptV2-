'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MagelianDeepLinkRequest } from './deep-link';
import type { FiltreActif } from '@/lib/carte/filtre';
import type { CampagneActive } from '@/lib/campaigns/campagne-active';

export type { CampagneActive };

interface MagelianOverlayState {
  open: boolean;
  /** Demande d'ouverture ciblée (deep-link) — consommée puis effacée par l'overlay. */
  request: MagelianDeepLinkRequest | null;
  /**
   * Campagne active globale (Tâche 9) — dérivée par `MagelianOverlay.tsx`
   * (fonction pure `deriveCampagneActive`, lib/campaigns/campagne-active.ts)
   * et affichée dans `MapTopBar` et `CampagneActiveCard`. Reste renseignée
   * quand `open` repasse à `false` : ni `closeOverlay` ni `requestClose`
   * n'y touchent, c'est la condition de persistance au retour à la carte.
   */
  campagneActive: CampagneActive | null;
  /**
   * Miroir du filtre carte (lib/carte/filtre.ts, état réel dans `app/map/page.tsx`) :
   * l'onglet Stratégie de l'overlay n'a pas d'autre moyen de savoir qu'un filtre
   * est actif pour afficher sa note de périmètre (spec §3 — un filtre de carte
   * ne restreint jamais le périmètre d'une stratégie).
   */
  filtreActif: FiltreActif | null;
  openOverlay: (options?: MagelianDeepLinkRequest) => void;
  /** Fermeture immédiate (sans animation) — réservée à l'usage interne de
   *  `MagelianOverlay` (appelée par son `handleClose`, après l'animation de
   *  sortie). Un appelant EXTÉRIEUR qui veut fermer l'overlay doit passer
   *  par `requestClose`, pas par celle-ci — round de correction 1, point 4 :
   *  sinon la fermeture saute l'animation de sortie que jouent Échap et le
   *  bouton Fermer. */
  closeOverlay: () => void;
  /**
   * Demande de fermeture ANIMÉE (Tâche 9, round de correction 1, point 4) :
   * incrémente un compteur que `MagelianOverlay` observe pour déclencher son
   * `handleClose` interne (celui-là même qu'utilisent Échap et le bouton
   * Fermer) — un seul chemin de fermeture, quel que soit le déclencheur.
   * Utilisée par `MapTopBar` (bascule) et `app/map/page.tsx` (Alt+C).
   */
  requestClose: () => void;
  /** Compteur observé par `MagelianOverlay` : toute incrémentation déclenche
   *  sa fermeture animée. Ne pas lire directement ailleurs — passer par `requestClose`. */
  closeRequestId: number;
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
  const closeRequestIdRef = useRef(0);
  const [closeRequestId, setCloseRequestId] = useState(0);

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
  const requestClose = useCallback(() => {
    closeRequestIdRef.current += 1;
    setCloseRequestId(closeRequestIdRef.current);
  }, []);
  const clearRequest = useCallback(() => setRequest(null), []);

  const value = useMemo(
    () => ({
      open, request, campagneActive, filtreActif, closeRequestId,
      openOverlay, closeOverlay, requestClose, clearRequest, setCampagneActive, setFiltreActif,
    }),
    [open, request, campagneActive, filtreActif, closeRequestId, openOverlay, closeOverlay, requestClose, clearRequest]
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
