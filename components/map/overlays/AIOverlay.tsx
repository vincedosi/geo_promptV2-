'use client';

/**
 * @file components/map/overlays/AIOverlay.tsx — tiroir droit « Assistant »
 *
 * Jusqu'à la Tâche 8, l'Assistant s'ouvrait comme les quatre outils du rail
 * (panneau `OverlayPanel`, à gauche de la carte), en écart avec sa déclaration
 * `type: 'tiroir-droit'` dans `lib/navigation/config.ts` (adaptateur transitoire
 * posé à la Tâche 2 : « assistant -> AIOverlay, reste à gauche jusqu'à la
 * Tâche 8 »). Ce composant est désormais un vrai tiroir à DROITE de la carte,
 * autonome (position, header, animation, fermeture), et s'enregistre dans la
 * pile Echap (`lib/carte/pile-echap.ts`) au lieu d'écouter `keydown` en direct.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { empiler, depiler } from '@/lib/carte/pile-echap';

export interface AIOverlayProps {
  chatSlot: ReactNode;
  onClose: () => void;
  /** Offset vertical pour laisser la place à la top bar (default 0). */
  topOffset?: number;
}

/** Largeur du tiroir (spec Tâche 8) — exportée : les boutons flottants de la
 *  carte (`app/map/page.tsx`) doivent s'en écarter quand le tiroir est ouvert,
 *  comme ils le font déjà pour `ZoneMediaPlanPanel` (`PANEL_WIDTH`). */
export const LARGEUR_TIROIR_ASSISTANT = 380;
const LARGEUR_TIROIR = LARGEUR_TIROIR_ASSISTANT;

/** Identifiant fixe dans la pile Echap. */
const PILE_ID = 'assistant';

/** Durée de l'animation de sortie (doit matcher --duration-exit dans globals.css). */
const EXIT_DURATION_MS = 200;

export function AIOverlay({ chatSlot, onClose, topOffset = 0 }: AIOverlayProps) {
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => onClose(), EXIT_DURATION_MS);
  }, [closing, onClose]);

  useEffect(() => {
    empiler(PILE_ID, handleClose);
    return () => depiler(PILE_ID);
  }, [handleClose]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  return (
    <div
      className="ai-overlay-drawer"
      data-state={closing ? 'closing' : 'open'}
      role="dialog"
      aria-label="geo.prompt"
      style={{
        position: 'fixed',
        top: topOffset,
        right: 0,
        bottom: 0,
        width: LARGEUR_TIROIR,
        background: 'var(--card-overlay, rgba(10, 10, 10, 0.92))',
        backdropFilter: 'blur(var(--backdrop-blur, 4px))',
        WebkitBackdropFilter: 'blur(var(--backdrop-blur, 4px))',
        borderLeft: '0.5px solid var(--border-default, #262626)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        willChange: 'transform, opacity',
        animation: closing
          ? 'drawerSlideOutRight var(--duration-exit) var(--ease-exit) both'
          : 'drawerSlideInRight var(--duration-enter) var(--ease-spring) both',
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
            background: 'var(--brand-teal)',
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
          geo.prompt
        </span>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Fermer"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            color: 'var(--text-tertiary, #666666)',
            transition: 'color var(--duration-hover, 150ms) var(--ease-hover, ease)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary, #f0f0f0)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary, #666666)'; }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* Chat */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {chatSlot}
      </div>
    </div>
  );
}
