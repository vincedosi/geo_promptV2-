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
      {/* Backdrop — semi-transparent, click to close (alpha noir universel dark/light) */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: 8000,
          animation: 'croFadeIn 200ms var(--ease-out)',
        }}
      />
      {/* Overlay panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(900px, 65vw)',
        background: 'var(--bg-primary)',
        borderLeft: '0.5px solid var(--border-subtle)',
        zIndex: 8001,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'croSlideIn 260ms cubic-bezier(0.32, 0.72, 0, 1)',
      }}>
        <ClusterDetails version={version} onClose={onClose} />
      </div>

      <style>{`
        @keyframes croFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes croSlideIn {
          from { opacity: 0; transform: translateX(32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0s !important; }
        }
      `}</style>
    </>
  );
}
