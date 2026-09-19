'use client';

import { SessionBadge } from '@/components/SessionBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ENTREES_NAVIGATION, LARGEUR_RAIL } from '@/lib/navigation/config';
import { useMagelianOverlay } from '@/components/magelian/MagelianOverlayContext';

/** Hauteur de la top bar — utilisée par page.tsx pour caler paddingTop. */
export const MAP_TOPBAR_HEIGHT = 44;

const fInter = "'Inter', system-ui, sans-serif";

/** Libellé de l'entrée « Campagne » — lu depuis la source unique de la
 *  navigation (lib/navigation/config.ts), jamais recopié (round de
 *  correction 1, point 5 : c'est exactement la dérive déjà survenue une
 *  fois dans ce chantier). Garanti présent : verrouillé par
 *  tests/unit/navigation/config.test.ts. */
const CAMPAGNE_ENTREE = ENTREES_NAVIGATION.find((e) => e.id === 'campagne')!;

/**
 * Top bar horizontale pour la page /map :
 *   [logo MAGELIAN] …… [bascule Campagne / Carte] …… [theme toggle] [email ▾]
 *
 * Positionnée à droite du rail (left: LARGEUR_RAIL) pour ne pas chevaucher le
 * rail vertical. Reste au-dessus des overlays (z-index: 45, au-dessus de
 * l'OverlayPanel z:40) — mais SOUS l'overlay MAGELIAN plein écran (z:10000,
 * `MagelianOverlay.tsx`) : ce bouton « Carte » n'est donc PAS cliquable une
 * fois l'overlay ouvert (round de correction 1, point 3) — l'overlay porte
 * son propre bouton « Carte » dans son en-tête pour ce cas. Fermeture
 * TOUJOURS via `requestClose()` (jamais `closeOverlay()` directement), pour
 * que la bascule joue la même animation de sortie qu'Échap et le bouton
 * Fermer (round de correction 1, point 4).
 */
export function MapTopBar() {
  const { open, campagneActive, openOverlay, requestClose } = useMagelianOverlay();

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

      {/* ── Campagne active + bascule Campagne / Carte (Tâche 9) ─────
          Raccourci Alt+C déjà déclaré dans lib/navigation/config.ts,
          branché sur le listener clavier unique de app/map/page.tsx. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          maxWidth: '46%',
          minWidth: 0,
        }}
      >
        {campagneActive && (
          <span
            title={campagneActive.annonceur ? `${campagneActive.nom} · ${campagneActive.annonceur}` : campagneActive.nom}
            style={{
              fontFamily: fInter,
              fontSize: 12,
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {campagneActive.nom}
            {campagneActive.annonceur ? ` · ${campagneActive.annonceur}` : ''}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { if (!open) openOverlay(); }}
            aria-pressed={open}
            title="Ouvrir la campagne (Alt+C)"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 2px',
              fontFamily: fInter,
              fontWeight: 500,
              fontSize: 12,
              color: open ? 'var(--text-primary)' : 'var(--text-tertiary)',
              borderBottom: open ? '2px solid var(--brand-teal)' : '2px solid transparent',
            }}
          >
            {CAMPAGNE_ENTREE.label}
          </button>
          <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}>/</span>
          <button
            type="button"
            onClick={() => { if (open) requestClose(); }}
            aria-pressed={!open}
            title="Revenir à la carte (Alt+C)"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 2px',
              fontFamily: fInter,
              fontWeight: 500,
              fontSize: 12,
              color: !open ? 'var(--text-primary)' : 'var(--text-tertiary)',
              borderBottom: !open ? '2px solid var(--brand-teal)' : '2px solid transparent',
            }}
          >
            Carte
          </button>
        </div>
      </div>

      {/* ── Chrome : theme toggle + email ─────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <ThemeToggle />
        <SessionBadge />
      </div>
    </div>
  );
}
