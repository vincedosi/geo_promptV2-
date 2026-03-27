'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg:        '#050505',
  bgPanel:   '#08080f',
  bgInput:   '#0a0a14',
  border:    '#261a35',
  accent:    '#a855f7',
  accentDim: 'rgba(168,85,247,0.12)',
  green:     '#3dffa0',
  amber:     '#f59e0b',
  red:       '#f87171',
  muted:     '#8888aa',
  text:      '#e2e8f0',
  textDim:   '#6b7280',
};
const fMono     = "'JetBrains Mono','Fira Mono',monospace";
const fMichroma = "'Michroma','Orbitron',sans-serif";

// ── Types ──────────────────────────────────────────────────────────────────
interface POICategory {
  key:   string;
  label: string;
  count: number;
  icon:  string;
}

interface IRISMetric {
  key:    string;
  label:  string;
  source: string;
  icon:   string;
}

interface CorrelationPoint {
  code_iris:    string;
  nom_iris:     string;
  metric_value: number;
  poi_count:    number;
  centroid_lat: number | null;
  centroid_lng: number | null;
}

interface CorrelationStats {
  r:         number;
  rho:       number;
  r2:        number;
  p:         number;
  slope:     number;
  intercept: number;
  avgQ1:     number;
  avgQ4:     number;
  n:         number;
}

export interface CorrelationParams {
  poiCategory: string;
  irisMetric:  string;
  departement: string | null;
  autoAnalyse: boolean;
}

export interface ResidualsMeta {
  catLabel:    string;
  metLabel:    string;
  r:           number;
  n:           number;
  minResidual: number;
  maxResidual: number;
}

export interface ResidualData {
  code_iris:    string;
  nom_iris:     string;
  poi_count:    number;
  metric_value: number;
  residual:     number;
  predicted:    number;
  norm:         number;
}

// ── Statistiques ───────────────────────────────────────────────────────────
function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function pearson(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2);
}

function rankArray(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  for (let i = 0; i < indexed.length; ) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const r = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) ranks[indexed[k].i] = r;
    i = j;
  }
  return ranks;
}

function spearman(x: number[], y: number[]): number {
  return pearson(rankArray(x), rankArray(y));
}

function linearReg(x: number[], y: number[]): { slope: number; intercept: number } {
  const mx = mean(x), my = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

function approxPValue(r: number, n: number): number {
  if (n < 3) return 1;
  const t = r * Math.sqrt((n - 2) / Math.max(1 - r * r, 1e-10));
  const p = 0.5 * Math.exp(-0.717 * Math.abs(t) - 0.416 * t * t);
  return Math.min(1, Math.max(0, 2 * p));
}

function computeStats(points: CorrelationPoint[]): CorrelationStats | null {
  const filtered = points.filter(p => p.metric_value != null);
  if (filtered.length < 4) return null;

  const x = filtered.map(p => Number(p.metric_value));
  const y = filtered.map(p => Number(p.poi_count));
  const r   = pearson(x, y);
  const rho = spearman(x, y);
  const { slope, intercept } = linearReg(x, y);

  const sortedByX = [...filtered].sort((a, b) => Number(a.metric_value) - Number(b.metric_value));
  const qSize = Math.floor(sortedByX.length / 4);
  const q1 = sortedByX.slice(0, qSize).map(p => Number(p.poi_count));
  const q4 = sortedByX.slice(-qSize).map(p => Number(p.poi_count));

  return {
    r, rho, r2: r * r,
    p: approxPValue(r, filtered.length),
    slope, intercept,
    avgQ1: mean(q1),
    avgQ4: mean(q4),
    n: filtered.length,
  };
}

function correlationLabel(r: number): { label: string; color: string } {
  const abs = Math.abs(r);
  if (abs >= 0.7) return { label: 'Très forte',  color: C.green   };
  if (abs >= 0.5) return { label: 'Forte',        color: '#4ade80' };
  if (abs >= 0.3) return { label: 'Modérée',      color: C.amber   };
  if (abs >= 0.1) return { label: 'Faible',        color: '#fb923c' };
  return              { label: 'Négligeable',   color: C.red     };
}

const fmt = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v));

// ── Scatter plot SVG (interactive) ────────────────────────────────────────
function ScatterPlot({ points, stats, width = 280, height = 160, interactive = false }: {
  points:       CorrelationPoint[];
  stats:        CorrelationStats;
  width?:       number;
  height?:      number;
  interactive?: boolean;
}) {
  const [tooltip, setTooltip] = useState<{
    svgX: number; svgY: number; point: CorrelationPoint;
  } | null>(null);

  const pad = { t: 10, r: 12, b: 32, l: 40 };
  const W = width  - pad.l - pad.r;
  const H = height - pad.t - pad.b;

  const xs = points.map(p => Number(p.metric_value));
  const ys = points.map(p => Number(p.poi_count));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = 0, yMax = Math.max(...ys) || 1;

  const px = (v: number) => pad.l + ((v - xMin) / Math.max(xMax - xMin, 1)) * W;
  const py = (v: number) => pad.t + H - ((v - yMin) / Math.max(yMax - yMin, 1)) * H;

  const x1r = xMin, x2r = xMax;
  const y1r = stats.slope * x1r + stats.intercept;
  const y2r = stats.slope * x2r + stats.intercept;

  const xTicks = [xMin, (xMin + xMax) / 2, xMax];
  const yTicks = [0, Math.round(yMax / 2), Math.round(yMax)];

  // Subsample for performance if many points
  const displayPoints = points.length > 800
    ? points.filter((_, i) => i % Math.ceil(points.length / 800) === 0)
    : points;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let closestDist = Infinity;
    let closestPt: CorrelationPoint | null = null;
    let closestSvgX = 0, closestSvgY = 0;

    for (const p of displayPoints) {
      const cx = px(Number(p.metric_value));
      const cy = py(Number(p.poi_count));
      const d = Math.hypot(cx - mouseX, cy - mouseY);
      if (d < closestDist) { closestDist = d; closestPt = p; closestSvgX = cx; closestSvgY = cy; }
    }
    if (closestDist < 20 && closestPt) {
      setTooltip({ svgX: closestSvgX, svgY: closestSvgY, point: closestPt });
    } else {
      setTooltip(null);
    }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg
        width={width} height={height}
        style={{ display: 'block', overflow: 'visible', cursor: interactive ? 'crosshair' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Grid */}
        {yTicks.map(v => (
          <line key={v}
            x1={pad.l} y1={py(v)} x2={pad.l + W} y2={py(v)}
            stroke="rgba(255,255,255,0.05)" strokeWidth={1}
          />
        ))}
        {/* Points */}
        {displayPoints.map((p, i) => (
          <circle key={i}
            cx={px(Number(p.metric_value))} cy={py(Number(p.poi_count))}
            r={interactive ? 3 : 2.5}
            fill={C.accent} opacity={0.5}
          />
        ))}
        {/* Regression line */}
        <line
          x1={px(x1r)} y1={py(y1r)} x2={px(x2r)} y2={py(y2r)}
          stroke={C.green} strokeWidth={1.5} strokeDasharray="4 2" opacity={0.8}
        />
        {/* Axes */}
        <line x1={pad.l} y1={pad.t + H} x2={pad.l + W} y2={pad.t + H} stroke={C.border} strokeWidth={1} />
        <line x1={pad.l} y1={pad.t}     x2={pad.l}      y2={pad.t + H} stroke={C.border} strokeWidth={1} />
        {/* X ticks */}
        {xTicks.map((v, i) => (
          <text key={i} x={px(v)} y={pad.t + H + 14}
            textAnchor="middle" fontSize={9} fill={C.textDim} fontFamily={fMono}
          >{fmt(v)}</text>
        ))}
        {/* Y ticks */}
        {yTicks.map((v, i) => (
          <text key={i} x={pad.l - 6} y={py(v) + 3}
            textAnchor="end" fontSize={9} fill={C.textDim} fontFamily={fMono}
          >{fmt(v)}</text>
        ))}
        {/* Hover highlight */}
        {tooltip && (
          <circle
            cx={tooltip.svgX} cy={tooltip.svgY}
            r={5} fill="none" stroke={C.accent} strokeWidth={1.5}
          />
        )}
      </svg>
      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: tooltip.svgX + 10,
          top:  tooltip.svgY - 36,
          background: '#111',
          border: `1px solid ${C.border}`,
          borderRadius: 2,
          padding: '4px 8px',
          pointerEvents: 'none',
          zIndex: 1,
          minWidth: 160,
        }}>
          <div style={{ fontFamily: fMono, fontSize: 8.5, color: C.text, marginBottom: 2 }}>
            {tooltip.point.code_iris} — {tooltip.point.nom_iris}
          </div>
          <div style={{ fontFamily: fMono, fontSize: 8, color: C.muted }}>
            Métrique : {fmt(Number(tooltip.point.metric_value))} · POI : {tooltip.point.poi_count}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Slide-over résultats ───────────────────────────────────────────────────
interface ResultsPanelProps {
  isOpen:             boolean;
  onClose:            () => void;
  points:             CorrelationPoint[];
  stats:              CorrelationStats | null;
  categories:         POICategory[];
  metrics:            IRISMetric[];
  selectedPOI:        string;
  selectedMetric:     string;
  effectiveDepts:     string[] | null;
  territoireLabel:    string | undefined;
  aiText:             string;
  aiLoading:          boolean;
  onAnalyseAI:        () => void;
  // Résidus — état géré par CorrelationPanel (parent)
  residualsActive:    boolean;
  residualsLoading:   boolean;
  loadingMsg:         string | null;
  residualsError:     string | null;
  hasCachedResiduals: boolean;
  onToggleResiduals:  () => void;
}

function CorrelationResultsPanel({
  isOpen, onClose, points, stats, categories, metrics,
  selectedPOI, selectedMetric, effectiveDepts, territoireLabel,
  aiText, aiLoading, onAnalyseAI,
  residualsActive, residualsLoading, loadingMsg, residualsError,
  hasCachedResiduals, onToggleResiduals,
}: ResultsPanelProps) {
  const corr = stats ? correlationLabel(stats.r) : null;

  const catLabel = categories.find(c => c.key === selectedPOI)?.label ?? selectedPOI;
  const metLabel = metrics.find(m => m.key === selectedMetric)?.label ?? selectedMetric;
  const zoneLabel = effectiveDepts
    ? (territoireLabel ?? `Dept ${effectiveDepts.join(', ')}`)
    : 'France entière';

  // Fermeture du slide-over — les résidus RESTENT sur la carte
  const handleClose = () => { onClose(); };

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Rendu via portal pour sortir du stacking context parent (évite z-index relatif)
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(5,5,5,0.65)',
          zIndex: 9999,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 200ms ease',
        }}
      />

      {/* Slide-over panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'clamp(550px, 50vw, 680px)',
        background: C.bgPanel,
        borderLeft: `1px solid ${C.border}`,
        zIndex: 10000,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 200ms cubic-bezier(0.16,1,0.3,1)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontFamily: fMichroma, fontSize: 10, letterSpacing: '0.18em', color: C.accent }}>
              CORRÉLATION IRIS × POI
            </div>
            <div style={{ fontFamily: fMono, fontSize: 10, color: C.muted, marginTop: 3 }}>
              {catLabel} × {metLabel}
              <span style={{ color: C.textDim }}> — {zoneLabel}</span>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, fontFamily: fMono, fontSize: 14,
              width: 28, height: 28, borderRadius: 2, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {stats && corr ? (
            <>
              {/* ── Score + Stats grid ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>

                {/* Big score */}
                <div style={{
                  padding: '20px 16px',
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${corr.color}44`,
                  borderRadius: 2,
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                  gap: 6,
                }}>
                  <div style={{ fontFamily: fMono, fontSize: 52, color: corr.color, fontWeight: 700, lineHeight: 1 }}>
                    {stats.r >= 0 ? '+' : ''}{stats.r.toFixed(2)}
                  </div>
                  <div style={{ fontFamily: fMichroma, fontSize: 10, letterSpacing: '0.14em', color: corr.color }}>
                    {corr.label}
                  </div>
                  <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, textAlign: 'center' }}>
                    {stats.n.toLocaleString('fr')} zones IRIS
                  </div>
                </div>

                {/* Stats grid */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { label: 'Pearson r',   value: stats.r.toFixed(4)              },
                    { label: 'Spearman ρ',  value: stats.rho.toFixed(4)            },
                    { label: 'R²',          value: (stats.r2 * 100).toFixed(2) + '%' },
                    { label: 'p-value',     value: stats.p < 0.001 ? '<0.001' : stats.p.toFixed(4) },
                  ].map(({ label, value }) => (
                    <div key={label} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 10px',
                      background: 'rgba(255,255,255,0.02)',
                      border: `1px solid ${C.border}`,
                      borderRadius: 2,
                    }}>
                      <span style={{ fontFamily: fMichroma, fontSize: 7.5, letterSpacing: '0.1em', color: C.textDim }}>
                        {label}
                      </span>
                      <span style={{ fontFamily: fMono, fontSize: 12, color: C.text }}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Q1 / Q4 ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {[
                  { label: 'Moy. POI · Q1 (faible métrique)', value: stats.avgQ1.toFixed(2), color: C.textDim },
                  { label: 'Moy. POI · Q4 (forte métrique)',  value: stats.avgQ4.toFixed(2), color: corr.color },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    padding: '10px 12px',
                    background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${C.border}`,
                    borderRadius: 2,
                  }}>
                    <div style={{ fontFamily: fMono, fontSize: 20, color, fontWeight: 600 }}>{value}</div>
                    <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.1em', color: C.textDim, marginTop: 3 }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Scatter plot ── */}
              <div style={{
                background: 'rgba(0,0,0,0.35)',
                border: `1px solid ${C.border}`,
                borderRadius: 2,
                padding: '12px 8px 8px',
                marginBottom: 16,
              }}>
                <div style={{
                  fontFamily: fMichroma, fontSize: 7.5, letterSpacing: '0.12em',
                  color: C.textDim, marginBottom: 8, paddingLeft: 8,
                }}>
                  NUAGE DE POINTS — {metLabel} × NB POI / IRIS
                </div>
                <div style={{ width: '100%' }}>
                  <ScatterPlotResponsive points={points} stats={stats} interactive />
                </div>
              </div>

              {/* ── Résidus sur la carte ── */}
              <button
                onClick={e => { e.stopPropagation(); onToggleResiduals(); }}
                disabled={residualsLoading}
                style={{
                  width: '100%', padding: '10px', borderRadius: 2,
                  background: residualsActive
                    ? 'rgba(61,255,160,0.08)'
                    : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${residualsActive ? C.green : C.border}`,
                  color: residualsActive ? C.green : C.text,
                  fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.14em',
                  cursor: residualsLoading ? 'not-allowed' : 'pointer',
                  marginBottom: 8,
                }}
              >
                {residualsLoading
                  ? (loadingMsg?.toUpperCase() ?? 'CHARGEMENT…')
                  : residualsActive
                    ? '✓ RÉSIDUS AFFICHÉS — CLIQUER POUR MASQUER'
                    : hasCachedResiduals
                      ? 'RÉAFFICHER LES RÉSIDUS'
                      : 'VOIR LES RÉSIDUS SUR LA CARTE'}
              </button>
              {residualsError && (
                <div style={{ fontFamily: fMono, fontSize: 9, color: C.red, marginBottom: 8 }}>
                  ! {residualsError}
                </div>
              )}

              {/* ── Analyse IA ── */}
              <button
                onClick={onAnalyseAI}
                disabled={aiLoading}
                style={{
                  width: '100%', padding: '10px', borderRadius: 2,
                  background: aiLoading ? C.accentDim : 'rgba(168,85,247,0.08)',
                  border: `1px solid ${C.accent}`,
                  color: C.accent, fontFamily: fMichroma, fontSize: 8,
                  letterSpacing: '0.14em', cursor: aiLoading ? 'not-allowed' : 'pointer',
                  marginBottom: aiText ? 12 : 0,
                }}
              >
                {aiLoading ? 'ANALYSE EN COURS…' : 'ANALYSER AVEC L\'IA GEMINI'}
              </button>

              {aiText && (
                <div style={{
                  padding: '14px 16px', borderRadius: 2,
                  background: 'rgba(168,85,247,0.04)',
                  border: `1px solid ${C.border}`,
                  fontFamily: fMono, fontSize: 10, lineHeight: 1.7, color: C.text,
                  whiteSpace: 'pre-wrap',
                }}>
                  {aiText}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: C.textDim, fontFamily: fMono, fontSize: 10, padding: '20px 0' }}>
              Aucun résultat disponible.
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

// Responsive wrapper: uses ResizeObserver to fill container width
function ScatterPlotResponsive({ points, stats, interactive }: {
  points:       CorrelationPoint[];
  stats:        CorrelationStats;
  interactive?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w > 0) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <ScatterPlot points={points} stats={stats} width={width} height={320} interactive={interactive} />
    </div>
  );
}

// ── Composant principal (sidebar) ─────────────────────────────────────────
interface CorrelationPanelProps {
  onFlyTo?:         (lat: number, lng: number, zoom?: number) => void;
  params?:          CorrelationParams | null;
  selectedDepts?:   string[];
  territoireLabel?: string;
  onShowResiduals?: (data: ResidualData[] | null, meta?: ResidualsMeta) => void;
}

export function CorrelationPanel({
  onFlyTo: _onFlyTo, params, selectedDepts = [], territoireLabel, onShowResiduals,
}: CorrelationPanelProps) {
  const [categories,    setCategories]    = useState<POICategory[]>([]);
  const [metrics,       setMetrics]       = useState<IRISMetric[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [computing,     setComputing]     = useState(false);
  const [aiLoading,     setAiLoading]     = useState(false);
  const [showResults,   setShowResults]   = useState(false);

  const [selectedPOI,    setSelectedPOI]    = useState<string>('');
  const [selectedMetric, setSelectedMetric] = useState<string>('population');

  const effectiveDepts: string[] | null = params?.departement
    ? [params.departement]
    : selectedDepts.length > 0 ? selectedDepts : null;

  const [points, setPoints] = useState<CorrelationPoint[]>([]);
  const [stats,  setStats]  = useState<CorrelationStats | null>(null);
  const [aiText, setAiText] = useState<string>('');
  const [error,  setError]  = useState<string | null>(null);

  const computedParamsRef = useRef<string>('');

  // ── Résidus (état + cache) ─────────────────────────────────────────────
  const residualsCache = useRef<Map<string, { data: ResidualData[]; meta: ResidualsMeta }>>(new Map());
  const [residualsActive,  setResidualsActive]  = useState(false);
  const [residualsLoading, setResidualsLoading] = useState(false);
  const [loadingMsg,       setLoadingMsg]       = useState<string | null>(null);
  const [residualsError,   setResidualsError]   = useState<string | null>(null);
  const [residualsMeta,    setResidualsMeta]    = useState<ResidualsMeta | null>(null);

  // Ref pour éviter le problème de stale closure dans compute (useCallback avec eslint-disable)
  const fetchResidualsRef = useRef<(
    scatterData: CorrelationPoint[], poi: string, metric: string,
    depts: string[] | null, catLabel: string, metLabel: string
  ) => Promise<void>>();

  // ── Chargement initial ────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/correlation/categories').then(r => r.json()),
      fetch('/api/correlation/metrics').then(r => r.json()),
    ]).then(([cats, mets]) => {
      if (Array.isArray(cats)) {
        setCategories(cats);
        if (cats.length > 0) setSelectedPOI(cats[0].key);
      }
      if (Array.isArray(mets)) setMetrics(mets);
    }).catch(() => {
      setError('Impossible de charger les données.');
    }).finally(() => setLoading(false));
  }, []);

  // ── Params programmatiques (depuis le chat) ───────────────────────────
  useEffect(() => {
    if (!params) return;
    const key = `${params.poiCategory}|${params.irisMetric}|${params.departement}`;
    if (computedParamsRef.current === key) return;
    computedParamsRef.current = key;
    setSelectedPOI(params.poiCategory);
    setSelectedMetric(params.irisMetric);
  }, [params]);


  // ── fetchAndShowResiduals ─────────────────────────────────────────────
  const fetchAndShowResiduals = useCallback(async (
    scatterData: CorrelationPoint[],
    poi: string, metric: string, depts: string[] | null,
    catLabel: string, metLabel: string,
  ) => {
    const key = `${poi}_${metric}_${depts?.join(',') ?? ''}`;

    console.log('[RESID-CALC] 1. START — poi:', poi, 'metric:', metric, 'depts:', depts, 'key:', key);

    // Cache hit → affichage instantané
    if (residualsCache.current.has(key)) {
      const cached = residualsCache.current.get(key)!;
      console.log('[RESID-CALC] 1b. CACHE HIT — skipping fetch, items:', cached.data.length);
      onShowResiduals?.(cached.data, cached.meta);
      setResidualsActive(true);
      setResidualsMeta(cached.meta);
      return;
    }

    setResidualsLoading(true);
    setResidualsError(null);
    setLoadingMsg('Récupération de tous les IRIS…');

    try {
      // Régression issue du scatter (2000 IRIS)
      const reg = linearReg(
        scatterData.map(d => Number(d.metric_value)),
        scatterData.map(d => Number(d.poi_count)),
      );
      console.log('[RESID-CALC] 5. regression — slope:', reg.slope, 'intercept:', reg.intercept, 'scatter size:', scatterData.length);

      // Fetch tous les IRIS (sans limite)
      console.log('[RESID-CALC] 2. Fetching compute no_limit — body:', JSON.stringify({ poi_category: poi, iris_metric: metric, departements: depts, no_limit: true }));
      const allRes = await fetch('/api/correlation/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poi_category: poi, iris_metric: metric, departements: depts, no_limit: true }),
      });
      console.log('[RESID-CALC] 2b. fetch response status:', allRes.status, allRes.ok ? 'OK' : 'FAIL');
      if (!allRes.ok) throw new Error(`Compute API ${allRes.status}`);
      const allData: CorrelationPoint[] = await allRes.json();
      if ((allData as unknown as { error: string })?.error) throw new Error((allData as unknown as { error: string }).error);

      console.log('[RESID-CALC] 3. compute returned:', allData?.length, 'rows');
      console.log('[RESID-CALC] 4. sample:', JSON.stringify(allData?.slice(0, 3)));

      // Calcul des résidus
      setLoadingMsg('Calcul des résidus…');
      const residuals = allData
        .filter(d => d.metric_value != null)
        .map(d => {
          const mv = Number(d.metric_value);
          const residual = d.poi_count - (reg.slope * mv + reg.intercept);
          return {
            code_iris:    d.code_iris,
            nom_iris:     d.nom_iris,
            poi_count:    d.poi_count,
            metric_value: mv,
            residual,
            predicted:    Math.round((reg.slope * mv + reg.intercept) * 100) / 100,
          };
        });

      console.log('[RESID-CALC] 6. residuals computed:', residuals.length, '(filtered from', allData.length, ')');

      const maxAbs = Math.max(...residuals.map(r => Math.abs(r.residual)), 0.01);
      console.log('[RESID-CALC] 7. maxAbsResidual:', maxAbs);

      const normalized: ResidualData[] = residuals.map(r => ({ ...r, norm: r.residual / maxAbs }));

      console.log('[RESID-CALC] 8. sample residuals:', JSON.stringify(normalized.slice(0, 5).map(r => ({
        code: r.code_iris, norm: r.norm?.toFixed(3), residual: r.residual?.toFixed(3),
      }))));

      const positives = normalized.filter(r => r.norm > 0.1).length;
      const negatives = normalized.filter(r => r.norm < -0.1).length;
      const neutral   = normalized.filter(r => Math.abs(r.norm) <= 0.1).length;
      console.log('[RESID-CALC] 9. distribution — positifs:', positives, 'négatifs:', negatives, 'neutres:', neutral);

      const r = pearson(
        scatterData.map(d => Number(d.metric_value)),
        scatterData.map(d => Number(d.poi_count)),
      );
      const meta: ResidualsMeta = {
        catLabel, metLabel, r,
        n: normalized.length,
        minResidual: Math.min(...residuals.map(x => x.residual)),
        maxResidual: Math.max(...residuals.map(x => x.residual)),
      };

      // Mise en cache (max 5 entrées FIFO)
      if (residualsCache.current.size >= 5) {
        const firstKey = residualsCache.current.keys().next().value as string;
        residualsCache.current.delete(firstKey);
      }
      residualsCache.current.set(key, { data: normalized, meta });

      console.log('[RESID-CALC] 10. calling onShowResiduals with', normalized.length, 'items');
      console.log('[RESID-CALC] 11. onShowResiduals is:', typeof onShowResiduals);
      setLoadingMsg('Affichage sur la carte…');
      onShowResiduals?.(normalized, meta);
      setResidualsActive(true);
      setResidualsMeta(meta);
      console.log('[RESID-CALC] 12. DONE — residualsActive set to true');

    } catch (e: unknown) {
      console.error('[RESID-CALC] ERROR:', e);
      setResidualsError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setResidualsLoading(false);
      setLoadingMsg(null);
    }
  }, [onShowResiduals]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toujours garder la ref à jour (évite stale closure dans compute)
  fetchResidualsRef.current = fetchAndShowResiduals;

  // ── Toggle résidus (bouton slide-over) ────────────────────────────────
  const handleToggleResiduals = useCallback(() => {
    if (residualsActive) {
      onShowResiduals?.(null);
      setResidualsActive(false);
      return;
    }

    const key = `${selectedPOI}_${selectedMetric}_${effectiveDepts?.join(',') ?? ''}`;
    if (residualsCache.current.has(key)) {
      const cached = residualsCache.current.get(key)!;
      onShowResiduals?.(cached.data, cached.meta);
      setResidualsActive(true);
      setResidualsMeta(cached.meta);
      return;
    }

    if (!residualsLoading) {
      const catLabel = categories.find(c => c.key === selectedPOI)?.label ?? selectedPOI;
      const metLabel = metrics.find(m => m.key === selectedMetric)?.label ?? selectedMetric;
      fetchResidualsRef.current?.(points, selectedPOI, selectedMetric, effectiveDepts, catLabel, metLabel);
    }
  }, [residualsActive, residualsLoading, selectedPOI, selectedMetric, effectiveDepts, points, categories, metrics, onShowResiduals]);

  // ── Calcul corrélation ────────────────────────────────────────────────
  const compute = useCallback(async (poi: string, metric: string, depts: string[] | null) => {
    if (!poi) return;
    setComputing(true);
    setError(null);
    setAiText('');
    // Nettoyer les résidus précédents
    onShowResiduals?.(null);
    setResidualsActive(false);
    setResidualsError(null);
    setResidualsMeta(null);

    try {
      const res = await fetch('/api/correlation/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poi_category: poi,
          iris_metric:  metric,
          departements: depts,
          limit:        2000,
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Erreur serveur');
      if (!Array.isArray(data) || data.length === 0) {
        setPoints([]);
        setStats(null);
        setError('Aucune donnée trouvée pour cette combinaison.');
        return;
      }

      const computed = computeStats(data);
      setPoints(data);
      setStats(computed);
      setShowResults(true);  // Ouvre le slide-over immédiatement

      // Lancer les résidus en parallèle (sans await) — slide-over déjà visible
      const catLabel = categories.find(c => c.key === poi)?.label ?? poi;
      const metLabel = metrics.find(m => m.key === metric)?.label ?? metric;
      fetchResidualsRef.current?.(data, poi, metric, depts, catLabel, metLabel);

      if (params?.autoAnalyse) {
        analyseWithAI(poi, metric, computed);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setComputing(false);
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  // Déclenchement auto si params changent
  useEffect(() => {
    if (!params || loading) return;
    const depts = params.departement ? [params.departement] : effectiveDepts;
    compute(params.poiCategory, params.irisMetric, depts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, loading]);

  // ── Analyse IA ────────────────────────────────────────────────────────
  const analyseWithAI = useCallback(async (
    poi: string, metric: string, s: CorrelationStats | null
  ) => {
    if (!s) return;
    setAiLoading(true);
    setAiText('');

    const catLabel  = categories.find(c => c.key === poi)?.label ?? poi;
    const metLabel  = metrics.find(m => m.key === metric)?.label ?? metric;
    const direction = s.r >= 0 ? 'positive' : 'négative';
    const strength  = correlationLabel(s.r).label.toLowerCase();

    const prompt = `Tu es expert en géomarketing et analyse de données territoriales français.

Contexte :
- Corrélation ${direction} ${strength} (r=${s.r.toFixed(3)}, ρ=${s.rho.toFixed(3)}, R²=${s.r2.toFixed(3)}) entre :
  - Métrique IRIS : ${metLabel}
  - Catégorie POI : ${catLabel}
- ${s.n} zones IRIS analysées
- Zones à faibles ${metLabel} (Q1) : moyenne ${s.avgQ1.toFixed(2)} ${catLabel}/IRIS
- Zones à forts ${metLabel} (Q4) : moyenne ${s.avgQ4.toFixed(2)} ${catLabel}/IRIS
- p-value estimée : ${s.p < 0.001 ? '<0.001' : s.p.toFixed(3)}

Rédige une analyse géomarketing en 3-4 phrases :
1. Interprète la corrélation (cause/effet probable, mécanismes)
2. Identifie les implications pour une stratégie d'implantation ou ciblage
3. Mentionne les limites et ce qu'il faudrait approfondir

Réponds directement, sans titre, en français professionnel.`;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          provider: 'gemini',
        }),
      });

      if (!res.ok || !res.body) throw new Error('Erreur IA');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (line.startsWith('0:')) {
            try {
              const s = JSON.parse(line.slice(2));
              text += s;
              setAiText(text);
            } catch {}
          }
        }
      }
    } catch {
      setAiText('Analyse IA indisponible.');
    } finally {
      setAiLoading(false);
    }
  }, [categories, metrics]);

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 12, color: C.muted, fontFamily: fMono, fontSize: 10 }}>
        Chargement…
      </div>
    );
  }

  const corr = stats ? correlationLabel(stats.r) : null;
  const zoneLabel = effectiveDepts
    ? (territoireLabel ?? `Dept ${effectiveDepts.join(', ')}`)
    : 'France entière';

  return (
    <>
      <div style={{ padding: '4px 0' }}>

        {/* ── Sélecteur POI ── */}
        <div style={{ padding: '8px 12px 4px' }}>
          <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.14em', color: C.muted, marginBottom: 6 }}>
            CATÉGORIE POI
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {categories.map(cat => (
              <button
                key={cat.key}
                onClick={() => setSelectedPOI(cat.key)}
                style={{
                  padding: '3px 8px', borderRadius: 2,
                  border: `1px solid ${selectedPOI === cat.key ? C.accent : C.border}`,
                  background: selectedPOI === cat.key ? C.accentDim : 'transparent',
                  color: selectedPOI === cat.key ? C.accent : C.muted,
                  fontFamily: fMono, fontSize: 9, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                <span style={{ color: C.textDim, fontSize: 8 }}>({cat.count.toLocaleString('fr')})</span>
              </button>
            ))}
            {categories.length === 0 && (
              <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>Aucune catégorie disponible</span>
            )}
          </div>
        </div>

        {/* ── Sélecteur Métrique IRIS ── */}
        <div style={{ padding: '8px 12px 4px' }}>
          <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.14em', color: C.muted, marginBottom: 6 }}>
            MÉTRIQUE IRIS
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {metrics.map(m => (
              <button
                key={m.key}
                onClick={() => setSelectedMetric(m.key)}
                style={{
                  padding: '3px 8px', borderRadius: 2,
                  border: `1px solid ${selectedMetric === m.key ? C.green : C.border}`,
                  background: selectedMetric === m.key ? 'rgba(61,255,160,0.08)' : 'transparent',
                  color: selectedMetric === m.key ? C.green : C.muted,
                  fontFamily: fMono, fontSize: 9, cursor: 'pointer',
                }}
              >
                {m.icon} {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Zone + CALCULER ── */}
        <div style={{ padding: '4px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: fMichroma, fontSize: 6.5, letterSpacing: '0.12em', color: C.muted }}>ZONE </span>
            <span style={{ fontFamily: fMono, fontSize: 9, color: effectiveDepts ? C.green : C.textDim }}>
              {zoneLabel}
            </span>
            {!effectiveDepts && (
              <div style={{ fontFamily: fMono, fontSize: 8, color: C.textDim, marginTop: 1 }}>
                Sélectionnez un territoire dans l'onglet TERRITOIRE
              </div>
            )}
          </div>
          <button
            onClick={() => compute(selectedPOI, selectedMetric, effectiveDepts)}
            disabled={computing || !selectedPOI}
            style={{
              flexShrink: 0, padding: '4px 14px', borderRadius: 2,
              background: computing ? C.accentDim : C.accent,
              border: 'none', color: '#000', fontFamily: fMichroma,
              fontSize: 7, letterSpacing: '0.12em',
              cursor: computing || !selectedPOI ? 'not-allowed' : 'pointer',
              opacity: !selectedPOI ? 0.4 : 1,
            }}
          >
            {computing ? '…' : 'CALCULER'}
          </button>
        </div>

        {/* ── Erreur ── */}
        {error && (
          <div style={{ padding: '6px 12px', fontFamily: fMono, fontSize: 9, color: C.red }}>
            ! {error}
          </div>
        )}

        {/* ── Mini résumé (cliquable pour rouvrir) ── */}
        {stats && corr && !computing && (
          <div style={{
            margin: '4px 0 0',
            borderTop: `1px solid ${C.border}`,
            borderBottom: `1px solid ${C.border}`,
          }}>
            <button
              onClick={() => setShowResults(true)}
              style={{
                width: '100%', padding: '6px 12px',
                background: 'rgba(255,255,255,0.02)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: fMono, fontSize: 14, color: corr.color, fontWeight: 700 }}>
                  r = {stats.r >= 0 ? '+' : ''}{stats.r.toFixed(2)}
                </span>
                <span style={{ fontFamily: fMichroma, fontSize: 7.5, letterSpacing: '0.1em', color: corr.color }}>
                  {corr.label}
                </span>
                <span style={{ fontFamily: fMono, fontSize: 8, color: C.textDim }}>
                  · {stats.n.toLocaleString('fr')} IRIS
                </span>
              </div>
              <span style={{ fontFamily: fMichroma, fontSize: 7, color: C.muted, letterSpacing: '0.1em' }}>
                VOIR ›
              </span>
            </button>
            {/* Indicateur de progression résidus */}
            {residualsLoading && loadingMsg && (
              <div style={{
                padding: '3px 12px 5px',
                fontFamily: fMono, fontSize: 8, color: C.amber,
                borderTop: `1px solid ${C.border}`,
              }}>
                ... {loadingMsg}
              </div>
            )}
            {!residualsLoading && residualsMeta && (
              <div style={{
                padding: '3px 12px 5px',
                fontFamily: fMono, fontSize: 8, color: C.green,
                borderTop: `1px solid ${C.border}`,
              }}>
                {residualsActive ? '✓' : '○'} {residualsMeta.n.toLocaleString('fr')} IRIS sur la carte
              </div>
            )}
          </div>
        )}

        {/* État initial */}
        {!stats && !computing && !error && (
          <div style={{ padding: '10px 12px 6px', fontFamily: fMono, fontSize: 9, color: C.textDim }}>
            Sélectionnez une catégorie POI et une métrique, puis cliquez sur CALCULER.
          </div>
        )}
      </div>

      {/* ── Slide-over résultats ── */}
      <CorrelationResultsPanel
        isOpen={showResults}
        onClose={() => setShowResults(false)}
        points={points}
        stats={stats}
        categories={categories}
        metrics={metrics}
        selectedPOI={selectedPOI}
        selectedMetric={selectedMetric}
        effectiveDepts={effectiveDepts}
        territoireLabel={territoireLabel}
        aiText={aiText}
        aiLoading={aiLoading}
        onAnalyseAI={() => analyseWithAI(selectedPOI, selectedMetric, stats)}
        residualsActive={residualsActive}
        residualsLoading={residualsLoading}
        loadingMsg={loadingMsg}
        residualsError={residualsError}
        hasCachedResiduals={residualsCache.current.has(
          `${selectedPOI}_${selectedMetric}_${effectiveDepts?.join(',') ?? ''}`
        )}
        onToggleResiduals={handleToggleResiduals}
      />
    </>
  );
}
