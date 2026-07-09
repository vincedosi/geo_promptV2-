'use client';

import type { ReactNode } from 'react';

// ── Design tokens (DESIGN_SYSTEM.md — jamais de hex en dur) ─────────────────────
const C = {
  teal30: 'var(--brand-teal-30)',
  teal: 'var(--brand-teal)',
  tealDim: 'var(--brand-teal-10)',
  textSec: 'var(--text-secondary)',
  textDim: 'var(--text-tertiary)',
};
// Pas de token --brand-teal-06 dans globals.css : le fond du mémo est à 7% dans
// la maquette (--teal06), plus léger que --brand-teal-10 (10%). rgba autorisé
// par la consigne quand aucun tint précis n'existe (jamais de hex nu).
const TEAL_BG_07 = 'rgba(78,205,196,0.07)';

const fInter = "'Inter', system-ui, sans-serif";

interface StepMemoProps {
  /** Paragraphes du mémo, rendus en <p>. Préférer ReactNode (ex: <strong>) plutôt que dangerouslySetInnerHTML. */
  paragraphs: ReactNode[];
  /** Ligne "astuce" 💡 séparée par une bordure teal. */
  tip: string;
  /** Mini-visualisation en barres optionnelle ; une valeur >= 4 est mise en avant. */
  mini?: number[];
}

export function StepMemo({ paragraphs, tip, mini }: StepMemoProps) {
  return (
    <aside
      style={{
        background: TEAL_BG_07,
        border: `0.5px solid ${C.teal30}`,
        borderRadius: 12,
        padding: '16px 16px 18px',
        fontFamily: fInter,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span
          style={{
            width: 22, height: 22, borderRadius: 6, background: C.tealDim,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.teal, flexShrink: 0,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M9 18h6M10 21h4M12 3a6 6 0 0 1 4 10.5c-.7.7-1 1.3-1 2.5H9c0-1.2-.3-1.8-1-2.5A6 6 0 0 1 12 3z" />
          </svg>
        </span>
        <b style={{ fontSize: 12, fontWeight: 600, color: C.teal, letterSpacing: '0.02em' }}>
          À quoi sert cette étape
        </b>
      </div>

      {paragraphs.map((p, i) => (
        <p
          key={i}
          style={{
            margin: i === paragraphs.length - 1 ? 0 : '0 0 10px',
            fontSize: 12.5, color: C.textSec, lineHeight: 1.6,
          }}
        >
          {p}
        </p>
      ))}

      {mini && mini.length > 0 && (
        <div style={{ display: 'flex', gap: 5, margin: '12px 0 2px' }}>
          {mini.map((v, i) => (
            <div
              key={i}
              style={{
                height: 26, borderRadius: 4, flex: 1,
                background: v >= 4 ? C.teal : C.tealDim,
                opacity: v >= 4 ? 1 : 0.5,
              }}
            />
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 12, paddingTop: 12, borderTop: `0.5px solid ${C.teal30}`,
          fontSize: 11.5, color: C.textDim, display: 'flex', gap: 8,
        }}
      >
        <span aria-hidden>💡</span>
        <span>{tip}</span>
      </div>
    </aside>
  );
}
