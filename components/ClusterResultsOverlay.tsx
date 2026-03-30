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
      {/* Backdrop — semi-transparent, click to close */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(5,5,5,0.4)',
          zIndex: 8000,
        }}
      />
      {/* Overlay panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(900px, 65vw)',
        background: '#050505',
        borderLeft: '0.5px solid #1a1a1a',
        zIndex: 8001,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <ClusterDetails version={version} onClose={onClose} />
      </div>
    </>
  );
}
