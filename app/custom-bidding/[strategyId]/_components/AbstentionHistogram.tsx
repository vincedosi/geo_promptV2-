'use client';

/**
 * AbstentionHistogram — distribution des impressions par tranche d'abstention.
 *
 * Bin = 5 tranches de taux d'abstention (<25%, 25-35%, 35-45%, 45-55%, >55%).
 * Chaque bin est colorisé en background avec la palette chaleur saturée
 * (jaune pâle → rouge profond), ce qui donne immédiatement le sens narratif :
 * la masse d'impressions doit migrer vers la droite (zones rouges).
 *
 * Deux barres groupées par bin :
 *   - GRIS : impressions réelles (sans MAGELIAN)
 *   - TEAL VIF : impressions simulées (avec MAGELIAN)
 *
 * Annotations de synthèse : "X% des impressions sur abstention >35% → Y%".
 */
import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, LabelList,
} from 'recharts';
import { buildZoneDeltas, buildAbstentionBins, type AbstentionBin } from '@/lib/bidding-ml/flow-helpers';
import { metricFields, getMetricLabels, type PrimaryMetric } from '@/lib/bidding-ml/metric-labels';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const COLOR_BEFORE = '#a0a0a0';
const COLOR_AFTER = '#06d6a0';

interface Props {
  geojson: GeoJSON.FeatureCollection | null;
  insseValues: Record<string, number> | null;
  metric: PrimaryMetric;
  variableLabel: string | null;
}

const fmtCount = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k`
  : Math.round(n).toLocaleString('fr-FR');

const fmtPct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function AbstentionHistogram({ geojson, insseValues, metric, variableLabel }: Props) {
  const labels = getMetricLabels(metric);
  const fields = metricFields(metric);
  const deltaField = `${metric}_delta`;

  const bins: AbstentionBin[] = useMemo(() => {
    const zones = buildZoneDeltas(geojson, insseValues, deltaField, fields.real, fields.sim);
    return buildAbstentionBins(zones);
  }, [geojson, insseValues, deltaField, fields.real, fields.sim]);

  // Données prêtes pour Recharts
  const data = useMemo(
    () => bins.map(b => ({
      label: b.label,
      narrative: b.narrative,
      real: Math.round(b.real),
      sim: Math.round(b.sim),
      share_real: b.share_real,
      share_sim: b.share_sim,
      color: b.color,
    })),
    [bins],
  );

  // Top quartile = bins ≥35% (les 3 derniers bins)
  const topQReal = bins.slice(2).reduce((acc, b) => acc + b.share_real, 0);
  const topQSim = bins.slice(2).reduce((acc, b) => acc + b.share_sim, 0);
  const deltaTopQ = (topQSim - topQReal) * 100;

  if (data.every(d => d.real === 0 && d.sim === 0)) return null;

  return (
    <div style={{ margin: '12px', padding: '14px 16px', background: 'var(--bg-level-1)', border: '0.5px solid var(--border-subtle)', borderRadius: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
          <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
            Distribution des {labels.name.toLowerCase()} par tranche de {variableLabel ?? "taux d'abstention"}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
          <LegendDot color={COLOR_BEFORE} label="sans algo" />
          <LegendDot color={COLOR_AFTER} label="avec MAGELIAN" />
        </div>
      </div>

      {/* Annotation narrative top */}
      <div style={{ fontSize: 11, fontFamily: fInter, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
        Sur les zones à <strong style={{ color: '#ff8c1a' }}>forte abstention (≥35%)</strong> :
        avant <strong style={{ color: 'var(--text-primary)' }}>{fmtPct(topQReal)}</strong> des {labels.name.toLowerCase()},
        après <strong style={{ color: COLOR_AFTER }}>{fmtPct(topQSim)}</strong>
        {' '}
        <span style={{ color: deltaTopQ >= 0 ? COLOR_AFTER : '#ef4444', fontFamily: fMono, fontSize: 11 }}>
          ({deltaTopQ >= 0 ? '+' : ''}{deltaTopQ.toFixed(1)} pts)
        </span>
      </div>

      {/* Bandeau bins colorés (palette chaleur narrative au-dessus du chart) */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, 1fr)`, gap: 4, marginBottom: 4 }}>
        {data.map(d => (
          <div
            key={d.label}
            style={{
              padding: '4px 6px',
              background: d.color,
              borderRadius: 4,
              textAlign: 'center',
              fontFamily: fInter, fontSize: 9, fontWeight: 600,
              color: d.label === '<25%' ? '#5a4a00' : d.label === '25-35%' ? '#6b3500' : '#ffffff',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {d.narrative}
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 18, right: 8, bottom: 28, left: 12 }} barCategoryGap="22%">
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: fMono }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-default)' }}
              label={{ value: variableLabel ?? "taux d'abstention", position: 'bottom', fill: 'var(--text-secondary)', fontSize: 11, fontFamily: fInter, offset: 12 }}
            />
            <YAxis
              tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: fMono }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-default)' }}
              tickFormatter={fmtCount}
              width={60}
              label={{ value: labels.name, angle: -90, position: 'left', fill: 'var(--text-secondary)', fontSize: 11, fontFamily: fInter, offset: 0 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--bg-level-2)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as typeof data[number];
                return (
                  <div style={{ background: 'var(--bg-level-1)', border: `0.5px solid ${d.color}`, borderRadius: 6, padding: '8px 10px', fontFamily: fInter, fontSize: 11 }}>
                    <div style={{ color: 'var(--text-primary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />
                      <span style={{ fontWeight: 500 }}>{d.label} — {d.narrative}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontFamily: fMono, fontSize: 11 }}>
                      <span style={{ color: COLOR_BEFORE }}>sans algo</span>
                      <span style={{ color: 'var(--text-primary)' }}>{fmtCount(d.real)} <span style={{ color: 'var(--text-secondary)' }}>({fmtPct(d.share_real)})</span></span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontFamily: fMono, fontSize: 11, marginTop: 2 }}>
                      <span style={{ color: COLOR_AFTER }}>avec algo</span>
                      <span style={{ color: 'var(--text-primary)' }}>{fmtCount(d.sim)} <span style={{ color: 'var(--text-secondary)' }}>({fmtPct(d.share_sim)})</span></span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontFamily: fMono, fontSize: 11, marginTop: 4, paddingTop: 4, borderTop: '0.5px solid var(--border-subtle)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Δ</span>
                      <span style={{ color: d.sim - d.real >= 0 ? COLOR_AFTER : '#ef4444', fontWeight: 600 }}>
                        {d.sim - d.real >= 0 ? '+' : ''}{fmtCount(d.sim - d.real)}
                      </span>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="real" fill={COLOR_BEFORE} radius={[3, 3, 0, 0]} maxBarSize={60} isAnimationActive={false}>
              <LabelList
                dataKey="share_real"
                position="top"
                content={(props) => {
                  const { x, y, width, value } = props as { x?: number; y?: number; width?: number; value?: number };
                  if (x === undefined || y === undefined || width === undefined || value === undefined) return null;
                  return (
                    <text x={x + width / 2} y={y - 6} fill={COLOR_BEFORE} textAnchor="middle" fontSize={10} fontFamily={fMono}>
                      {fmtPct(value)}
                    </text>
                  );
                }}
              />
            </Bar>
            <Bar dataKey="sim" fill={COLOR_AFTER} radius={[3, 3, 0, 0]} maxBarSize={60} isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} fill={COLOR_AFTER} />)}
              <LabelList
                dataKey="share_sim"
                position="top"
                content={(props) => {
                  const { x, y, width, value } = props as { x?: number; y?: number; width?: number; value?: number };
                  if (x === undefined || y === undefined || width === undefined || value === undefined) return null;
                  return (
                    <text x={x + width / 2} y={y - 6} fill={COLOR_AFTER} textAnchor="middle" fontSize={10} fontFamily={fMono} fontWeight={600}>
                      {fmtPct(value)}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Annotation finale */}
      <div style={{ fontSize: 11, fontFamily: fInter, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5, paddingTop: 10, borderTop: '0.5px solid var(--border-subtle)' }}>
        Lecture : pour chaque tranche d&apos;abstention, on compare la part des {labels.name.toLowerCase()} servies <strong style={{ color: COLOR_BEFORE }}>sans algo</strong> et <strong style={{ color: COLOR_AFTER }}>avec MAGELIAN</strong>. La masse migre des bins gauches (faible abstention) vers les bins droits (forte abstention).
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontFamily: fInter, color: 'var(--text-secondary)' }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}
