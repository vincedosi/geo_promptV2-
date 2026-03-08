'use client';

import { useEffect, useRef } from 'react';
import type { NetworkCoverageData } from '@/types/spatial';
import { PoiAnalysisDashboard } from './PoiAnalysisDashboard';

interface NetworkCoverageReportProps {
  data: NetworkCoverageData;
}

const MODE_LABELS: Record<string, string> = {
  drive:   'voiture',
  walk:    'à pied',
  bike:    'vélo',
  network: 'voiture',
};

// ── Donut SVG animé ──────────────────────────────────────────────────────────
function DonutChart({ pct, size = 80 }: { pct: number; size?: number }) {
  const circleRef = useRef<SVGCircleElement>(null);
  const R = (size - 14) / 2;
  const circ = 2 * Math.PI * R;
  const dash = (pct / 100) * circ;

  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    el.style.strokeDashoffset = String(circ);
    el.style.transition = 'none';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)';
        el.style.strokeDashoffset = String(circ - dash);
      });
    });
  }, [pct, circ, dash]);

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      {/* Track */}
      <circle
        cx={size / 2} cy={size / 2} r={R}
        fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={10}
      />
      {/* Progress */}
      <circle
        ref={circleRef}
        cx={size / 2} cy={size / 2} r={R}
        fill="none"
        stroke="url(#donutGrad)"
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ}
      />
      <defs>
        <linearGradient id="donutGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Bar chart horizontal (CSS) ───────────────────────────────────────────────
function BarChart({ items }: { items: { name: string; audience: number }[] }) {
  const max = items[0]?.audience ?? 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((item, i) => {
        const pct = (item.audience / max) * 100;
        const shortName = item.name.length > 22 ? item.name.slice(0, 21) + '…' : item.name;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{
              width: 16, height: 16, borderRadius: 3,
              background: i === 0 ? '#6366f1' : i === 1 ? '#818cf8' : 'rgba(99,102,241,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, color: '#fff', fontWeight: 700, flexShrink: 0,
            }}>
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, color: 'rgba(255,255,255,0.65)',
                marginBottom: 2, overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                {shortName}
              </div>
              <div style={{
                height: 5, background: 'rgba(255,255,255,0.06)',
                borderRadius: 3, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  background: i === 0
                    ? 'linear-gradient(90deg,#6366f1,#818cf8)'
                    : 'rgba(99,102,241,0.5)',
                  width: 0,
                  animation: `barGrow 1s ${0.1 + i * 0.08}s cubic-bezier(0.4,0,0.2,1) forwards`,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ['--bar-w' as any]: `${pct}%`,
                }} />
              </div>
            </div>
            <div style={{
              fontSize: 9, color: '#a5b4fc', fontFamily: 'monospace',
              flexShrink: 0, minWidth: 44, textAlign: 'right',
            }}>
              {item.audience.toLocaleString('fr-FR')}
            </div>
          </div>
        );
      })}
      <style>{`
        @keyframes barGrow {
          from { width: 0; }
          to   { width: var(--bar-w); }
        }
      `}</style>
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────
export function NetworkCoverageReport({ data }: NetworkCoverageReportProps) {
  const breakdown = data.breakdown_by_poi ?? [];
  const totalPop  = data.total_pop ?? 0;

  // Dashboard complet si on a plusieurs POI avec données individuelles
  if (breakdown.length >= 2 && totalPop > 0) {
    return <PoiAnalysisDashboard data={data} />;
  }

  const modeLabel     = MODE_LABELS[data.mode] ?? data.mode;
  const pct           = data.penetration_rate ?? 0;
  const hasBreakdown  = breakdown.length > 0;
  const hasDonut      = totalPop > 0;

  return (
    <div style={{
      margin: '8px 0',
      background: 'linear-gradient(135deg, rgba(17,17,27,0.97) 0%, rgba(30,27,75,0.97) 100%)',
      border: '1px solid rgba(99,102,241,0.35)',
      borderRadius: 12,
      padding: '14px',
      fontSize: 12,
      fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ color: '#a5b4fc', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            Couverture réseau
          </div>
          <div style={{ color: '#818cf8', fontWeight: 800, fontSize: 15 }}>
            {data.poi_category}
            <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400, fontSize: 12 }}>
              {' '}· {data.travel_time_minutes} min {modeLabel}
            </span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 2 }}>
            {data.nb_pois} points ·{' '}
            <span style={{ color: '#34d399' }}>{data.target_demo_label}</span>
            {data.geo_scope && <span> · {data.geo_scope}</span>}
            {data.from_cache && (
              <span style={{ marginLeft: 6, background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 3, padding: '0px 5px', fontSize: 9, color: '#a5b4fc' }}>
                cache
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── KPI + Donut ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        background: 'rgba(99,102,241,0.08)',
        border: '1px solid rgba(99,102,241,0.18)',
        borderRadius: 10, padding: '12px 14px',
        marginBottom: hasBreakdown ? 12 : 0,
      }}>
        {hasDonut && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <DonutChart pct={pct} size={76} />
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ color: '#a5b4fc', fontWeight: 800, fontSize: 13, lineHeight: 1 }}>
                {pct.toLocaleString('fr-FR')}%
              </div>
            </div>
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#6366f1', fontWeight: 800, fontSize: 26, letterSpacing: '-0.02em', lineHeight: 1 }}>
            {data.coverage.toLocaleString('fr-FR')}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 3 }}>
            {data.target_demo_label} couverts
          </div>
          {hasDonut && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 4 }}>
              sur {totalPop.toLocaleString('fr-FR')} dans la zone
            </div>
          )}
          {hasDonut && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Taux de pénétration régional
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: 'linear-gradient(90deg,#6366f1,#818cf8)',
                  width: 0,
                  animation: 'barGrow 1.2s 0.2s cubic-bezier(0.4,0,0.2,1) forwards',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ['--bar-w' as any]: `${Math.min(pct, 100)}%`,
                }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Leaderboard ── */}
      {hasBreakdown && (
        <div>
          <div style={{
            fontSize: 9, color: 'rgba(255,255,255,0.3)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            marginBottom: 8,
          }}>
            Top {breakdown.length} points par audience
          </div>
          <BarChart items={breakdown} />
        </div>
      )}
    </div>
  );
}
