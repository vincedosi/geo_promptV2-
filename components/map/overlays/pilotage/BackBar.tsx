'use client';

/**
 * Bandeau de retour affiché au-dessus du wizard et de l'historique dans
 * l'overlay Pilotage — extrait de PilotageOverlay.tsx (2026-09-07).
 */

import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { fInter } from './shared';

export function BackBar({ label, subtitle, onBack }: { label: string; subtitle?: string; onBack: () => void }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: '0.5px solid var(--border-subtle)',
        background: 'var(--bg-level-1)',
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '4px 8px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
          background: 'transparent', color: 'var(--text-secondary)',
          border: '0.5px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand-teal)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
      >
        <ChevronLeft size={12} strokeWidth={1.5} />
        Retour
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', fontFamily: fInter, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fInter, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
