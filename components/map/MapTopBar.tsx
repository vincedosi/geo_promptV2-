'use client';

import { SessionBadge } from '@/components/SessionBadge';
import { ThemeToggle } from '@/components/ThemeToggle';

const fInter = "'Inter', system-ui, sans-serif";

/** Hauteur de la top bar — utilisée par page.tsx pour caler paddingTop. */
export const MAP_TOPBAR_HEIGHT = 44;

/**
 * Top bar horizontale pour la page /map :
 *   [logo GEOMATIK] …………………… [theme toggle] [workspace ▾] [email ▾]
 *
 * Positionnée à droite de l'IconBar (left: 48) pour ne pas chevaucher le
 * rail vertical. Reste au-dessus des overlays (z-index: 45, au-dessus du
 * ResultsPanel z:35 et OverlayPanel z:40).
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
      {/* ── Logo GEOMATIK ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <svg width="22" height="22" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path d="M14 2L25.5 8.5V19.5L14 26L2.5 19.5V8.5L14 2Z" stroke="var(--brand-teal)" strokeWidth="1" fill="none" />
          <path d="M14 7L20.5 10.5V17.5L14 21L7.5 17.5V10.5L14 7Z" stroke="var(--brand-teal)" strokeWidth="0.5" fill="rgba(78,205,196,0.06)" />
          <circle cx="14" cy="14" r="2" fill="var(--brand-teal)" opacity="0.5" />
        </svg>
        <span style={{ fontFamily: fInter, fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1 }}>
          <span style={{ color: 'var(--text-primary)' }}>GEOM</span>
          <span style={{ color: 'var(--brand-teal)' }}>ATIK</span>
        </span>
      </div>

      {/* ── Chrome : theme toggle + workspace dropdown + email ────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <ThemeToggle />
        <SessionBadge />
      </div>
    </div>
  );
}
