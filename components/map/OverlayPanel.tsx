'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { OverlayId } from './IconBar';

interface OverlayPanelProps {
  category: OverlayId;
  title: string;
  dotColor: string;
  onClose: () => void;
  children: ReactNode;
  /** Largeur (default 280) */
  width?: number;
}

export function OverlayPanel({
  category,
  title,
  dotColor,
  onClose,
  children,
  width = 280,
}: OverlayPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // Animation entrée : on démarre invisible, puis on passe visible au tick suivant
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Esc ferme l'overlay
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

  // Click-outside : ferme si le clic est hors de l'overlay ET hors de l'IconBar
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.overlay-panel')) return;
      if (target.closest('.icon-bar')) return;
      onClose();
    }
    // Décaler d'un tick pour ne pas catcher le clic d'ouverture
    const t = setTimeout(() => window.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="overlay-panel"
      data-category={category}
      role="dialog"
      aria-label={title}
      style={{
        position: 'fixed',
        top: 12,
        left: 56, // 48 IconBar + 8 gap
        width,
        maxHeight: 'calc(100vh - 24px)',
        background: 'var(--card-overlay, rgba(10, 10, 10, 0.92))',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '0.5px solid var(--border-default, #262626)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateX(0)' : 'translateX(-8px)',
        transition: 'opacity 150ms var(--ease-out, ease), transform 150ms var(--ease-out, ease)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '0.5px solid var(--border-subtle, #1a1a1a)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
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
            color: 'var(--text-primary, #f0f0f0)',
            flex: 1,
          }}
        >
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            color: 'var(--text-tertiary, #666666)',
            transition: 'color 150ms var(--ease-hover, ease)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary, #f0f0f0)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary, #666666)'; }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* Body scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0',
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
