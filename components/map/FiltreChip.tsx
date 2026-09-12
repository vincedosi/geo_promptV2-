'use client';

import { Funnel, X } from 'lucide-react';
import { LARGEUR_RAIL, ECART_RAIL_PANNEAU } from '@/lib/navigation/config';
import { MAP_TOPBAR_HEIGHT } from '@/components/map/MapTopBar';
import type { FiltreActif } from '@/lib/carte/filtre';

interface FiltreChipProps {
  /** Filtre actif. Rien n'est affiché si null. */
  filtre: FiltreActif | null;
  /** Retire le filtre (croix). */
  onRetirer: () => void;
}

/**
 * Chip persistant du filtre actif — haut-gauche de la carte, sous la top bar.
 * Visible indépendamment du panneau ouvert (rappelle « où je regarde » même
 * quand le panneau Filtre est refermé). Recouvert par l'`OverlayPanel` du
 * rail quand celui-ci est ouvert à la même position (zIndex inférieur) :
 * le panneau affiche déjà le filtre courant dans ce cas.
 */
export function FiltreChip({ filtre, onRetirer }: FiltreChipProps) {
  if (!filtre) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: MAP_TOPBAR_HEIGHT + 12,
        left: LARGEUR_RAIL + ECART_RAIL_PANNEAU,
        zIndex: 35,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        background: 'var(--elevated)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 6,
      }}
    >
      <Funnel size={12} color="var(--brand-teal)" strokeWidth={1.5} />
      <span
        style={{
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 12,
          color: 'var(--text-primary)',
          maxWidth: 220,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {filtre.label}
      </span>
      <button
        type="button"
        onClick={onRetirer}
        aria-label="Retirer le filtre"
        title="Retirer le filtre"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--text-tertiary)',
        }}
      >
        <X size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}
