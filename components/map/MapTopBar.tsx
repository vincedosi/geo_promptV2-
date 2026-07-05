'use client';

import { SessionBadge } from '@/components/SessionBadge';
import { ThemeToggle } from '@/components/ThemeToggle';

/** Hauteur de la top bar — utilisée par page.tsx pour caler paddingTop. */
export const MAP_TOPBAR_HEIGHT = 44;

/**
 * Top bar horizontale pour la page /map :
 *   [logo MAGELIAN] …………………… [theme toggle] [workspace ▾] [email ▾]
 *
 * Positionnée à droite de l'IconBar (left: 48) pour ne pas chevaucher le
 * rail vertical. Reste au-dessus des overlays (z-index: 45, au-dessus de
 * l'OverlayPanel z:40).
 */
export function MapTopBar() {
  return (
    <div
      role="banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 48,
        right: 0,
        height: MAP_TOPBAR_HEIGHT,
        zIndex: 45,
        background: 'var(--bg-surface)',
        borderBottom: '0.5px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px 0 16px',
        gap: 12,
        backdropFilter: 'blur(var(--backdrop-blur, 4px))',
        WebkitBackdropFilter: 'blur(var(--backdrop-blur, 4px))',
      }}
    >
      {/* ── Logo MAGELIAN ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <img
          src="/magelian-icon.svg"
          alt="MAGELIAN"
          style={{ height: 18, width: 'auto', display: 'block' }}
        />
      </div>

      {/* ── Chrome : theme toggle + workspace dropdown + email ────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <ThemeToggle />
        <SessionBadge />
      </div>
    </div>
  );
}
