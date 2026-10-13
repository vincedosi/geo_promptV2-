'use client'

import React from 'react'
import { X } from 'lucide-react'

/**
 * Bandeau d'erreur de la page carte (`app/map/page.tsx`).
 *
 * Rend l'état `error` alimenté par `useMapDirectActions` et `useVoronoiDirect`
 * (refus de périmètre, délais dépassés, erreurs OOH / bataille / isochrones…).
 * `ChatPanel` en était le seul afficheur ; son retrait (lot 5 de la suppression
 * de l'IA) les avait rendus muets. Style « Alertes / Statut — Danger » du
 * DESIGN_SYSTEM, en jetons : jamais de hex en dur. Effacé par la croix, ou par
 * la prochaine action qui remet `error` à null.
 */
export function BandeauErreur({
  message,
  onFermer,
}: {
  message: string | null
  onFermer: () => void
}) {
  if (!message) return null
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 12px',
        background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
        border: '0.5px solid color-mix(in srgb, var(--danger) 20%, transparent)',
        borderRadius: 6,
        color: 'var(--danger)',
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{message}</span>
      <button
        type="button"
        onClick={onFermer}
        aria-label="Fermer le message d'erreur"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'inherit',
          display: 'flex',
        }}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}
