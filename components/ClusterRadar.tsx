'use client';

/**
 * ClusterRadar — SVG radar chart for Filosofi cluster profiles.
 * Supports optional France national average reference line (dashed grey).
 * Uses the 16 canonical feature names from clustering_poi_filosofi.py.
 */

const fMichroma = "'Michroma','Orbitron',sans-serif";
const fMono     = "'JetBrains Mono','Fira Mono',monospace";

export const FEAT_SHORT: Record<string, string> = {
  pct_0_17:           '0-17',
  pct_18_39:          '18-39',
  pct_40_54:          '40-54',
  pct_55_79:          '55-79',
  pct_80p:            '80+',
  revenu_moyen:       'Revenu',
  taux_pauvrete:      'Précarité',
  taux_proprietaires: 'Proprios',
  taux_collectif:     'Collectif',
  taux_hlm:           'HLM',
  taux_isoles:        'Isolés',
  taux_grandes_fam:   'Gdes fam',
  taux_mono_parental: 'Mono-par',
  taux_ancien:        'Anc 1945',
  taux_recent:        'Rés 1990+',
  surface_moyenne:    'Surface',
};

export const FEAT_LABEL: Record<string, string> = {
  pct_0_17:           '% 0-17 ans',
  pct_18_39:          '% 18-39 ans',
  pct_40_54:          '% 40-54 ans',
  pct_55_79:          '% 55-79 ans',
  pct_80p:            '% 80 ans et +',
  revenu_moyen:       'Revenu moyen / ind',
  taux_pauvrete:      'Taux de pauvreté',
  taux_proprietaires: 'Taux propriétaires',
  taux_collectif:     'Taux logement collectif',
  taux_hlm:           'Taux HLM / social',
  taux_isoles:        'Taux ménages isolés',
  taux_grandes_fam:   'Taux grandes familles',
  taux_mono_parental: 'Taux mono-parental',
  taux_ancien:        'Taux logements avant 1945',
  taux_recent:        'Taux logements après 1990',
  surface_moyenne:    'Surface moyenne logement (m²)',
};

export interface ClusterRadarProps {
  /** One profile object per cluster/series (Record<feature_name, value>) */
  profiles:    Record<string, number>[];
  /** One color per profile (hex string) */
  colors:      string[];
  /** One label per profile (shown in legend) */
  labels:      string[];
  /** Ordered list of feature keys to display (max 16, min 3) */
  featureKeys: string[];
  /** Optional France national avg profile — shown as dashed grey reference */
  reference?:  Record<string, number>;
  /** SVG size in px (default 200) */
  size?:       number;
  /** Show legend (default true) */
  showLegend?: boolean;
  /** Show France average reference in legend (default true if reference given) */
  showRefLegend?: boolean;
}

export function ClusterRadar({
  profiles,
  colors,
  labels,
  featureKeys,
  reference,
  size = 200,
  showLegend = true,
  showRefLegend,
}: ClusterRadarProps) {
  const N    = Math.min(featureKeys.length, 16);
  const keys = featureKeys.slice(0, N);

  if (N < 3 || profiles.length === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r  = size * 0.33;
  const rL = size * 0.46;

  const angles = keys.map((_, i) => (i / N) * 2 * Math.PI - Math.PI / 2);

  // Normalize per feature: max across all profiles + reference
  const maxVals: Record<string, number> = {};
  for (const k of keys) {
    const vals = profiles.map(p => p[k] ?? 0);
    if (reference) vals.push(reference[k] ?? 0);
    maxVals[k] = Math.max(...vals, 0.001);
  }

  function toXY(angle: number, val: number, radius = r) {
    return {
      x: cx + radius * val * Math.cos(angle),
      y: cy + radius * val * Math.sin(angle),
    };
  }

  function profilePath(prof: Record<string, number>) {
    const pts = keys.map((k, i) => {
      const v = Math.min(1, (prof[k] ?? 0) / maxVals[k]);
      const { x, y } = toXY(angles[i], v);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
  }

  function gridPoly(frac: number) {
    return keys.map((_, i) => {
      const { x, y } = toXY(angles[i], frac);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  const legendEntries: { label: string; color: string; dashed?: boolean }[] = showLegend
    ? labels.map((lbl, i) => ({ label: lbl, color: colors[i] }))
    : [];
  if (reference && (showRefLegend ?? true)) {
    legendEntries.push({ label: 'Moy. France', color: '#6b7280', dashed: true });
  }

  return (
    <svg width={size} height={size} style={{ display: 'block', margin: '0 auto' }}>
      {/* Grid rings */}
      {[0.25, 0.5, 0.75, 1].map(f => (
        <polygon key={f} points={gridPoly(f)}
          fill="none"
          stroke={f === 1 ? '#3a2a50' : '#221530'}
          strokeWidth={f === 1 ? 0.8 : 0.4}
        />
      ))}
      {/* Axes */}
      {keys.map((_, i) => {
        const { x, y } = toXY(angles[i], 1);
        return (
          <line key={i}
            x1={cx.toFixed(1)} y1={cy.toFixed(1)}
            x2={x.toFixed(1)}  y2={y.toFixed(1)}
            stroke="#2a1a40" strokeWidth={0.5}
          />
        );
      })}
      {/* France reference (dashed grey, drawn behind cluster profiles) */}
      {reference && (
        <path
          d={profilePath(reference)}
          fill="rgba(107,114,128,0.08)"
          stroke="#6b7280"
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      )}
      {/* Cluster profiles */}
      {profiles.map((prof, pi) => (
        <path key={pi} d={profilePath(prof)}
          fill={colors[pi] + '28'}
          stroke={colors[pi]}
          strokeWidth={1.5}
        />
      ))}
      {/* Axis labels */}
      {keys.map((k, i) => {
        const { x, y } = toXY(angles[i], 1, rL);
        const anchor   = x < cx - 4 ? 'end' : x > cx + 4 ? 'start' : 'middle';
        const baseline = y < cy - 4 ? 'auto' : y > cy + 4 ? 'hanging' : 'middle';
        const short    = FEAT_SHORT[k] ?? k.slice(0, 9);
        return (
          <text key={i}
            x={x.toFixed(1)} y={y.toFixed(1)}
            textAnchor={anchor} dominantBaseline={baseline}
            fontSize={7} fill="#8888aa"
            fontFamily={fMichroma} letterSpacing="0.05em"
          >
            {short}
          </text>
        );
      })}
      {/* Legend */}
      {legendEntries.map((e, li) => (
        <g key={li} transform={`translate(4, ${size - 10 - li * 12})`}>
          {e.dashed
            ? <line x1={0} y1={3.5} x2={7} y2={3.5}
                stroke={e.color} strokeWidth={1.5} strokeDasharray="3 2" />
            : <rect width={7} height={7} fill={e.color} rx={1} />
          }
          <text x={10} y={6} fontSize={7} fill="#8888aa" fontFamily={fMichroma}>
            {e.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
