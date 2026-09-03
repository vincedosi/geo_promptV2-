/**
 * Helpers de style du FilterPanel — extraits tels quels du composant monolithe
 * (2026-09-03). Purs : ils ne dépendent que des tokens, jamais du state, ce
 * qui permet aux sous-composants de section de les partager.
 */

import type React from 'react';
import { C, fInter } from './tokens';

/** '#4ecdc4' → '78,205,196'. Repli sur le gris clair si le format est inattendu. */
export const hexToRgb = (hex: string): string => {
  if (!hex.startsWith('#') || hex.length < 7) return '240,240,240';
  return `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;
};

export const pill = (active: boolean, color: string) => ({
  fontFamily: fInter, fontSize: 11, padding: '5px 9px',
  background: active ? `rgba(${hexToRgb(color)},0.12)` : C.bgInput,
  border: `0.5px solid ${active ? color : C.border}`, borderRadius: 4,
  color: active ? color : C.textDim, cursor: 'pointer', transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)', flexShrink: 0 as const,
});

export const primaryBtn = (color: string, disabled = false) => ({
  fontFamily: fInter, fontSize: 12,
  padding: '9px 14px', width: '100%',
  background: disabled ? 'rgba(255,255,255,0.03)' : `rgba(${hexToRgb(color)},0.10)`,
  border: `0.5px solid ${disabled ? C.border : color}`, borderRadius: 4,
  color: disabled ? C.textDim : color, cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.55 : 1, transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
});

export const labelStyle = {
  fontFamily: fInter, fontSize: 11, fontWeight: 500 as const,
  color: C.textSec, marginBottom: 6,
};

export const inputStyle: React.CSSProperties = {
  fontFamily: fInter, fontSize: 13, background: C.bgInput,
  border: `0.5px solid ${C.border}`, borderRadius: 4,
  color: C.text, padding: '7px 10px', outline: 'none', width: '100%',
  transition: 'border-color 300ms var(--ease-out)',
};

export const inputFocusHandlers = {
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; },
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = C.border; },
};
