/**
 * MAGELIAN — styles partages du back-office Data Sources.
 *
 * Extraits de app/admin/sources/page.tsx (refactor du 31/08/2026), ou ils
 * etaient redeclares a chaque rendu du composant. Constantes de module :
 * evaluees une fois, et importables par n'importe quel panneau sans passer
 * par une prop.
 */
import { C, fontMono, fontInter } from './theme';

export const cardStyle: React.CSSProperties = {
  background: C.bgElevated,
  border: `0.5px solid ${C.border}`,
  borderRadius: 2,
  overflow: 'hidden',
  transition: 'all 0.2s ease',
};

export const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  borderBottom: `1px solid ${C.border}`,
  background: C.bgSurface,
  borderLeft: '2px solid rgba(78,205,196,0.25)',
};

export const sectionLabelStyle: React.CSSProperties = {
  fontFamily: fontInter,
  fontSize: 12,
  fontWeight: 500,
  color: C.text,
};

export const btnGhostStyle: React.CSSProperties = {
  background: 'transparent',
  border: `0.5px solid ${C.border}`,
  borderRadius: 2,
  color: C.textDim,
  fontFamily: fontInter,
  fontSize: 12,
  fontWeight: 500,
  padding: '4px 10px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  transition: 'all 0.2s ease',
};

export const btnPrimaryStyle: React.CSSProperties = {
  background: C.accentDim,
  border: `0.5px solid ${C.borderLight}`,
  borderRadius: 2,
  color: 'var(--bg-primary)',
  fontFamily: fontInter,
  fontSize: 12,
  fontWeight: 500,
  padding: '6px 14px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  width: '100%',
  justifyContent: 'center',
  transition: 'all 0.2s ease',
};

export const btnDangerStyle: React.CSSProperties = {
  background: C.redDim,
  border: `0.5px solid ${C.red}44`,
  borderRadius: 2,
  color: C.red,
  fontFamily: fontInter,
  fontSize: 12,
  fontWeight: 500,
  padding: '6px 14px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  width: '100%',
  justifyContent: 'flex-start',
  transition: 'all 0.2s ease',
};

export const inputStyle: React.CSSProperties = {
  background: C.bgSurface,
  border: `0.5px solid ${C.border}`,
  borderRadius: 2,
  color: C.text,
  fontFamily: fontMono,
  fontSize: 11,
  padding: '6px 10px',
  width: '100%',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.3s ease',
};
