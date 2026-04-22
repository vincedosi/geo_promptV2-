'use client';

import { useEffect } from 'react';
import { ClusterDetails } from '@/components/ClusterDetails';

const fInter = "'Inter', system-ui, sans-serif";
const fMono  = "'JetBrains Mono', monospace";

interface Props {
  version: number;
  onClose: () => void;
}

export function ClusterResultsOverlay({ version, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
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
    </>
  );
}
