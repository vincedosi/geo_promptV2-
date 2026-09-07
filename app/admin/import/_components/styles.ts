/**
 * Styles inline des étapes du wizard d'import universel — extraits de page.tsx
 * (2026-09-03), où ils étaient reconstruits à chaque render.
 *
 * Purs : ils ne dépendent que des tokens de ./shared, jamais du state.
 */

import type React from 'react';
import { C, fontInter, fontMono } from './shared';

export const sLabel: React.CSSProperties = {
  fontFamily: fontInter,
  fontSize: 12,
  fontWeight: 500,
  color: C.text,
  margin: 0,
  display: 'block',
  marginBottom: 6,
};

export const inputStyle: React.CSSProperties = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 2,
  color: C.text,
  fontFamily: fontMono,
  fontSize: 11,
  padding: '6px 10px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

export const btnSuccess: React.CSSProperties = {
  fontFamily: fontInter,
  fontSize: 12,
  fontWeight: 500,
  background: C.greenDim,
  border: `1px solid rgba(61,255,160,0.3)`,
  borderRadius: 2,
  color: C.green,
  padding: '7px 16px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

export const btnDanger: React.CSSProperties = {
  fontFamily: fontInter,
  fontSize: 12,
  fontWeight: 500,
  background: C.redDim,
  border: `1px solid rgba(248,113,113,0.3)`,
  borderRadius: 2,
  color: C.red,
  padding: '7px 16px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

export const btnGhost: React.CSSProperties = {
  fontFamily: fontInter,
  fontSize: 12,
  fontWeight: 500,
  background: 'transparent',
  border: `1px solid ${C.border}`,
  borderRadius: 2,
  color: C.textDim,
  padding: '4px 10px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

export const card: React.CSSProperties = {
  background: C.bgElevated,
  border: `1px solid ${C.border}`,
  borderRadius: 2,
};

export const cardHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  borderBottom: `1px solid ${C.border}`,
};

export const cardBody: React.CSSProperties = {
  padding: '14px',
};

export const stepNum: React.CSSProperties = {
  fontFamily: fontMono,
  fontSize: 11,
  color: C.accent,
  fontWeight: 700,
};

export const cardTitle: React.CSSProperties = {
  fontFamily: fontInter,
  fontSize: 12,
  fontWeight: 500,
  color: C.text,
};

const badge = (color: string, bg: string, border: string): React.CSSProperties => ({
  fontFamily: fontInter,
  fontSize: 11,
  fontWeight: 500,
  background: bg,
  border: `1px solid ${border}`,
  borderRadius: 2,
  color: color,
  padding: '2px 6px',
  display: 'inline-block',
});

export const badgeGreen = badge(C.green, C.greenDim, 'rgba(61,255,160,0.3)');
export const badgeWarn = badge(C.warn, C.warnDim, 'rgba(251,191,36,0.3)');
export const badgeRed = badge(C.red, C.redDim, 'rgba(248,113,113,0.3)');
export const badgeAccent = badge(C.accent, C.accentDim, C.borderLight);

/** Couleur associée au statut de géocodage BAN. */
export const statusColor = (s: string) =>
  s === 'green' ? C.green : s === 'orange' ? C.warn : C.red;

/** Libellé court associé au statut de géocodage BAN. */
export const statusLabel = (s: string) =>
  s === 'green' ? 'OK' : s === 'orange' ? 'Approx.' : 'Echec';
