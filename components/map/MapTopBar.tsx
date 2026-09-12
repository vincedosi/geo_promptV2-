'use client';

import { SessionBadge } from '@/components/SessionBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LARGEUR_RAIL } from '@/lib/navigation/config';

/** Hauteur de la top bar — utilisée par page.tsx pour caler paddingTop. */
export const MAP_TOPBAR_HEIGHT = 44;

/**
 * Top bar horizontale pour la page /map :
 *   [logo MAGELIAN] …………………… [theme toggle] [workspace ▾] [email ▾]
 *
 * Positionnée à droite du rail (left: LARGEUR_RAIL) pour ne pas chevaucher le
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
        left: LARGEUR_RAIL,
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
        {/* eslint-disable-next-line @next/next/no-img-element -- logotype SVG : next/image n'optimise pas le SVG, et DESIGN_SYSTEM.md impose la balise img pour /magelian-icon.svg partout */}
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
