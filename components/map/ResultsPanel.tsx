'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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

export function ResultsPanel({
  type,
  title,
  dotColor = 'var(--cat-analysis)',
  onClose,
  children,
  width,
}: ResultsPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Largeur fluide : explicitée par le parent OU clamp 720px / 65vw par défaut
  const widthValue = width !== undefined ? width : 'min(900px, 65vw)';

  return (
    <div
      ref={ref}
      className="results-panel"
      data-type={type}
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
        transform: mounted ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 240ms var(--ease-out, ease)',
        overflow: 'hidden',
        boxShadow: '-4px 0 18px rgba(0, 0, 0, 0.22)',
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
          onClick={onClose}
          aria-label="Fermer le panel des résultats"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            color: 'var(--text-tertiary)',
            borderRadius: 4,
            transition: 'background-color 150ms var(--ease-hover, ease), color 150ms var(--ease-hover, ease)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--bg-level-2)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-tertiary)';
          }}
        >
          <X size={16} strokeWidth={1.5} />
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
