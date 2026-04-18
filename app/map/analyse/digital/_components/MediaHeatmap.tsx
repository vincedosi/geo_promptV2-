'use client';

import { useState, useMemo, Fragment, useEffect, useCallback } from 'react';
import { Maximize2, ArrowUpDown, X } from 'lucide-react';

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

const iconBtnStyle: React.CSSProperties = {
  width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: '0.5px solid #1a1a1a', borderRadius: 4,
  color: '#8a8a8a', cursor: 'pointer', padding: 0,
};

const iconBtnLargeStyle: React.CSSProperties = {
  ...iconBtnStyle, width: 28, height: 28,
};

export function MediaHeatmap({ data, loading, aggregation, metric = 'impressions', onCellClick }: MediaHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<HeatmapCell | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [transposed, setTransposed] = useState(false);

  const impLabel = metric === 'unique' ? 'Imp. uniques' : 'Imp.';

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  const { cellMap, maxAbs, sortedMedias } = useMemo(() => {
    if (!data) return { cellMap: new Map<string, HeatmapCell>(), maxAbs: 1, sortedMedias: [] as string[] };
    const map = new Map<string, HeatmapCell>();
    let mx = 0;
    for (const c of data.cells) {
      map.set(`${c.media}|${c.zone_code}`, c);
      mx = Math.max(mx, Math.abs(c.ecart ?? 0));
    }
    const mediaTotals = new Map<string, number>();
    for (const c of data.cells) {
      mediaTotals.set(c.media, (mediaTotals.get(c.media) ?? 0) + c.impressions);
    }
    const sorted = [...(data.medias ?? [])].sort((a, b) => (mediaTotals.get(b) ?? 0) - (mediaTotals.get(a) ?? 0));
    return { cellMap: map, maxAbs: mx || 1, sortedMedias: sorted };
  }, [data]);

  const getCell = useCallback((rowKey: string, colKey: string): HeatmapCell | undefined => {
    const media = transposed ? colKey : rowKey;
    const zone = transposed ? rowKey : colKey;
    return cellMap.get(`${media}|${zone}`);
  }, [cellMap, transposed]);

  if (loading) return <div style={{ padding: 16, fontFamily: fInter, fontSize: 11, color: '#8a8a8a' }}>Chargement heatmap...</div>;
  if (!data || !data.cells.length) return null;

  const zones = data.zones ?? [];
  const isDept = aggregation === 'dept';

  const zoneItems = zones.map(z => ({ key: z.code, label: isDept ? z.code : z.nom, fullLabel: z.nom }));
  const mediaItems = sortedMedias.map(m => ({ key: m, label: m, fullLabel: m }));
  const rowItems = transposed ? zoneItems : mediaItems;
  const colItems = transposed ? mediaItems : zoneItems;
  const verticalColLabels = colItems.length > 20;

  interface GridOptions {
    sticky: boolean;
    cellSize: number;
    firstColWidth: number;
    colHeaderHeight: number;
    cellFontSize: number;
    labelFontSize: number;
    colLabelFontSize: number;
    showCellValue: boolean;
    bodyBg: string;
  }

  const renderGrid = (opts: GridOptions) => {
    const { sticky, cellSize, firstColWidth, colHeaderHeight, cellFontSize, labelFontSize, colLabelFontSize, showCellValue, bodyBg } = opts;
    const cornerStyle: React.CSSProperties = sticky
      ? { position: 'sticky', top: 0, left: 0, zIndex: 3, background: bodyBg, width: firstColWidth, height: colHeaderHeight }
      : { width: firstColWidth, height: colHeaderHeight };
    const colHeaderStyleBase: React.CSSProperties = {
      fontFamily: fInter, fontSize: colLabelFontSize, color: 'var(--text-secondary)',
      writingMode: verticalColLabels ? 'vertical-rl' : 'horizontal-tb',
      textOrientation: 'mixed', padding: '2px 2px',
      height: colHeaderHeight, overflow: 'hidden',
      display: 'flex',
      alignItems: verticalColLabels ? 'flex-end' : 'center',
      justifyContent: 'center',
      background: bodyBg,
      ...(sticky ? { position: 'sticky', top: 0, zIndex: 2 } : {}),
    };
    const rowLabelStyleBase: React.CSSProperties = {
      fontFamily: fInter, fontSize: labelFontSize, color: 'var(--text-secondary)', padding: '2px 6px',
      display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden',
      textOverflow: 'ellipsis', background: bodyBg, width: firstColWidth,
      ...(sticky ? { position: 'sticky', left: 0, zIndex: 1 } : {}),
    };

    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: `${firstColWidth}px repeat(${colItems.length}, ${cellSize}px)`,
        gap: 1,
        minWidth: firstColWidth + colItems.length * (cellSize + 1),
      }}>
        <div style={cornerStyle} />
        {colItems.map(c => (
          <div key={`ch-${c.key}`} style={colHeaderStyleBase} title={c.fullLabel}>
            {c.label}
          </div>
        ))}
        {rowItems.map(row => (
          <Fragment key={`row-${row.key}`}>
            <div style={rowLabelStyleBase} title={row.fullLabel}>{row.label}</div>
            {colItems.map(col => {
              const cell = getCell(row.key, col.key);
              const ecart = cell?.ecart ?? 0;
              const bgColor = cell ? ecartColor(ecart, maxAbs) : '#111111';
              let textColor = '#f0f0f0';
              if (cell && showCellValue) {
                const m = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                if (m) textColor = getContrastText(Number(m[1]), Number(m[2]), Number(m[3]));
              }
              const media = transposed ? col.key : row.key;
              const zoneCode = transposed ? row.key : col.key;
              return (
                <div
                  key={`c-${row.key}-${col.key}`}
                  onMouseEnter={() => setHoveredCell(cell ?? null)}
                  onMouseLeave={() => setHoveredCell(null)}
                  onClick={() => cell && onCellClick?.(media, zoneCode)}
                  style={{
                    width: cellSize, height: cellSize - 2, borderRadius: 2,
                    background: bgColor,
                    cursor: cell ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: fMono, fontSize: showCellValue ? cellFontSize : 0, color: textColor,
                  }}
                >
                  {showCellValue && cell ? (ecart > 0 ? '+' : '') + ecart.toFixed(1) : ''}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    );
  };

  const tooltip = hoveredCell && (
    <div style={{
      padding: '8px 10px', borderTop: '0.5px solid #1a1a1a', background: '#0a0a0a',
      fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)',
      display: 'flex', gap: 12, flexWrap: 'wrap',
    }}>
      <span style={{ fontWeight: 600, color: '#f0f0f0' }}>{hoveredCell.media} — {hoveredCell.zone_nom}</span>
      <span>{impLabel}: <span style={{ color: '#4ecdc4', fontFamily: fMono }}>{fmt(hoveredCell.impressions)}</span> ({hoveredCell.pct_imp_media}%)</span>
      <span>Pop: <span style={{ color: '#f0f0f0', fontFamily: fMono }}>{fmt(hoveredCell.pop_cible)}</span> ({hoveredCell.pct_pop}%)</span>
      <span style={{ color: hoveredCell.ecart > 0 ? '#EF4444' : '#3B82F6', fontFamily: fMono, fontWeight: 600 }}>
        {hoveredCell.ecart > 0 ? '+' : ''}{hoveredCell.ecart} pts
      </span>
    </div>
  );

  const legend = (
    <div style={{ padding: '4px 10px 6px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '0.5px solid #111111' }}>
      <div style={{ width: 80, height: 6, borderRadius: 2, background: 'linear-gradient(to right, #3B82F6, #1a1a2e, #EF4444)' }} />
      <span style={{ fontFamily: fMono, fontSize: 10, color: '#8a8a8a' }}>sous-servi → sur-servi</span>
    </div>
  );

  const compactCellSize = !verticalColLabels ? 40 : 24;
  const compactOpts: GridOptions = {
    sticky: false,
    cellSize: compactCellSize,
    firstColWidth: 140,
    colHeaderHeight: verticalColLabels ? 60 : 22,
    cellFontSize: 9,
    labelFontSize: 10,
    colLabelFontSize: verticalColLabels ? 8 : 10,
    showCellValue: compactCellSize >= 28,
    bodyBg: '#050505',
  };

  const overlayOpts: GridOptions = {
    sticky: true,
    cellSize: 40,
    firstColWidth: 180,
    colHeaderHeight: verticalColLabels ? 80 : 28,
    cellFontSize: 12,
    labelFontSize: 12,
    colLabelFontSize: verticalColLabels ? 10 : 12,
    showCellValue: true,
    bodyBg: '#0a0a0f',
  };

  return (
    <>
      <div style={{ background: '#050505', borderRadius: 4, border: '0.5px solid #1a1a1a', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid #1a1a1a' }}>
          <span style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>Regies x geographie</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => setTransposed(v => !v)}
              title="Transposer lignes/colonnes"
              style={{
                ...iconBtnStyle,
                borderColor: transposed ? '#4ecdc4' : '#1a1a1a',
                color: transposed ? '#4ecdc4' : '#8a8a8a',
              }}
            >
              <ArrowUpDown size={12} />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              title="Agrandir"
              style={iconBtnStyle}
            >
              <Maximize2 size={12} />
            </button>
          </div>
        </div>

        {/* Grid */}
        <div style={{ overflowX: 'auto', padding: '4px' }}>
          {renderGrid(compactOpts)}
        </div>

        {tooltip}
        {legend}
      </div>

      {/* Overlay fullscreen */}
      {expanded && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: '#0a0a0f',
            display: 'flex', flexDirection: 'column',
            animation: 'heatmapFadeIn 200ms ease-out',
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Heatmap Regies x geographie"
        >
          <style>{`@keyframes heatmapFadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>

          {/* Overlay header */}
          <div style={{
            flexShrink: 0, padding: '16px 24px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '0.5px solid #1a1a1a',
          }}>
            <span style={{ fontFamily: fInter, fontSize: 16, fontWeight: 500, color: '#f0f0f0' }}>
              Regies x geographie
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setTransposed(v => !v)}
                title="Transposer lignes/colonnes"
                style={{
                  height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: transposed ? 'rgba(78,205,196,0.1)' : 'transparent',
                  border: `0.5px solid ${transposed ? '#4ecdc4' : '#262626'}`,
                  borderRadius: 6,
                  color: transposed ? 'var(--brand-teal)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontFamily: fInter, fontSize: 12, fontWeight: 500,
                }}
              >
                <ArrowUpDown size={14} />
                <span>Transposer</span>
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                title="Fermer (Echap)"
                aria-label="Fermer"
                style={{
                  ...iconBtnLargeStyle,
                  borderColor: '#262626',
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Overlay body */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16, background: '#0a0a0f' }}>
            {renderGrid(overlayOpts)}
          </div>

          {/* Overlay footer: tooltip + legend */}
          <div style={{ flexShrink: 0 }}>
            {tooltip}
            {legend}
          </div>
        </div>
      )}
    </>
  );
}
