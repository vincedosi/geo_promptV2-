/**
 * MAGELIAN — briques presentationnelles du back-office Data Sources.
 *
 * Extraites de app/admin/sources/page.tsx (refactor du 31/08/2026).
 * Sans etat et sans effet : un rendu deterministe a partir des props.
 */
import { C, fontInter } from '../_lib/theme';

/** Indicateur de chargement inline, aligne sur la taille du texte courant. */
export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/**
 * Badge de type de source. `category` n'est lu que pour les POI et `regie`
 * que pour les panneaux ; un type inconnu retombe sur un badge neutre.
 */
export function typeBadge(type: string, category?: string, regie?: string) {
  type BadgeKey = 'poi' | 'panneaux' | 'carreaux';
  const colors: Record<BadgeKey, { color: string; bg: string; border: string }> = {
    poi:      { color: C.accent, bg: C.accentDim, border: C.borderLight },
    panneaux: { color: C.warn,   bg: C.warnDim,   border: `${C.warn}44` },
    carreaux: { color: C.green,  bg: C.greenDim,  border: `${C.green}44` },
  };
  const label = type === 'poi'
    ? `POI${category ? ` — ${category}` : ''}`
    : type === 'panneaux'
      ? `OOH${regie ? ` — ${regie}` : ''}`
      : 'Carreaux INSEE';
  const style = colors[type as BadgeKey] || { color: C.textDim, bg: 'transparent', border: C.border };
  return (
    <span style={{
      fontFamily: fontInter,
      fontSize: 11,
      fontWeight: 500,
      color: style.color,
      background: style.bg,
      border: `0.5px solid ${style.border}`,
      padding: '2px 7px',
      borderRadius: 2,
      whiteSpace: 'nowrap' as const,
      transition: 'all 0.2s ease',
    }}>
      {label}
    </span>
  );
}

/** Date au format fr-FR jour/mois/annee + heure:minute. */
export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
