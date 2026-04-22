'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

export type ResultsPanelType = 'clustering' | 'coverage' | 'scoring' | 'correlation';

interface ResultsPanelProps {
  type: ResultsPanelType;
  title: string;
  dotColor?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

/** Largeur "naturelle" du panel à droite. Conservée pour rétrocompat avec
 *  d'anciens consommateurs qui voudraient compresser la carte. Le panel
 *  flotte au-dessus de la carte sans la pousser. */
export const RESULTS_PANEL_WIDTH = 720;

/** Doit matcher --duration-exit dans globals.css. Délai DOM avant unmount. */
const EXIT_DURATION_MS = 200;

export function ResultsPanel({
  type,
  title,
  dotColor = 'var(--cat-analysis)',
  onClose,
  children,
  width,
}: ResultsPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wrappe l'appel parent : déclenche l'animation de sortie puis unmount après EXIT_DURATION
  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => onClose(), EXIT_DURATION_MS);
  }, [closing, onClose]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  // Largeur fluide : explicitée par le parent OU clamp 720px / 65vw par défaut
  const widthValue = width !== undefined ? width : 'min(900px, 65vw)';

  return (
    <div
      ref={ref}
      className="results-panel"
      data-type={type}
      data-state={closing ? 'closing' : 'open'}
      role="complementary"
      aria-label={title}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: widthValue,
        minWidth: 480,
        height: '100vh',
        background: 'var(--bg-surface)',
        borderLeft: '0.5px solid var(--border-default)',
        zIndex: 35,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '-4px 0 18px rgba(0, 0, 0, 0.22)',
        willChange: 'transform, opacity',
        animation: closing
          ? 'drawerSlideOutRight var(--duration-exit) var(--ease-exit) both'
          : 'drawerSlideInRight var(--duration-enter) var(--ease-spring) both',
      }}
    >
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '0.5px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
          background: 'var(--bg-level-2)',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            flex: 1,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </span>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Fermer le panel des résultats"
          title="Fermer (Échap)"
          style={{
            background: 'transparent',
            border: '0.5px solid var(--border-default)',
            cursor: 'pointer',
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--text-secondary)',
            borderRadius: 6,
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 12,
            fontWeight: 500,
            transition: 'background-color var(--duration-hover) var(--ease-hover), color var(--duration-hover) var(--ease-hover), border-color var(--duration-hover) var(--ease-hover), transform var(--duration-press) var(--ease-out)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--bg-primary)';
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.borderColor = 'var(--border-hover)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.borderColor = 'var(--border-default)';
          }}
          onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
          onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <X size={14} strokeWidth={1.75} />
          Fermer
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
