'use client';

import { useState, useMemo, Fragment } from 'react';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface HeatmapCell {
  media: string;
  zone_code: string;
  zone_nom: string;
  impressions: number;
  pop_cible: number;
  pct_imp_media: number;
  pct_pop: number;
  ecart: number;
}

interface HeatmapData {
  medias: string[];
  zones: { code: string; nom: string }[];
  cells: HeatmapCell[];
}

interface MediaHeatmapProps {
  data: HeatmapData | null;
  loading: boolean;
  aggregation: string;
  metric?: 'impressions' | 'unique';
  onAggregationChange: (agg: string) => void;
  onCellClick?: (media: string, zoneCode: string) => void;
}

function getContrastText(r: number, g: number, b: number): string {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.45 ? '#1a1a1a' : '#f0f0f0';
}

function ecartColor(ecart: number, maxAbs: number): string {
  if (maxAbs === 0) return '#1a1a2e';
  const ratio = Math.min(Math.abs(ecart) / maxAbs, 1);
  const intensity = Math.round(ratio * 180);
  if (ecart > 0) return `rgb(${100 + intensity}, ${60 - ratio * 30}, ${60 - ratio * 30})`;
  if (ecart < 0) return `rgb(${40 - ratio * 20}, ${60 + intensity * 0.3}, ${130 + intensity * 0.4})`;
  return '#1a1a2e';
}

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString('fr-FR');
}

export function MediaHeatmap({ data, loading, aggregation, metric = 'impressions', onAggregationChange, onCellClick }: MediaHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<HeatmapCell | null>(null);
  const impLabel = metric === 'unique' ? 'Imp. uniques' : 'Imp.';

  const { cellMap, maxAbs, sortedMedias } = useMemo(() => {
    if (!data) return { cellMap: new Map(), maxAbs: 1, sortedMedias: [] };
    const map = new Map<string, HeatmapCell>();
    let mx = 0;
    for (const c of data.cells) {
      map.set(`${c.media}|${c.zone_code}`, c);
      mx = Math.max(mx, Math.abs(c.ecart ?? 0));
    }
    // Sort medias by total impressions desc
    const mediaTotals = new Map<string, number>();
    for (const c of data.cells) {
      mediaTotals.set(c.media, (mediaTotals.get(c.media) ?? 0) + c.impressions);
    }
    const sorted = [...(data.medias ?? [])].sort((a, b) => (mediaTotals.get(b) ?? 0) - (mediaTotals.get(a) ?? 0));
    return { cellMap: map, maxAbs: mx || 1, sortedMedias: sorted };
  }, [data]);

  if (loading) return <div style={{ padding: 16, fontFamily: fInter, fontSize: 11, color: '#8a8a8a' }}>Chargement heatmap...</div>;
  if (!data || !data.cells.length) return null;

  const zones = data.zones ?? [];
  const isDept = aggregation === 'dept';
  const cellSize = isDept ? 24 : 40;

  return (
    <div style={{ background: '#050505', borderRadius: 4, border: '0.5px solid #1a1a1a', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid #1a1a1a' }}>
        <span style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: '#a0a0a0' }}>Regies x geographie</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {[['region', 'Regions'], ['dept', 'Depts']].map(([id, label]) => (
            <button key={id} onClick={() => onAggregationChange(id)} style={{
              padding: '3px 8px', fontSize: 9, fontFamily: fInter, cursor: 'pointer',
              background: aggregation === id ? 'rgba(78,205,196,0.12)' : 'transparent',
              border: `0.5px solid ${aggregation === id ? '#4ecdc4' : '#1a1a1a'}`,
              borderRadius: 3, color: aggregation === id ? '#4ecdc4' : '#8a8a8a',
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div style={{ overflowX: 'auto', padding: '4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${zones.length}, ${cellSize}px)`, gap: 1, minWidth: 140 + zones.length * (cellSize + 1) }}>
          {/* Header row: empty corner + zone names */}
          <div />
          {zones.map(z => (
            <div key={z.code} style={{
              fontFamily: fInter, fontSize: isDept ? 8 : 10, color: '#8a8a8a',
              writingMode: isDept ? 'vertical-rl' : 'horizontal-tb',
              textOrientation: 'mixed', padding: '2px 1px',
              height: isDept ? 60 : 'auto', overflow: 'hidden',
              display: 'flex', alignItems: isDept ? 'flex-end' : 'center',
            }}>{isDept ? z.code : z.nom}</div>
          ))}

          {/* Data rows */}
          {sortedMedias.map(media => (
            <Fragment key={media}>
              {/* Media label */}
              <div key={`label-${media}`} style={{
                fontFamily: fInter, fontSize: 10, color: '#a0a0a0', padding: '2px 6px',
                display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden',
              }}>{media}</div>
              {/* Cells */}
              {zones.map(z => {
                const cell = cellMap.get(`${media}|${z.code}`);
                const ecart = cell?.ecart ?? 0;
                const bgColor = cell ? ecartColor(ecart, maxAbs) : '#111111';
                let textColor = '#f0f0f0';
                if (cell && !isDept) {
                  const m = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                  if (m) textColor = getContrastText(Number(m[1]), Number(m[2]), Number(m[3]));
                }
                return (
                  <div
                    key={`${media}-${z.code}`}
                    onMouseEnter={() => setHoveredCell(cell ?? null)}
                    onMouseLeave={() => setHoveredCell(null)}
                    onClick={() => cell && onCellClick?.(media, z.code)}
                    style={{
                      width: cellSize, height: cellSize - 2, borderRadius: 2,
                      background: bgColor,
                      cursor: cell ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: fMono, fontSize: isDept ? 0 : 9, color: textColor,
                    }}
                  >
                    {!isDept && cell ? (ecart > 0 ? '+' : '') + ecart.toFixed(1) : ''}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {hoveredCell && (
        <div style={{
          padding: '8px 10px', borderTop: '0.5px solid #1a1a1a', background: '#0a0a0a',
          fontFamily: fInter, fontSize: 11, color: '#a0a0a0',
          display: 'flex', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontWeight: 600, color: '#f0f0f0' }}>{hoveredCell.media} — {hoveredCell.zone_nom}</span>
          <span>{impLabel}: <span style={{ color: '#4ecdc4', fontFamily: fMono }}>{fmt(hoveredCell.impressions)}</span> ({hoveredCell.pct_imp_media}%)</span>
          <span>Pop: <span style={{ color: '#f0f0f0', fontFamily: fMono }}>{fmt(hoveredCell.pop_cible)}</span> ({hoveredCell.pct_pop}%)</span>
          <span style={{ color: hoveredCell.ecart > 0 ? '#EF4444' : '#3B82F6', fontFamily: fMono, fontWeight: 600 }}>
            {hoveredCell.ecart > 0 ? '+' : ''}{hoveredCell.ecart} pts
          </span>
        </div>
      )}

      {/* Legend */}
      <div style={{ padding: '4px 10px 6px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '0.5px solid #111111' }}>
        <div style={{ width: 60, height: 6, borderRadius: 2, background: 'linear-gradient(to right, #3B82F6, #1a1a2e, #EF4444)' }} />
        <span style={{ fontFamily: fMono, fontSize: 8, color: '#8a8a8a' }}>sous-servi → sur-servi</span>
      </div>
    </div>
  );
}
