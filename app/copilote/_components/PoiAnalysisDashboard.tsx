'use client';

import { useEffect, useRef } from 'react';
import type { NetworkCoverageData } from '@/types/spatial';

// ── Palette couleurs par rang ──────────────────────────────────────────────────
const PALETTE = [
  '#6366f1', '#34d399', '#fbbf24', '#f87171',
  '#c084fc', '#fb923c', '#38bdf8', '#a3e635',
];

const MODE_LABELS: Record<string, string> = {
  drive: 'voiture', walk: 'à pied', bike: 'vélo', network: 'voiture',
};

function shortName(name: string, max = 18) {
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

// ── Donut SVG animé par POI ───────────────────────────────────────────────────
function PoiDonut({
  pct, color, size = 70,
}: { pct: number; color: string; size?: number }) {
  const ref = useRef<SVGCircleElement>(null);
  const R    = (size - 12) / 2;
  const circ = 2 * Math.PI * R;
  const dash = (Math.min(pct, 100) / 100) * circ;

  useEffect(() => {
    const el = ref.current;
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
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      {/* Track */}
      <circle cx={size / 2} cy={size / 2} r={R}
        fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={9} />
      {/* Arc */}
      <circle ref={ref}
        cx={size / 2} cy={size / 2} r={R}
        fill="none" stroke={color} strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ}
        style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}
      />
    </svg>
  );
}

// ── Bar chart horizontal SVG ──────────────────────────────────────────────────
function HorizontalBar({
  items,
}: { items: { name: string; audience: number; color: string }[] }) {
  const max = Math.max(...items.map(i => i.audience), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {items.map((item, i) => {
        const pct = (item.audience / max) * 100;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Rang */}
            <div style={{
              width: 17, height: 17, borderRadius: 4,
              background: item.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, color: '#fff', fontWeight: 700, flexShrink: 0,
              boxShadow: `0 0 6px ${item.color}66`,
            }}>{i + 1}</div>

            {/* Nom + barre */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, color: 'rgba(255,255,255,0.6)',
                marginBottom: 3, overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                {shortName(item.name, 22)}
              </div>
              <div style={{
                height: 5, background: 'rgba(255,255,255,0.06)',
                borderRadius: 3, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  background: item.color,
                  width: 0,
                  opacity: 0.85,
                  animation: `poiBarGrow 1s ${0.1 + i * 0.07}s cubic-bezier(0.4,0,0.2,1) forwards`,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ['--bw' as any]: `${pct}%`,
                }} />
              </div>
            </div>

            {/* Valeur */}
            <div style={{
              fontSize: 10, color: item.color, fontFamily: 'monospace',
              flexShrink: 0, minWidth: 50, textAlign: 'right', fontWeight: 600,
            }}>
              {item.audience.toLocaleString('fr-FR')}
            </div>
          </div>
        );
      })}
      <style>{`
        @keyframes poiBarGrow {
          from { width: 0; }
          to   { width: var(--bw); }
        }
      `}</style>
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────
export function PoiAnalysisDashboard({ data }: { data: NetworkCoverageData }) {
  const breakdown = data.breakdown_by_poi ?? [];
  const totalPop  = data.total_pop ?? 0;
  const best      = breakdown[0];
  const modeLabel = MODE_LABELS[data.mode] ?? data.mode;

  const items = breakdown.map((b, i) => ({
    name:     b.name,
    audience: b.audience,
    color:    PALETTE[i % PALETTE.length],
    pct:      totalPop > 0 ? Math.round((b.audience / totalPop) * 100) : 0,
  }));

  // Grille de donuts : 3 colonnes max
  const donutCols = Math.min(items.length, items.length <= 2 ? 2 : 3);

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

      {/* ── En-tête ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          color: '#a5b4fc', fontWeight: 700, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3,
        }}>
          Tableau de bord — potentiel par point
        </div>
        <div style={{ color: '#818cf8', fontWeight: 800, fontSize: 15 }}>
          {data.poi_category}
          <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, fontSize: 12 }}>
            {' '}· {data.travel_time_minutes} min {modeLabel}
          </span>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 10, marginTop: 2 }}>
          {data.nb_pois} points
          {data.geo_scope && <> · {data.geo_scope}</>}
          {' · '}<span style={{ color: '#34d399' }}>{data.target_demo_label}</span>
          {data.from_cache && (
            <span style={{
              marginLeft: 6, background: 'rgba(99,102,241,0.18)',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 3, padding: '0 5px', fontSize: 9, color: '#a5b4fc',
            }}>cache</span>
          )}
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>

        {/* Total */}
        <div style={{
          background: 'rgba(99,102,241,0.1)',
          border: '1px solid rgba(99,102,241,0.22)',
          borderRadius: 9, padding: '10px 12px',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Total cible touchée
          </div>
          <div style={{ color: '#6366f1', fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em', lineHeight: 1 }}>
            {data.coverage.toLocaleString('fr-FR')}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, marginTop: 4 }}>
            {data.target_demo_label}
          </div>
          {totalPop > 0 && (
            <div style={{ marginTop: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>pénétration</span>
                <span style={{ fontSize: 9, color: '#a5b4fc', fontWeight: 600 }}>{data.penetration_rate ?? 0}%</span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: 'linear-gradient(90deg,#6366f1,#818cf8)',
                  width: 0,
                  animation: 'poiBarGrow 1.2s 0.2s cubic-bezier(0.4,0,0.2,1) forwards',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ['--bw' as any]: `${Math.min(data.penetration_rate ?? 0, 100)}%`,
                }} />
              </div>
            </div>
          )}
        </div>

        {/* Meilleur point */}
        <div style={{
          background: 'rgba(52,211,153,0.07)',
          border: '1px solid rgba(52,211,153,0.2)',
          borderRadius: 9, padding: '10px 12px',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Meilleur point
          </div>
          <div style={{ color: '#34d399', fontWeight: 700, fontSize: 13, lineHeight: 1.3, wordBreak: 'break-word' }}>
            {best ? shortName(best.name, 24) : '—'}
          </div>
          {best && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 5 }}>
              {best.audience.toLocaleString('fr-FR')} personnes
            </div>
          )}
          {items.length > 1 && (
            <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9, marginTop: 3 }}>
              {Math.round((items[0].audience / Math.max(items[items.length - 1].audience, 1)) * 10) / 10}× le dernier
            </div>
          )}
        </div>
      </div>

      {/* ── Bar chart comparatif ── */}
      {items.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 9, color: 'rgba(255,255,255,0.28)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 9,
          }}>
            Comparatif audience ({data.target_demo_label})
          </div>
          <HorizontalBar items={items} />
        </div>
      )}

      {/* ── Grille de donuts par POI ── */}
      {items.length > 0 && totalPop > 0 && (
        <div>
          <div style={{
            fontSize: 9, color: 'rgba(255,255,255,0.28)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 9,
          }}>
            Taux de couverture individuel (% pop. zone)
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${donutCols}, 1fr)`,
            gap: 8,
          }}>
            {items.map((item, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.025)',
                border: `1px solid ${item.color}33`,
                borderRadius: 9,
                padding: '10px 8px 8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
              }}>
                {/* Donut */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PoiDonut pct={item.pct} color={item.color} size={64} />
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ color: item.color, fontWeight: 800, fontSize: 13, lineHeight: 1 }}>
                      {item.pct}%
                    </span>
                  </div>
                </div>
                {/* Nom */}
                <div style={{
                  fontSize: 9, color: 'rgba(255,255,255,0.6)',
                  textAlign: 'center', lineHeight: 1.35,
                  wordBreak: 'break-word',
                }}>
                  {shortName(item.name, 20)}
                </div>
                {/* Audience */}
                <div style={{
                  fontSize: 9, color: item.color,
                  fontFamily: 'monospace', fontWeight: 600,
                }}>
                  {item.audience.toLocaleString('fr-FR')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
