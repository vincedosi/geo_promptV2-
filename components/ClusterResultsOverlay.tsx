'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { empiler, depiler } from '@/lib/carte/pile-echap';

/** Identifiant fixe dans la pile Echap. */
const PILE_ID = 'cluster-results';

const ClusterDetails = dynamic(
  () => import('@/components/ClusterDetails').then((m) => ({ default: m.ClusterDetails })),
  { ssr: false, loading: () => null }
);

const fInter = "'Inter', system-ui, sans-serif";
const fMono  = "'JetBrains Mono', monospace";

interface Props {
  version: number;
  onClose: () => void;
}

export function ClusterResultsOverlay({ version, onClose }: Props) {
  // Escape — via la pile Echap (lib/carte/pile-echap.ts) : ce tiroir peut
  // s'ouvrir alors que le panneau Analyse est empilé en dessous (il est monté
  // par ClusteringSection) ; un listener direct fermait les DEUX d'un coup sur
  // une seule pression (round de correction 1, Tâche 8, signalé sans être
  // corrigé au round précédent).
  useEffect(() => {
    empiler(PILE_ID, onClose);
    return () => depiler(PILE_ID);
  }, [onClose]);

  // Monte-t-on dans le DOM ? `createPortal` exige un `document`, absent au
  // rendu serveur.
  const [monte, setMonte] = useState(false);
  useEffect(() => { setMonte(true); }, []);
  if (!monte) return null;

  // ── Portail vers <body>, et ce n'est pas cosmetique ────────────────────────
  //
  // Ce tiroir est en `position: fixed`. Rendu a l'interieur du panneau de
  // filtres, il s'ancrait non pas sur la FENETRE mais sur le premier ancetre
  // qui etablit un bloc conteneur — et le panneau en a un : ses overlays sont
  // animes (`transform`). Resultat mesure au navigateur le 2026-09-12 : un
  // tiroir de 900 px comprime dans une colonne de 280 px, graphiques tronques.
  //
  // En 2026-07 le meme composant s'affichait correctement : l'animation des
  // overlays est posterieure. Restaurer le code tel quel restaurait donc un
  // defaut qui n'existait pas a l'epoque.
  return createPortal(
    <>
      {/* Backdrop avec blur léger sur le contenu en arrière-plan (PROMPT spec) */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(var(--backdrop-blur, 4px))',
          WebkitBackdropFilter: 'blur(var(--backdrop-blur, 4px))',
          zIndex: 8000,
          willChange: 'opacity, backdrop-filter',
          animation: 'backdropFadeIn var(--duration-enter) var(--ease-spring) both',
        }}
      />
      {/* Overlay panel — drawer pattern droite */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(900px, 65vw)',
        background: 'var(--bg-primary)',
        borderLeft: '0.5px solid var(--border-subtle)',
        zIndex: 8001,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        willChange: 'transform, opacity',
        animation: 'drawerSlideInRight var(--duration-enter) var(--ease-spring) both',
      }}>
        <ClusterDetails version={version} onClose={onClose} />
      </div>
    </>,
    document.body,
  );
}
