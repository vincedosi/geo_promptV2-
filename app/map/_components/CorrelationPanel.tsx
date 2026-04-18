'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';

// ── Inject keyframes + reduced-motion ──────────────────────────────────────
if (typeof document !== 'undefined') {
  const styleId = 'corr-panel-keyframes';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes corrFadeIn {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
      }
    `;
    document.head.appendChild(style);
  }
}

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg:        'var(--bg-primary)',
  bgPanel:   'var(--bg-surface)',
  bgInput:   'var(--bg-level-2)',
  border:    'var(--border-default)',
  accent:    'var(--brand-teal)',
  accentDim: 'rgba(78,205,196,0.12)',
  green:     'var(--success)',
  amber:     '#f59e0b',
  red:       '#f87171',
  muted:     'var(--text-secondary)',
  text:      'var(--text-primary)',
  textDim:   'var(--text-tertiary)',
};
const fMono     = "'JetBrains Mono','Fira Mono',monospace";
const fInter    = "'Inter', system-ui, sans-serif";

// ── Groupement des métriques IRIS ──────────────────────────────────────────
// Construit depuis IRIS_DB_COLUMNS (source de vérité) — toute nouvelle colonne
// ajoutée dans db-columns.ts apparaît automatiquement dans les dropdowns.
const METRIC_GROUP_MAP = new Map<string, string>(
  IRIS_DB_COLUMNS.map(col => [col.name, col.group])
);

// Ordre d'affichage des groupes (reflète l'ordre de db-columns.ts)
const GROUP_ORDER = ['Population', 'Âge', 'Revenus', 'Diplômes', 'CSP', 'Emploi', 'Logement', 'Mobilité', 'Familles'];

function buildGroupedOptions(metrics: { key: string; label: string }[]) {
  const groups: Record<string, typeof metrics> = {};
  for (const m of metrics) {
    const g = METRIC_GROUP_MAP.get(m.key) ?? 'Autres';
    if (!groups[g]) groups[g] = [];
    groups[g].push(m);
  }
  // Known groups in order, then any unknown groups at the end
  const allGroups = [...GROUP_ORDER, ...Object.keys(groups).filter(g => !GROUP_ORDER.includes(g))];
  return allGroups.filter(g => groups[g]?.length > 0).map(g => ({ group: g, items: groups[g] }));
}

// Style commun pour les selects métriques (DESIGN_SYSTEM.md)
const metricSelectStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-level-2)',
  border: '0.5px solid var(--border-subtle)',
  borderRadius: 2,
  color: 'var(--text-primary)',
  fontFamily: fInter,
  fontSize: 13,
  padding: '6px 8px',
  cursor: 'pointer',
  outline: 'none',
  transition: 'border-color 0.3s ease',
};

const handleSelectFocus = (e: React.FocusEvent<HTMLSelectElement>) => {
  e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)';
};
const handleSelectBlur = (e: React.FocusEvent<HTMLSelectElement>) => {
  e.currentTarget.style.borderColor = 'var(--border-subtle)';
};

// ── Types ──────────────────────────────────────────────────────────────────
interface POICategory {
  key:      string;
  label:    string;
  count:    number;
  icon:     string;
  sigma_km?: number;
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
  mode?:        'iris_poi' | 'iris_iris';
  poiCategory?: string;
  irisMetric?:  string;
  sigmaKm?:     number;
  metricX?:     string;
  metricY?:     string;
  departement:  string | null;
  autoAnalyse:  boolean;
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
          background: 'var(--bg-level-2)',
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
            Métrique : {fmt(Number(tooltip.point.metric_value))} · Score : {Number(tooltip.point.poi_count).toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper : formatage texte Mistral (bold + paragraphes) ─────────────────
function formatAiText(text: string): React.ReactNode[] {
  return text.split('\n').map((line, i) => {
    if (!line.trim()) return <br key={i} />;
    const parts = line.split(/(\*\*.*?\*\*)/g).map((seg, j) =>
      seg.startsWith('**') && seg.endsWith('**')
        ? <strong key={j} style={{ color: '#f59e0b' }}>{seg.slice(2, -2)}</strong>
        : seg
    );
    return <p key={i} style={{ margin: '2px 0' }}>{parts}</p>;
  });
}

// ── Slide-over résultats ───────────────────────────────────────────────────
interface ResultsPanelProps {
  isOpen:             boolean;
  onClose:            () => void;
  points:             CorrelationPoint[];
  stats:              CorrelationStats | null;
  categories:         POICategory[];
  metrics:            IRISMetric[];
  mode:               'iris_poi' | 'iris_iris';
  selectedPOI:        string;
  selectedMetric:     string;
  selectedMetricX:    string;
  selectedMetricY:    string;
  effectiveDepts:     string[] | null;
  territoireLabel:    string | undefined;
  // Résidus — état géré par CorrelationPanel (parent)
  residualsActive:    boolean;
  residualsLoading:   boolean;
  loadingMsg:         string | null;
  residualsError:     string | null;
  hasCachedResiduals: boolean;
  onToggleResiduals:  () => void;
  sigmaKm?:           number;
}

function CorrelationResultsPanel({
  isOpen, onClose, points, stats, categories, metrics,
  mode, selectedPOI, selectedMetric, selectedMetricX, selectedMetricY,
  effectiveDepts, territoireLabel,
  residualsActive, residualsLoading, loadingMsg, residualsError,
  hasCachedResiduals, onToggleResiduals, sigmaKm,
}: ResultsPanelProps) {
  const corr = stats ? correlationLabel(stats.r) : null;

  const catLabel = mode === 'iris_iris'
    ? (metrics.find(m => m.key === selectedMetricY)?.label ?? selectedMetricY)
    : (categories.find(c => c.key === selectedPOI)?.label ?? selectedPOI);
  const metLabel = mode === 'iris_iris'
    ? (metrics.find(m => m.key === selectedMetricX)?.label ?? selectedMetricX)
    : (metrics.find(m => m.key === selectedMetric)?.label ?? selectedMetric);
  const zoneLabel = effectiveDepts
    ? (territoireLabel ?? `Dept ${effectiveDepts.join(', ')}`)
    : 'France entière';

  // ── État interne : accordéon méthodologie + analyse Mistral ──────────────
  const [methodOpen,  setMethodOpen]  = useState(false);
  const [aiAnalysis,  setAiAnalysis]  = useState<string | null>(null);
  const [aiLoading,   setAiLoading]   = useState(false);
  const [aiError,     setAiError]     = useState<string | null>(null);
  const [aiOpen,      setAiOpen]      = useState(true);

  // Reset analyse quand les points changent (nouveau calcul lancé)
  useEffect(() => {
    setAiAnalysis(null);
    setAiError(null);
  }, [points]);

  const handleAnalyseIA = async () => {
    if (!stats) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/api/correlation/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stats: {
            r:         stats.r,
            rho:       stats.rho,
            r2:        stats.r2,
            p:         stats.p,
            slope:     stats.slope,
            intercept: stats.intercept,
            avgQ1:     stats.avgQ1,
            avgQ4:     stats.avgQ4,
            n:         stats.n,
          },
          mode,
          metricLabel:  metLabel,
          poiLabel:     catLabel,
          metricXLabel: mode === 'iris_iris' ? metLabel  : undefined,
          metricYLabel: mode === 'iris_iris' ? catLabel  : undefined,
          sigmaKm:      mode === 'iris_poi' ? sigmaKm : undefined,
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json() as { analysis?: string; error?: string };
      if (data.error) throw new Error(data.error);
      setAiAnalysis(data.analysis ?? 'Pas de réponse.');
      setAiOpen(true);
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'Erreur Mistral');
    } finally {
      setAiLoading(false);
    }
  };

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
        borderLeft: `0.5px solid var(--border-subtle)`,
        zIndex: 10000,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.2s ease',
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
            <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.accent }}>
              Correlation IRIS x {mode === 'iris_iris' ? 'IRIS' : 'POI'}
            </div>
            <div style={{ fontFamily: fMono, fontSize: 10, color: C.muted, marginTop: 3 }}>
              {catLabel} × {metLabel}
              <span style={{ color: C.textDim }}> — {zoneLabel}</span>
            </div>
          </div>
          <button
            onClick={handleClose}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
            style={{
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, fontFamily: fMono, fontSize: 14,
              width: 28, height: 28, borderRadius: 2, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'all 0.2s ease',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {stats && corr ? (
            <div style={{ animation: 'corrFadeIn 0.3s ease-out' }}>
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
                  <div style={{ fontFamily: fInter, fontSize: 10, fontWeight: 500, color: corr.color }}>
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
                      <span style={{ fontFamily: fInter, fontSize: 8, color: C.textDim }}>
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
                  { label: mode === 'iris_poi' ? `Score Q1 (faible métrique)` : 'Moy. Y · Q1 (faible métrique)', value: stats.avgQ1.toFixed(2), color: C.textDim },
                  { label: mode === 'iris_poi' ? `Score Q4 (forte métrique)`  : 'Moy. Y · Q4 (forte métrique)',  value: stats.avgQ4.toFixed(2), color: corr.color },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    padding: '10px 12px',
                    background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${C.border}`,
                    borderRadius: 2,
                  }}>
                    <div style={{ fontFamily: fMono, fontSize: 20, color, fontWeight: 600 }}>{value}</div>
                    <div style={{ fontFamily: fInter, fontSize: 8, color: C.textDim, marginTop: 3 }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Scatter plot ── */}
              <div style={{
                background: 'var(--bg-level-2)',
                border: `0.5px solid var(--border-subtle)`,
                borderRadius: 2,
                padding: '12px 8px 8px',
                marginBottom: 16,
                borderLeft: '2px solid rgba(78,205,196,0.25)',
              }}>
                <div style={{
                  fontFamily: fInter, fontSize: 9, fontWeight: 500,
                  color: C.textDim, marginBottom: 8, paddingLeft: 8,
                }}>
                  Nuage de points - {metLabel} x {mode === 'iris_iris' ? catLabel : 'Nb POI / IRIS'}
                </div>
                <div style={{ width: '100%' }}>
                  <ScatterPlotResponsive points={points} stats={stats} interactive />
                </div>
              </div>

              {/* ── Encart méthodologique (accordion) ── */}
              <div style={{
                marginBottom: 12,
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${C.border}`,
                borderRadius: 2,
                overflow: 'hidden',
              }}>
                <div
                  onClick={() => setMethodOpen(v => !v)}
                  style={{
                    padding: '9px 14px',
                    display: 'flex', alignItems: 'center', gap: 8,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <span style={{
                    fontSize: 9, color: C.muted,
                    display: 'inline-block',
                    transform: methodOpen ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.2s ease',
                  }}>▶</span>
                  <span style={{ fontFamily: fInter, fontSize: 9, fontWeight: 500, color: C.muted }}>
                    Comprendre ces resultats
                  </span>
                </div>

                {methodOpen && (
                  <div style={{
                    padding: '0 14px 14px',
                    fontFamily: fMono, fontSize: 10.5, lineHeight: 1.75,
                    color: C.muted,
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    <div style={{ marginBottom: 10, marginTop: 10 }}>
                      <span style={{ color: C.text, fontWeight: 600 }}>Qu'est-ce qu'une corrélation ?</span><br />
                      Une corrélation mesure la force du lien linéaire entre deux variables. Un coefficient proche
                      de +1 ou -1 indique un lien fort. Proche de 0 = pas de lien. Important : une corrélation
                      ne prouve jamais qu'une variable cause l'autre.
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <span style={{ color: C.text, fontWeight: 600 }}>Les indicateurs</span><br />
                      <span style={{ color: C.textDim }}>Pearson (r)</span> — Force et direction du lien linéaire. De -1 à +1.<br />
                      <span style={{ color: C.textDim }}>Spearman (ρ)</span> — Même principe sur les rangs. Plus robuste aux valeurs extrêmes.<br />
                      <span style={{ color: C.textDim }}>R²</span> — Part de la variation de Y expliquée par X. Ex: R²=29% signifie que 71% vient d'autres facteurs.<br />
                      <span style={{ color: C.textDim }}>p-value</span> — Probabilité que le résultat soit dû au hasard. Sous 0.05 = significatif.
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <span style={{ color: C.text, fontWeight: 600 }}>Les résidus sur la carte</span><br />
                      Chaque zone IRIS est colorée selon l'écart entre la valeur réelle et la valeur prédite par la régression.<br />
                      <span style={{ display: 'inline-block', width: 9, height: 9, background: '#ef4444', borderRadius: 1, verticalAlign: 'middle', marginRight: 5 }} />Rouge = sous-équipé (moins que prévu)<br />
                      <span style={{ display: 'inline-block', width: 9, height: 9, background: '#e2e8f0', borderRadius: 1, verticalAlign: 'middle', marginRight: 5 }} />Gris = dans la norme<br />
                      <span style={{ display: 'inline-block', width: 9, height: 9, background: '#22c55e', borderRadius: 1, verticalAlign: 'middle', marginRight: 5 }} />Vert = sur-équipé (plus que prévu)
                    </div>

                    {mode === 'iris_poi' && (
                      <div style={{ marginBottom: 10 }}>
                        <span style={{ color: C.text, fontWeight: 600 }}>Score d'accessibilité Gaussien</span><br />
                        L'axe Y n'est pas un simple comptage — c'est un score continu calculé pour chaque IRIS :<br />
                        <span style={{ color: C.accent, fontFamily: fMono }}>Score = Σ exp(−d²ᵢⱼ / 2σ²)</span><br />
                        où d est la distance entre le centroïde IRIS et chaque POI dans un rayon de 3σ km.
                        Le paramètre σ = {sigmaKm ?? 5} km contrôle la portée d'influence : σ faible = accès de proximité,
                        σ élevé = accès régional. Un score élevé = forte concentration de POI accessibles.
                      </div>
                    )}

                    <div>
                      <span style={{ color: C.text, fontWeight: 600 }}>Lire le scatter plot</span><br />
                      Chaque point = une zone IRIS. Axe X = votre métrique,
                      axe Y = {mode === 'iris_iris' ? '2e métrique (mode IRIS × IRIS)' : `score d'accessibilité σ=${sigmaKm ?? 5}km`}. La droite
                      en pointillés = tendance moyenne. Les points éloignés de la droite = résidus forts (zones atypiques).
                    </div>
                  </div>
                )}
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
                  fontFamily: fInter, fontSize: 10, fontWeight: 500,
                  cursor: residualsLoading ? 'not-allowed' : 'pointer',
                  marginBottom: 8, transition: 'all 0.2s ease',
                }}
              >
                {residualsLoading
                  ? (loadingMsg ?? 'Chargement...')
                  : residualsActive
                    ? 'Residus affiches - cliquer pour masquer'
                    : hasCachedResiduals
                      ? 'Reafficher les residus'
                      : 'Voir les residus sur la carte'}
              </button>
              {residualsError && (
                <div style={{ fontFamily: fMono, fontSize: 9, color: C.red, marginBottom: 8 }}>
                  ! {residualsError}
                </div>
              )}

              {/* ── Analyse Mistral AI ── */}
              <button
                onClick={handleAnalyseIA}
                disabled={aiLoading || !stats}
                style={{
                  width: '100%', padding: '10px', borderRadius: 2,
                  background: aiLoading
                    ? 'rgba(245,158,11,0.05)'
                    : 'rgba(245,158,11,0.1)',
                  border: `1px solid ${aiLoading ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.5)'}`,
                  color: aiLoading ? C.textDim : '#f59e0b',
                  fontFamily: fInter, fontSize: 10, fontWeight: 500,
                  cursor: aiLoading ? 'wait' : 'pointer',
                  marginBottom: aiAnalysis || aiError ? 10 : 0,
                  transition: 'all 0.2s ease',
                }}
              >
                {aiLoading ? 'Mistral analyse...' : 'Analyser avec Mistral AI'}
              </button>

              {/* Résultat IA en accordion */}
              {aiAnalysis && (
                <div style={{
                  background: 'rgba(245,158,11,0.03)',
                  border: `1px solid rgba(245,158,11,0.25)`,
                  borderRadius: 2,
                  overflow: 'hidden',
                  marginBottom: 10,
                }}>
                  <div
                    onClick={() => setAiOpen(v => !v)}
                    style={{
                      padding: '9px 14px',
                      borderBottom: aiOpen ? `1px solid rgba(245,158,11,0.15)` : 'none',
                      display: 'flex', alignItems: 'center', gap: 6,
                      cursor: 'pointer', userSelect: 'none',
                    }}
                  >
                    <span style={{
                      fontSize: 9, color: '#f59e0b',
                      display: 'inline-block',
                      transform: aiOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.2s ease',
                    }}>▶</span>
                    <span style={{ fontFamily: fInter, fontSize: 9, fontWeight: 500, color: '#f59e0b' }}>
                      Analyse Mistral AI
                    </span>
                    <span style={{ fontFamily: fMono, fontSize: 8, color: C.textDim, marginLeft: 'auto' }}>
                      {catLabel} × {metLabel}
                    </span>
                  </div>

                  {aiOpen && (
                    <div style={{
                      padding: '14px 16px',
                      fontFamily: fMono, fontSize: 11, lineHeight: 1.75,
                      color: C.text,
                    }}>
                      {formatAiText(aiAnalysis)}
                    </div>
                  )}
                </div>
              )}

              {aiError && (
                <div style={{
                  padding: '9px 12px', borderRadius: 2, marginBottom: 10,
                  border: `1px solid rgba(239,68,68,0.3)`,
                  background: 'rgba(239,68,68,0.05)',
                  fontFamily: fMono, fontSize: 9, color: C.red,
                }}>
                  ! {aiError}
                </div>
              )}
            </div>
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
  const [showResults,   setShowResults]   = useState(false);

  // Mode toggle
  const [mode,           setMode]           = useState<'iris_poi' | 'iris_iris'>('iris_poi');
  const [selectedPOI,    setSelectedPOI]    = useState<string>('');
  const [selectedMetric, setSelectedMetric] = useState<string>('population');
  const [selectedMetricX, setSelectedMetricX] = useState<string>('population');
  const [selectedMetricY, setSelectedMetricY] = useState<string>('taux_chomage');
  const [sigmaKm,        setSigmaKm]        = useState<number>(5.0);

  const effectiveDepts: string[] | null = params?.departement
    ? [params.departement]
    : selectedDepts.length > 0 ? selectedDepts : null;

  const [points, setPoints] = useState<CorrelationPoint[]>([]);
  const [stats,  setStats]  = useState<CorrelationStats | null>(null);
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
    depts: string[] | null, catLabel: string, metLabel: string,
    fetchMode?: 'iris_poi' | 'iris_iris',
    sigma?: number,
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

  // ── Auto-update sigma when POI selection changes ─────────────────────
  useEffect(() => {
    if (!selectedPOI) return;
    const cat = categories.find(c => c.key === selectedPOI);
    if (cat?.sigma_km != null) setSigmaKm(cat.sigma_km);
  }, [selectedPOI, categories]);

  // ── Params programmatiques (depuis le chat) ───────────────────────────
  useEffect(() => {
    if (!params) return;
    const key = `${params.mode ?? 'iris_poi'}|${params.poiCategory}|${params.irisMetric}|${params.sigmaKm ?? ''}|${params.metricX}|${params.metricY}|${params.departement}`;
    if (computedParamsRef.current === key) return;
    computedParamsRef.current = key;
    if (params.mode) setMode(params.mode);
    if (params.poiCategory) setSelectedPOI(params.poiCategory);
    if (params.irisMetric) setSelectedMetric(params.irisMetric);
    if (params.sigmaKm != null) setSigmaKm(params.sigmaKm);
    if (params.metricX) setSelectedMetricX(params.metricX);
    if (params.metricY) setSelectedMetricY(params.metricY);
  }, [params]);

  // ── Reset sur changement de mode ─────────────────────────────────────
  useEffect(() => {
    setPoints([]);
    setStats(null);
    setShowResults(false);
    onShowResiduals?.(null);
    setResidualsActive(false);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps


  // ── fetchAndShowResiduals ─────────────────────────────────────────────
  const fetchAndShowResiduals = useCallback(async (
    scatterData: CorrelationPoint[],
    poi: string, metric: string, depts: string[] | null,
    catLabel: string, metLabel: string,
    fetchMode: 'iris_poi' | 'iris_iris' = 'iris_poi',
    sigma?: number,
  ) => {
    console.log('[RESID-CALC] 1. START — poi:', poi, 'metric:', metric, 'mode:', fetchMode, 'sigma:', sigma, 'depts:', depts);
    const sigmaKey = fetchMode === 'iris_poi' ? `_s${sigma ?? 5}` : '';
    const key = `${fetchMode}_${poi}_${metric}${sigmaKey}_${depts?.join(',') ?? ''}`;

    // Cache hit → affichage instantané
    if (residualsCache.current.has(key)) {
      console.log('[RESID-CALC] CACHE HIT — key:', key);
      const cached = residualsCache.current.get(key)!;
      onShowResiduals?.(cached.data, cached.meta);
      setResidualsActive(true);
      setResidualsMeta(cached.meta);
      return;
    }

    setResidualsLoading(true);
    setResidualsError(null);
    setLoadingMsg('Récupération de tous les IRIS…');

    try {
      // Régression issue du scatter
      const reg = linearReg(
        scatterData.map(d => Number(d.metric_value)),
        scatterData.map(d => Number(d.poi_count)),
      );
      console.log('[RESID-CALC] 5. regression — slope:', reg.slope, 'intercept:', reg.intercept);

      // Body selon le mode
      const fetchBody = fetchMode === 'iris_iris'
        ? { mode: 'iris_iris', metric_x: poi, metric_y: metric, departements: depts, no_limit: true }
        : { poi_category: poi, iris_metric: metric, sigma_km: sigma ?? 5.0, departements: depts, no_limit: true };

      console.log('[RESID-CALC] 2. Fetching compute no_limit... body:', JSON.stringify(fetchBody));
      const allRes = await fetch('/api/correlation/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fetchBody),
      });
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

      console.log('[RESID-CALC] 6. residuals computed:', residuals.length);

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

      setLoadingMsg('Affichage sur la carte…');
      console.log('[RESID-CALC] 10. calling onShowResiduals with', normalized.length, 'items');
      console.log('[RESID-CALC] 11. onShowResiduals is:', typeof onShowResiduals);
      onShowResiduals?.(normalized, meta);
      setResidualsActive(true);
      setResidualsMeta(meta);

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

    const poiOrX   = mode === 'iris_iris' ? selectedMetricX : selectedPOI;
    const metOrY   = mode === 'iris_iris' ? selectedMetricY : selectedMetric;
    const key = `${mode}_${poiOrX}_${metOrY}_${effectiveDepts?.join(',') ?? ''}`;

    if (residualsCache.current.has(key)) {
      const cached = residualsCache.current.get(key)!;
      onShowResiduals?.(cached.data, cached.meta);
      setResidualsActive(true);
      setResidualsMeta(cached.meta);
      return;
    }

    if (!residualsLoading) {
      const catLabel = mode === 'iris_iris'
        ? (metrics.find(m => m.key === selectedMetricY)?.label ?? selectedMetricY)
        : (categories.find(c => c.key === selectedPOI)?.label ?? selectedPOI);
      const metLabel = mode === 'iris_iris'
        ? (metrics.find(m => m.key === selectedMetricX)?.label ?? selectedMetricX)
        : (metrics.find(m => m.key === selectedMetric)?.label ?? selectedMetric);
      fetchResidualsRef.current?.(points, poiOrX, metOrY, effectiveDepts, catLabel, metLabel, mode, sigmaKm);
    }
  }, [residualsActive, residualsLoading, mode, selectedPOI, selectedMetric, selectedMetricX, selectedMetricY, sigmaKm, effectiveDepts, points, categories, metrics, onShowResiduals]);

  // ── Calcul corrélation ────────────────────────────────────────────────
  const compute = useCallback(async (
    poi: string, metric: string, depts: string[] | null,
    currentMode: 'iris_poi' | 'iris_iris' = 'iris_poi',
    mx?: string, my?: string,
    sigma?: number,
  ) => {
    const isIrisIris = currentMode === 'iris_iris';
    if (isIrisIris ? (!mx || !my) : !poi) return;

    setComputing(true);
    setError(null);
    onShowResiduals?.(null);
    setResidualsActive(false);
    setResidualsError(null);
    setResidualsMeta(null);

    try {
      const body = isIrisIris
        ? { mode: 'iris_iris', metric_x: mx, metric_y: my, departements: depts, limit: 2000 }
        : { poi_category: poi, iris_metric: metric, sigma_km: sigma ?? sigmaKm, departements: depts, limit: 2000 };

      const res = await fetch('/api/correlation/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      setShowResults(true);

      // Labels pour le slide-over + résidus
      const catLabel = isIrisIris
        ? (metrics.find(m => m.key === my)?.label ?? (my ?? ''))
        : (categories.find(c => c.key === poi)?.label ?? poi);
      const metLabel = isIrisIris
        ? (metrics.find(m => m.key === mx)?.label ?? (mx ?? ''))
        : (metrics.find(m => m.key === metric)?.label ?? metric);

      // Lancer les résidus en parallèle (sans await) — slide-over déjà visible
      const poiOrX = isIrisIris ? (mx ?? '') : poi;
      const metOrY = isIrisIris ? (my ?? '') : metric;
      const effectiveSigma = isIrisIris ? undefined : (sigma ?? sigmaKm);
      fetchResidualsRef.current?.(data, poiOrX, metOrY, depts, catLabel, metLabel, currentMode, effectiveSigma);

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
    const m = params.mode ?? 'iris_poi';
    compute(params.poiCategory ?? '', params.irisMetric ?? 'population', depts, m, params.metricX, params.metricY, params.sigmaKm);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, loading]);


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

  const canCompute = mode === 'iris_iris'
    ? (!!selectedMetricX && !!selectedMetricY && selectedMetricX !== selectedMetricY)
    : !!selectedPOI;

  return (
    <>
      <div style={{ padding: '4px 0' }}>

        {/* ── Segmented control mode ── */}
        <div style={{ padding: '8px 12px 6px' }}>
          <div style={{
            display: 'inline-flex', borderRadius: 2,
            border: `1px solid ${C.border}`, overflow: 'hidden',
          }}>
            {(['iris_poi', 'iris_iris'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '4px 12px', border: 'none',
                  background: mode === m ? C.accent : 'transparent',
                  color: mode === m ? '#000' : C.muted,
                  fontFamily: fInter, fontSize: 9, fontWeight: 500,
                  cursor: 'pointer', transition: 'all 0.2s ease',
                  borderRight: m === 'iris_poi' ? `1px solid ${C.border}` : 'none',
                }}
              >
                {m === 'iris_poi' ? 'IRIS x POI' : 'IRIS x IRIS'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Mode IRIS × POI : sélecteur catégorie POI ── */}
        {mode === 'iris_poi' && (
          <div style={{ padding: '4px 12px 4px' }}>
            <div style={{ fontFamily: fInter, fontSize: 9, fontWeight: 500, color: C.muted, marginBottom: 6 }}>
              Categorie POI
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
                    transition: 'all 0.2s ease',
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
        )}

        {/* ── Sigma slider (iris_poi only) ── */}
        {mode === 'iris_poi' && (
          <div style={{ padding: '4px 12px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontFamily: fInter, fontSize: 9, fontWeight: 500, color: C.muted }}>
                Portee sigma
              </span>
              <span style={{ fontFamily: fMono, fontSize: 9, color: C.accent }}>
                {sigmaKm < 1 ? `${(sigmaKm * 1000).toFixed(0)} m` : `${sigmaKm} km`}
              </span>
            </div>
            <input
              type="range"
              min={0.2} max={20} step={0.1}
              value={sigmaKm}
              onChange={e => setSigmaKm(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono, fontSize: 7, color: C.textDim, marginTop: 1 }}>
              <span>200m</span><span>20km</span>
            </div>
          </div>
        )}

        {/* ── Métrique IRIS (commune aux deux modes / axe X en iris_iris) ── */}
        <div style={{ padding: '4px 12px 4px' }}>
          <div style={{ fontFamily: fInter, fontWeight: 400, fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
            {mode === 'iris_iris' ? 'Métrique X' : 'Métrique IRIS'}
          </div>
          <select
            value={mode === 'iris_iris' ? selectedMetricX : selectedMetric}
            onChange={e => mode === 'iris_iris' ? setSelectedMetricX(e.target.value) : setSelectedMetric(e.target.value)}
            style={metricSelectStyle}
            onFocus={handleSelectFocus}
            onBlur={handleSelectBlur}
          >
            {buildGroupedOptions(metrics).map(({ group, items }) => (
              <optgroup key={group} label={group} style={{ color: 'var(--brand-teal)', fontWeight: 500 }}>
                {items.map(m => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* ── Mode IRIS × IRIS : sélecteur métrique Y ── */}
        {mode === 'iris_iris' && (
          <div style={{ padding: '4px 12px 4px' }}>
            <div style={{ fontFamily: fInter, fontWeight: 400, fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
              Métrique Y
            </div>
            <select
              value={selectedMetricY}
              onChange={e => setSelectedMetricY(e.target.value)}
              style={metricSelectStyle}
              onFocus={handleSelectFocus}
              onBlur={handleSelectBlur}
            >
              {buildGroupedOptions(metrics).map(({ group, items }) => (
                <optgroup key={group} label={group} style={{ color: 'var(--brand-teal)', fontWeight: 500 }}>
                  {items.map(m => (
                    <option key={m.key} value={m.key} disabled={m.key === selectedMetricX}>
                      {m.key === selectedMetricX ? `${m.label} (déjà en X)` : m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        {/* ── Zone + CALCULER ── */}
        <div style={{ padding: '4px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: fInter, fontSize: 9, fontWeight: 500, color: C.muted }}>Zone </span>
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
            onClick={() => compute(selectedPOI, selectedMetric, effectiveDepts, mode, selectedMetricX, selectedMetricY, sigmaKm)}
            disabled={computing || !canCompute}
            style={{
              flexShrink: 0, padding: '4px 14px', borderRadius: 2,
              background: computing ? C.accentDim : C.accent,
              border: 'none', color: '#000', fontFamily: fInter,
              fontSize: 10, fontWeight: 600,
              cursor: computing || !canCompute ? 'not-allowed' : 'pointer',
              opacity: !canCompute ? 0.4 : 1, transition: 'all 0.2s ease',
            }}
          >
            {computing ? '...' : 'Calculer'}
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
                <span style={{ fontFamily: fInter, fontSize: 9, fontWeight: 500, color: corr.color }}>
                  {corr.label}
                </span>
                <span style={{ fontFamily: fMono, fontSize: 8, color: C.textDim }}>
                  · {stats.n.toLocaleString('fr')} IRIS
                </span>
              </div>
              <span style={{ fontFamily: fInter, fontSize: 9, fontWeight: 500, color: C.muted }}>
                Voir &gt;
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
            {mode === 'iris_iris'
              ? 'Sélectionnez deux métriques IRIS différentes, puis cliquez sur CALCULER.'
              : 'Sélectionnez une catégorie POI et une métrique, puis cliquez sur CALCULER.'}
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
        mode={mode}
        selectedPOI={selectedPOI}
        selectedMetric={selectedMetric}
        selectedMetricX={selectedMetricX}
        selectedMetricY={selectedMetricY}
        effectiveDepts={effectiveDepts}
        territoireLabel={territoireLabel}
        residualsActive={residualsActive}
        residualsLoading={residualsLoading}
        loadingMsg={loadingMsg}
        residualsError={residualsError}
        hasCachedResiduals={residualsCache.current.has(
          mode === 'iris_iris'
            ? `iris_iris_${selectedMetricX}_${selectedMetricY}_${effectiveDepts?.join(',') ?? ''}`
            : `iris_poi_${selectedPOI}_${selectedMetric}_s${sigmaKm}_${effectiveDepts?.join(',') ?? ''}`
        )}
        onToggleResiduals={handleToggleResiduals}
        sigmaKm={sigmaKm}
      />
    </>
  );
}
