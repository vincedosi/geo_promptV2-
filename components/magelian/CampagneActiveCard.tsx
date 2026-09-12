'use client';

import { useMagelianOverlay } from './MagelianOverlayContext';
import { LARGEUR_RAIL, ECART_RAIL_PANNEAU } from '@/lib/navigation/config';
import { MAP_TOPBAR_HEIGHT } from '@/components/map/MapTopBar';

const fInter = "'Inter', system-ui, sans-serif";

/**
 * Carte flottante haut-gauche de la carte (Tâche 9, étape 2) : rappelle la
 * campagne active quand l'overlay MAGELIAN est fermé, avec un bouton
 * « Ouvrir » qui rouvre l'overlay sur la même campagne (persistée par
 * `MagelianOverlay`, jamais démonté — voir MagelianOverlayContext).
 *
 * Ne déclenche AUCUNE requête : affiche uniquement ce que le contexte porte
 * déjà (contrainte Supabase Nano).
 *
 * Décalée sous le chip du filtre carte (`FiltreChip`) quand celui-ci est
 * affiché, pour ne pas se superposer — les deux partagent la même ancre
 * haut-gauche (`LARGEUR_RAIL + ECART_RAIL_PANNEAU`).
 */
export function CampagneActiveCard() {
  const { open, campagneActive, filtreActif, openOverlay } = useMagelianOverlay();
  if (open || !campagneActive) return null;

  const top = MAP_TOPBAR_HEIGHT + 12 + (filtreActif ? 40 : 0);

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: LARGEUR_RAIL + ECART_RAIL_PANNEAU,
        zIndex: 34,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        background: 'var(--elevated)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 6,
        maxWidth: 300,
      }}
    >
      <span
        style={{
          width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {campagneActive.nom}
        </span>
        {campagneActive.annonceur && (
          <span
            style={{
              fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {campagneActive.annonceur}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => openOverlay()}
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: '0.5px solid var(--brand-teal)',
          color: 'var(--brand-teal)',
          borderRadius: 6,
          padding: '6px 10px',
          fontFamily: fInter,
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Ouvrir
      </button>
    </div>
  );
}
