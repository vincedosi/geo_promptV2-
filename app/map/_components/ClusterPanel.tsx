'use client';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { empiler, depiler } from '@/lib/carte/pile-echap';

/** Identifiant fixe dans la pile Echap : le mode comparaison est une entrée
 *  empilée par-dessus le panneau qui la contient (jamais deux à la fois). */
const PILE_ID_COMPARE = 'cluster-compare';
const ClusteringWizard = dynamic(
  () => import('./ClusteringWizard').then(m => ({ default: m.ClusteringWizard })),
  { ssr: false },
);

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:      'var(--bg-primary)',
  bgPanel: 'var(--bg-surface)',
  bgInput: 'var(--bg-level-2)',
  border:  'var(--border-default)',
  accent:  'var(--brand-teal)',
  green:   'var(--success)',
  amber:   '#f59e0b',
  red:     '#f87171',
  text:    'var(--text-primary)',
  textDim: 'var(--text-tertiary)',
  muted:   'var(--text-secondary)',
};
const fMono  = "'JetBrains Mono', monospace";
const fLabel = "'Inter', sans-serif";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ClusterPoi {
  poi_id:          string;
  poi_name:        string;
  cluster_id:      number;
  cluster_label:   string;
  cluster_color:   string;
  categorie:       string;
  ville:           string;
  profile_features: Record<string, number>;
  lat?:            number;
  lng?:            number;
}

export interface ClusterSummaryEntry {
  label:       string;
  count:       number;
  color:       string;
  avg_profile: Record<string, number>;
}

export interface ClusterGeoJSON {
  type:     'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, string | number>;
  }[];
  metadata: {
    model_version:      number;
    k:                  number;
    silhouette_score:   number;
    n_pca_components:   number;
    variance_explained: number;
    duration_minutes:   number;
    mode:               string;
    created_at:         string;
    cluster_summary:    Record<string, ClusterSummaryEntry>;
    feature_names:      string[];
  };
}

// ─── Short labels for radar axes ──────────────────────────────────────────────
const FEAT_SHORT: Record<string, string> = {
  surface_moyenne:    'Surface',
  revenu_moyen:       'Revenu',
  taux_proprietaires: 'Proprios',
  taux_isoles:        'Isolés',
  taux_collectif:     'Collectif',
  taux_monoparental:  'Mono-par',
  pct_0_17:           '0-17',
  pct_18_39:          '18-39',
  pct_40_59:          '40-59',
  pct_60_74:          '60-74',
  pct_75p:            '75+',
  pct_imposes:        'Imposés',
  pct_hlm:            'HLM',
  pct_actifs_15_64:   'Actifs',
  pct_sans_diplome:   'Sans dipl',
  pct_bac_plus:       'Bac+',
};

// ─── Radar SVG ────────────────────────────────────────────────────────────────
function RadarChart({
  profiles, colors, labels, featureKeys, size = 190,
}: {
  profiles:    Record<string, number>[];
  colors:      string[];
  labels:      string[];
  featureKeys: string[];
  size?:       number;
}) {
  const N = Math.min(featureKeys.length, 6);
  const keys = featureKeys.slice(0, N);
  if (N < 3 || profiles.length === 0) return null;

  const cx = size / 2, cy = size / 2;
  const r  = size * 0.33;
  const rL = size * 0.46;

  const angles = keys.map((_, i) => (i / N) * 2 * Math.PI - Math.PI / 2);

  // Normalize per feature (0..maxVal)
  const maxVals: Record<string, number> = {};
  for (const k of keys) {
    maxVals[k] = Math.max(...profiles.map(p => p[k] ?? 0), 0.001);
  }

  function toXY(angle: number, val: number, radius = r) {
    return { x: cx + radius * val * Math.cos(angle), y: cy + radius * val * Math.sin(angle) };
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

  return (
    <svg width={size} height={size} style={{ display: 'block', margin: '0 auto' }}>
      {/* Grid */}
      {[0.25, 0.5, 0.75, 1].map(f => (
        <polygon key={f} points={gridPoly(f)}
          fill="none" stroke={f === 1 ? 'var(--border-default)' : 'var(--border-subtle)'} strokeWidth={f === 1 ? 0.8 : 0.4} />
      ))}
      {/* Axes */}
      {keys.map((_, i) => {
        const { x, y } = toXY(angles[i], 1);
        return <line key={i} x1={cx.toFixed(1)} y1={cy.toFixed(1)} x2={x.toFixed(1)} y2={y.toFixed(1)}
          stroke="#1a1a1a" strokeWidth={0.5} />;
      })}
      {/* Profiles */}
      {profiles.map((prof, pi) => (
        <path key={pi} d={profilePath(prof)}
          fill={colors[pi] + '30'} stroke={colors[pi]} strokeWidth={1.5} />
      ))}
      {/* Labels */}
      {keys.map((k, i) => {
        const { x, y } = toXY(angles[i], 1, rL);
        const anchor   = x < cx - 4 ? 'end' : x > cx + 4 ? 'start' : 'middle';
        const baseline = y < cy - 4 ? 'auto' : y > cy + 4 ? 'hanging' : 'middle';
        const short    = FEAT_SHORT[k] ?? k.slice(0, 9);
        return (
          <text key={i} x={x.toFixed(1)} y={y.toFixed(1)}
            textAnchor={anchor} dominantBaseline={baseline}
            fontSize={7} fill="var(--text-secondary)" fontFamily={fLabel} letterSpacing="0.05em">
            {short}
          </text>
        );
      })}
      {/* Legend labels */}
      {labels.map((lbl, li) => (
        <g key={li} transform={`translate(4, ${size - 10 - li * 12})`}>
          <rect width={7} height={7} fill={colors[li]} rx={1} />
          <text x={10} y={6} fontSize={7} fill={C.muted} fontFamily={fLabel}>{lbl}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── History entry ─────────────────────────────────────────────────────────────
interface HistoryEntry {
  id:                  number;
  cluster_id:          number;
  cluster_label:       string | null;
  model_version:       number;
  action:              string;
  previous_cluster_id: number | null;
  changed:             boolean;
  created_at:          string;
}

// ─── Props ────────────────────────────────────────────────────────────────────
export interface ClusterPanelProps {
  geojson:          ClusterGeoJSON | null;
  visible:          boolean;
  loading:          boolean;
  duration:         number;                      // Phase 9 : durée sélectionnée
  onToggle:         () => void;
  onLoad:           () => void;
  onDurationChange: (d: number) => void;         // Phase 9 : changer la durée
  onFlyTo:          (lat: number, lng: number, zoom?: number) => void;
  onFitBounds:      (bounds: [[number, number], [number, number]]) => void;
  onWizardHighlight?: (poiTypes: string[], metropolitaine: boolean) => void;
  onWizardClose?:     () => void;
  /** Garde de périmètre (spec §5) — transmise telle quelle à ClusteringWizard,
   *  qui l'appelle avant son POST /api/poi-clusters/run (round 2 de correction,
   *  Tâche 7, 2026-09-12). Voir ClusteringWizard.tsx pour le pourquoi. */
  verifierPerimetre?: () => boolean;
}

// ─── Main component ───────────────────────────────────────────────────────────
export function ClusterPanel({
  geojson, visible, loading, duration, onToggle, onLoad, onDurationChange, onFlyTo, onFitBounds,
  onWizardHighlight, onWizardClose, verifierPerimetre,
}: ClusterPanelProps) {

  const [section,    setSection]    = useState<'legend' | 'table' | 'compare'>('legend');
  const [selectedPoi, setSelectedPoi] = useState<ClusterPoi | null>(null);
  const [compareMode, setCompareMode] = useState<'idle' | 'selecting' | 'comparing'>('idle');
  const [wizardOpen,  setWizardOpen]  = useState(false);
  const [compareA,   setCompareA]   = useState<ClusterPoi | null>(null);
  const [compareB,   setCompareB]   = useState<ClusterPoi | null>(null);
  const [history,    setHistory]    = useState<HistoryEntry[]>([]);
  const [historyPoi, setHistoryPoi] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [filterCluster, setFilterCluster] = useState<number | null>(null);
  // Phase 9 : compare durées
  const [durCompare,    setDurCompare]    = useState<{ loading: boolean; data: Record<number, Record<string, number>> | null }>({ loading: false, data: null });
  const [durComparePoi, setDurComparePoi] = useState<string | null>(null);

  // Listen to map clicks on cluster POIs
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ClusterPoi>).detail;
      if (compareMode === 'selecting') {
        setCompareB(detail);
        setCompareMode('comparing');
        setSection('compare');
      } else {
        setSelectedPoi(detail);
      }
    };
    window.addEventListener('genesis:cluster-select', handler);
    return () => window.removeEventListener('genesis:cluster-select', handler);
  }, [compareMode]);

  // Escape to exit compare mode — via la pile Echap (lib/carte/pile-echap.ts) :
  // le mode comparaison se ferme avant le panneau qui le contient, plus de
  // listener direct concurrent.
  useEffect(() => {
    if (compareMode === 'idle') return;
    empiler(PILE_ID_COMPARE, exitCompare);
    return () => depiler(PILE_ID_COMPARE);
  }, [compareMode]); // eslint-disable-line react-hooks/exhaustive-deps

  function exitCompare() {
    setCompareMode('idle');
    setCompareA(null);
    setCompareB(null);
    setSection('legend');
  }

  async function loadDurCompare(poiId: string) {
    if (durComparePoi === poiId && durCompare.data) {
      // Toggle off
      setDurComparePoi(null);
      setDurCompare({ loading: false, data: null });
      return;
    }
    setDurComparePoi(poiId);
    setDurCompare({ loading: true, data: null });
    setSection('compare');
    try {
      const res  = await fetch(`/api/poi-clusters/poi/${poiId}`);
      const json = await res.json();
      const byDur: Record<number, Record<string, number>> = {};
      for (const [d, v] of Object.entries(json.durations ?? {})) {
        byDur[Number(d)] = (v as { profile_features: Record<string, number> }).profile_features ?? {};
      }
      setDurCompare({ loading: false, data: byDur });
    } catch {
      setDurCompare({ loading: false, data: null });
    }
  }

  async function loadHistory(poiId: string) {
    if (historyPoi === poiId && showHistory) { setShowHistory(false); return; }
    setHistoryPoi(poiId);
    setShowHistory(false);
    try {
      const res = await fetch(`/api/poi-clusters/history/${poiId}`);
      const data: HistoryEntry[] = await res.json();
      setHistory(data);
      setShowHistory(true);
    } catch { /* ignore */ }
  }

  // Derived data
  const meta    = geojson?.metadata;
  const summary = meta?.cluster_summary ?? {};
  const featKeys = useMemo(() => (meta?.feature_names ?? []).slice(0, 6), [meta]);
  const sortedClusters = useMemo(
    () => Object.entries(summary).sort((a, b) => Number(a[0]) - Number(b[0])),
    [summary],
  );

  // All POI rows for the table
  const poiRows = useMemo(() => {
    if (!geojson) return [];
    return geojson.features
      .filter(f => filterCluster === null || f.properties.cluster_id === filterCluster)
      .map(f => ({
        poi_id:        String(f.properties.poi_id),
        poi_name:      String(f.properties.poi_name),
        cluster_id:    Number(f.properties.cluster_id),
        cluster_label: String(f.properties.cluster_label),
        cluster_color: String(f.properties.cluster_color),
        categorie:     String(f.properties.categorie),
        ville:         String(f.properties.ville),
        lat:           f.geometry.coordinates[1],
        lng:           f.geometry.coordinates[0],
        profile_features: {},
      } as ClusterPoi & { lat: number; lng: number }));
  }, [geojson, filterCluster]);

  // Fit bounds on cluster click in legend
  function fitCluster(cid: string) {
    const features = geojson?.features.filter(f => String(f.properties.cluster_id) === cid) ?? [];
    if (!features.length) return;
    const lngs = features.map(f => f.geometry.coordinates[0]);
    const lats  = features.map(f => f.geometry.coordinates[1]);
    onFitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]]);
    setFilterCluster(Number(cid));
    setSection('table');
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const lbl = {
    fontFamily: fLabel, fontSize: 9, letterSpacing: '0.04em',
    color: C.muted, marginBottom: 6,
    paddingLeft: 8, borderLeft: '2px solid rgba(78,205,196,0.25)',
  };
  const btn = (active = false, color = C.accent) => ({
    fontFamily: fLabel, fontSize: 9, letterSpacing: '0.02em',
    padding: '5px 10px',
    background: active ? `rgba(${hexRgb(color)},0.12)` : 'none',
    border: `1px solid ${active ? color : C.border}`,
    color: active ? color : C.muted,
    borderRadius: 2, cursor: 'pointer', transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
  });

  // ── Empty / loading state ─────────────────────────────────────────────────
  if (!geojson) {
    return (
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {wizardOpen && (
          <ClusteringWizard
            onClose={() => { setWizardOpen(false); onWizardClose?.(); }}
            onJobStarted={() => { setWizardOpen(false); onWizardClose?.(); onLoad(); }}
            onHighlight={onWizardHighlight}
            verifierPerimetre={verifierPerimetre}
          />
        )}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ ...lbl, marginBottom: 0 }}>Clustering POI</div>
          <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim, lineHeight: 1.6 }}>
            Visualise les POI regroupés par profil sociodémographique de leur bassin de chalandise.
          </div>
          {loading ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, animation: 'clPulse 1s linear infinite' }} />
              <span style={{ fontFamily: fMono, fontSize: 10, color: C.accent }}>Chargement...</span>
            </div>
          ) : (
            <button onClick={onLoad} style={{
              ...btn(false, C.green), padding: '8px 14px', fontSize: 8,
              borderColor: C.green, color: C.green,
            }}>
              Charger les clusters
            </button>
          )}
          <button onClick={() => setWizardOpen(true)} style={{
            ...btn(false, C.amber), padding: '8px 14px', fontSize: 8,
            borderColor: C.amber, color: C.amber,
          }}>
            Nouveau clustering
          </button>
          <style>{`
            @keyframes clPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
            @keyframes clFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
            @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
          `}</style>
        </div>
      </div>
    );
  }

  // ── Compare mode: selecting ───────────────────────────────────────────────
  if (compareMode === 'selecting') {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={lbl}>Mode comparaison</div>
          <button onClick={exitCompare} style={{ ...btn(false, C.red), padding: '3px 7px' }}>Annuler</button>
        </div>
        <div style={{
          padding: '10px 12px', background: 'rgba(78,205,196,0.07)',
          border: `1px solid ${C.accent}`, borderRadius: 2,
        }}>
          <div style={{ fontFamily: fMono, fontSize: 10, color: C.text, marginBottom: 4 }}>
            POI A : <span style={{ color: C.accent }}>{compareA?.poi_name}</span>
          </div>
          <div style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>
            Cliquez sur un second POI sur la carte pour comparer
          </div>
        </div>
        <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted }}>
          — Échap pour annuler —
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>

      {/* ── Wizard overlay ──────────────────────────────────────────────────── */}
      {wizardOpen && (
        <ClusteringWizard
          onClose={() => { setWizardOpen(false); onWizardClose?.(); }}
          onJobStarted={() => { setWizardOpen(false); onWizardClose?.(); onLoad(); }}
          onHighlight={onWizardHighlight}
          verifierPerimetre={verifierPerimetre}
        />
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontFamily: fLabel, fontSize: 9, color: C.accent, letterSpacing: '0.12em' }}>
            Clusters v{meta?.model_version}
          </div>
          <button onClick={onToggle} style={{ ...btn(visible, C.green), fontSize: 7, padding: '3px 8px' }}>
            {visible ? 'Visible' : 'Masqu\u00e9'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 14, fontFamily: fMono, fontSize: 9, color: C.muted }}>
          <span>K=<span style={{ color: C.text }}>{meta?.k}</span></span>
          <span>Sil=<span style={{ color: C.green }}>{(meta?.silhouette_score ?? 0).toFixed(3)}</span></span>
          <span>Var=<span style={{ color: C.text }}>{((meta?.variance_explained ?? 0) * 100).toFixed(0)}%</span></span>
        </div>
        {/* Phase 9 : sélecteur de durée */}
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          <span style={{ fontFamily: fLabel, fontSize: 6.5, color: C.muted, letterSpacing: '0.1em', alignSelf: 'center', marginRight: 2 }}>Dur\u00e9e</span>
          {[30, 45, 60].map(d => (
            <button key={d} onClick={() => onDurationChange(d)} style={{
              fontFamily: fLabel, fontSize: 7, letterSpacing: '0.08em',
              padding: '3px 8px', borderRadius: 2, cursor: 'pointer',
              background: duration === d ? 'rgba(78,205,196,0.14)' : 'none',
              border: `1px solid ${duration === d ? C.accent : C.border}`,
              color: duration === d ? C.accent : C.muted,
              transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
            }}>{d} min</button>
          ))}
          {loading && <span style={{ fontFamily: fMono, fontSize: 8, color: C.accent, alignSelf: 'center', marginLeft: 4 }}>...</span>}
          <button onClick={() => setWizardOpen(true)} style={{
            marginLeft: 'auto', fontFamily: fLabel, fontSize: 6.5, letterSpacing: '0.08em',
            padding: '3px 8px', borderRadius: 2, cursor: 'pointer',
            background: 'rgba(245,158,11,0.08)', border: `1px solid rgba(245,158,11,0.35)`,
            color: C.amber,
          }}>Nouveau</button>
        </div>
      </div>

      {/* ── Sub-tabs ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: 'var(--bg-surface)' }}>
        {([
          { id: 'legend',  label: 'L\u00e9gende' },
          { id: 'table',   label: `POI (${poiRows.length})` },
          { id: 'compare', label: 'Comparer' },
        ] as const).map(s => (
          <button key={s.id} onClick={() => setSection(s.id)} style={{
            flex: 1, padding: '7px 4px',
            background: section === s.id ? 'rgba(78,205,196,0.07)' : 'none',
            border: 'none',
            borderBottom: `2px solid ${section === s.id ? C.accent : 'transparent'}`,
            cursor: 'pointer',
            fontFamily: fLabel, fontSize: 6.5, letterSpacing: '0.1em',
            color: section === s.id ? C.accent : C.muted,
            transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
          }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ═══ LÉGENDE ═══ */}
        {section === 'legend' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Selected POI detail */}
            {selectedPoi && (
              <div style={{
                padding: '10px 12px',
                background: `rgba(${hexRgb(selectedPoi.cluster_color)},0.08)`,
                border: `1px solid ${selectedPoi.cluster_color}44`,
                borderRadius: 2, marginBottom: 4,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontFamily: fMono, fontSize: 10, color: C.text, fontWeight: 700 }}>
                      {selectedPoi.poi_name}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                      <span style={{
                        display: 'inline-block', width: 8, height: 8,
                        borderRadius: 1, background: selectedPoi.cluster_color, flexShrink: 0,
                      }} />
                      <span style={{ fontFamily: fMono, fontSize: 9, color: C.muted }}>
                        {selectedPoi.cluster_label}
                      </span>
                    </div>
                    <div style={{ fontFamily: fMono, fontSize: 9, color: C.textDim, marginTop: 2 }}>
                      {selectedPoi.ville} · {selectedPoi.categorie}
                    </div>
                  </div>
                  <button onClick={() => setSelectedPoi(null)}
                    style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 11, padding: 0 }}>
                    ✕
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => { setCompareA(selectedPoi); setCompareMode('selecting'); }}
                    style={{ ...btn(false, C.accent), flex: 1, fontSize: 7 }}>
                    Comparer
                  </button>
                  <button
                    onClick={() => loadDurCompare(selectedPoi.poi_id)}
                    style={{ ...btn(durComparePoi === selectedPoi.poi_id, C.amber), flex: 1, fontSize: 7 }}>
                    Dur\u00e9es
                  </button>
                  <button
                    onClick={() => loadHistory(selectedPoi.poi_id)}
                    style={{ ...btn(showHistory && historyPoi === selectedPoi.poi_id, C.green), flex: 1, fontSize: 7 }}>
                    Historique
                  </button>
                </div>
                {/* History */}
                {showHistory && historyPoi === selectedPoi.poi_id && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={lbl}>Historique</div>
                    {history.length === 0 ? (
                      <div style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>Aucun historique</div>
                    ) : history.map(h => (
                      <div key={h.id} style={{
                        padding: '4px 8px', background: C.bgInput,
                        border: `1px solid ${C.border}`, borderRadius: 2,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                        <div>
                          <span style={{ fontFamily: fMono, fontSize: 9, color: C.text }}>
                            Cluster {h.cluster_id}
                          </span>
                          {h.changed && <span style={{ color: C.amber, marginLeft: 4, fontSize: 8 }}>⚡</span>}
                          <div style={{ fontFamily: fMono, fontSize: 8, color: C.textDim }}>
                            v{h.model_version} · {h.action}
                          </div>
                        </div>
                        <span style={{ fontFamily: fMono, fontSize: 8, color: C.textDim }}>
                          {new Date(h.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Cluster list */}
            <div>
              <div style={lbl}>
                {filterCluster !== null
                  ? <><span style={{ color: C.amber, cursor: 'pointer' }} onClick={() => setFilterCluster(null)}>Tous</span> · Cluster {filterCluster}</>
                  : `${meta?.k} CLUSTERS · ${geojson.features.length} POI`
                }
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sortedClusters.map(([cid, cl]) => (
                  <button key={cid} onClick={() => fitCluster(cid)} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', background: C.bgInput,
                    border: `1px solid ${filterCluster === Number(cid) ? cl.color : C.border}`,
                    borderRadius: 2, cursor: 'pointer', width: '100%', textAlign: 'left',
                    transition: 'border-color 200ms var(--ease-out)',
                  }}>
                    <span style={{ width: 9, height: 9, borderRadius: 1, background: cl.color, flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ flex: 1, fontFamily: fMono, fontSize: 9, color: C.text, lineHeight: 1.3 }}>{cl.label}</span>
                    <span style={{
                      fontFamily: fLabel, fontSize: 7, color: cl.color,
                      background: cl.color + '22', padding: '1px 5px', borderRadius: 1,
                    }}>{cl.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Radar chart */}
            {sortedClusters.length > 0 && featKeys.length >= 3 && (
              <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 2, padding: 12 }}>
                <div style={{ ...lbl, marginBottom: 10 }}>Profils moyens par cluster</div>
                <RadarChart
                  profiles={sortedClusters.map(([, cl]) => cl.avg_profile)}
                  colors={sortedClusters.map(([, cl]) => cl.color)}
                  labels={sortedClusters.map(([cid, cl]) => `C${cid}: ${cl.label.split('/')[0].trim().slice(0, 12)}`)}
                  featureKeys={featKeys}
                />
              </div>
            )}
          </div>
        )}

        {/* ═══ TABLE POI ═══ */}
        {section === 'table' && (
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={lbl}>
                {filterCluster !== null
                  ? <><span style={{ color: C.amber, cursor: 'pointer' }} onClick={() => setFilterCluster(null)}>Tous</span> · Cluster {filterCluster}</>
                  : `${poiRows.length} POI`}
              </div>
              {filterCluster !== null && (
                <button onClick={() => setFilterCluster(null)}
                  style={{ ...btn(false, C.amber), padding: '3px 7px', fontSize: 7 }}>Retirer filtre</button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {poiRows.map(row => (
                <button key={row.poi_id} onClick={() => onFlyTo(row.lat!, row.lng!, 12)} style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '6px 8px', background: C.bgInput,
                  border: `1px solid ${C.border}`, borderRadius: 2,
                  cursor: 'pointer', width: '100%', textAlign: 'left',
                  transition: 'border-color 200ms var(--ease-out)',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: 1, background: row.cluster_color, flexShrink: 0, display: 'inline-block' }} />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontFamily: fMono, fontSize: 9, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.poi_name || row.poi_id.slice(0, 8)}
                    </div>
                    <div style={{ fontFamily: fMono, fontSize: 8, color: C.textDim }}>{row.ville}</div>
                  </div>
                  <span style={{
                    fontFamily: fLabel, fontSize: 6.5, color: row.cluster_color,
                    background: row.cluster_color + '22', padding: '1px 5px', borderRadius: 1, flexShrink: 0,
                  }}>C{row.cluster_id}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══ COMPARE ═══ */}
        {section === 'compare' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Phase 9 : durées comparées si durCompare actif */}
            {durComparePoi && (compareMode === 'idle') ? (
              <CompareDurationsView
                poiId={durComparePoi}
                poiName={selectedPoi?.poi_name ?? durComparePoi.slice(0, 8)}
                currentDuration={duration}
                featKeys={featKeys}
                durData={durCompare.data}
                loading={durCompare.loading}
                onClose={() => { setDurComparePoi(null); setDurCompare({ loading: false, data: null }); setSection('legend'); }}
              />
            ) : compareMode !== 'comparing' || !compareA || !compareB ? (
              /* Idle compare — instructions */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={lbl}>Comparer deux POI</div>
                <div style={{ fontFamily: fMono, fontSize: 9, color: C.textDim, lineHeight: 1.7 }}>
                  1. Cliquez sur un POI sur la carte (onglet Légende)<br />
                  2. Cliquez &quot;⇄ COMPARER&quot; dans sa fiche<br />
                  3. Cliquez sur un second POI
                </div>
                <div style={{ ...lbl, marginTop: 4 }}>Comparaison de dur\u00e9es</div>
                <div style={{ fontFamily: fMono, fontSize: 9, color: C.textDim, lineHeight: 1.7 }}>
                  Sélectionnez un POI (Légende), puis cliquez &quot;⧖ DURÉES&quot; pour voir comment son bassin évolue à 30/45/60 min.
                </div>
              </div>
            ) : (
              /* Compare POI A vs B */
              <CompareView
                poiA={compareA} poiB={compareB}
                summary={summary} featKeys={featKeys}
                onExit={exitCompare}
                onFlyTo={onFlyTo}
              />
            )}
          </div>
        )}
      </div>
      <style>{`
        @keyframes clFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
      `}</style>
    </div>
  );
}

// ─── Compare durations panel (Phase 9) ────────────────────────────────────────
const DUR_COLORS: Record<number, string> = { 30: '#59a14f', 45: '#f59e0b', 60: 'var(--brand-teal)' };

function CompareDurationsView({
  poiName, currentDuration, featKeys, durData, loading, onClose,
}: {
  poiId:           string;
  poiName:         string;
  currentDuration: number;
  featKeys:        string[];
  durData:         Record<number, Record<string, number>> | null;
  loading:         boolean;
  onClose:         () => void;
}) {
  const availDurs = durData ? Object.keys(durData).map(Number).sort((a, b) => a - b) : [];
  const [activeDurs, setActiveDurs] = useState<number[]>(availDurs);

  // Sync when durData arrives
  useEffect(() => {
    if (durData) setActiveDurs(Object.keys(durData).map(Number).sort((a, b) => a - b));
  }, [durData]);

  const lbl = {
    fontFamily: fLabel, fontSize: 9, letterSpacing: '0.04em',
    color: C.muted, marginBottom: 6,
    paddingLeft: 8, borderLeft: '2px solid rgba(78,205,196,0.25)',
  };

  function toggleDur(d: number) {
    setActiveDurs(prev =>
      prev.includes(d)
        ? prev.length > 1 ? prev.filter(x => x !== d) : prev   // keep at least 1
        : [...prev, d].sort((a, b) => a - b),
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={lbl}>Comparaison dur\u00e9es</div>
          <button onClick={onClose} style={{
            fontFamily: fLabel, fontSize: 7, padding: '3px 7px',
            background: 'none', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 2, cursor: 'pointer',
          }}>Fermer</button>
        </div>
        <div style={{ fontFamily: fMono, fontSize: 10, color: C.accent }}>
          <span style={{ opacity: 0.7 }}>◈</span> Chargement des profils multi-durées...
        </div>
      </div>
    );
  }

  if (!durData || availDurs.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={lbl}>Comparaison dur\u00e9es</div>
          <button onClick={onClose} style={{
            fontFamily: fLabel, fontSize: 7, padding: '3px 7px',
            background: 'none', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 2, cursor: 'pointer',
          }}>Fermer</button>
        </div>
        <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim }}>
          Aucune donnée multi-durée disponible pour ce POI.
        </div>
      </div>
    );
  }

  const selectedDurs  = activeDurs.filter(d => availDurs.includes(d));
  const profiles      = selectedDurs.map(d => durData[d]);
  const colors        = selectedDurs.map(d => DUR_COLORS[d] ?? C.muted);
  const radarLabels   = selectedDurs.map(d => `${d} min`);

  // Delta table — rows sorted by max variation across selected durations
  const refProfile = durData[currentDuration] ?? durData[availDurs[availDurs.length - 1]];
  const deltaRows = featKeys.map(k => {
    const ref  = refProfile?.[k] ?? 0;
    const vals = selectedDurs.map(d => durData[d]?.[k] ?? 0);
    const range = Math.max(...vals) - Math.min(...vals);
    return { key: k, label: FEAT_SHORT[k] ?? k, ref, vals, range };
  })
    .filter(r => r.range > 0.005)
    .sort((a, b) => b.range - a.range)
    .slice(0, 8);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={lbl}>Comparaison dur\u00e9es</div>
          <div style={{ fontFamily: fMono, fontSize: 10, color: C.text, fontWeight: 700 }}>
            {poiName.length > 22 ? poiName.slice(0, 22) + '…' : poiName}
          </div>
        </div>
        <button onClick={onClose} style={{
          fontFamily: fLabel, fontSize: 7, padding: '3px 7px',
          background: 'none', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 2, cursor: 'pointer',
        }}>Fermer</button>
      </div>

      {/* Duration toggles */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {availDurs.map(d => {
          const active = activeDurs.includes(d);
          const col    = DUR_COLORS[d] ?? C.muted;
          return (
            <button key={d} onClick={() => toggleDur(d)} style={{
              fontFamily: fLabel, fontSize: 7, letterSpacing: '0.08em',
              padding: '4px 10px', borderRadius: 2, cursor: 'pointer',
              background: active ? `rgba(${hexRgb(col)},0.12)` : 'none',
              border: `1px solid ${active ? col : C.border}`,
              color: active ? col : C.muted,
              transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
            }}>
              {d} min {d === currentDuration ? '★' : ''}
            </button>
          );
        })}
      </div>

      {/* Radar chart overlay */}
      {featKeys.length >= 3 && selectedDurs.length > 0 && (
        <div style={{ background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 2, padding: 12 }}>
          <div style={{ ...lbl, marginBottom: 10 }}>Profils superpos\u00e9s</div>
          <RadarChart
            profiles={profiles}
            colors={colors}
            labels={radarLabels}
            featureKeys={featKeys}
            size={180}
          />
        </div>
      )}

      {/* Delta table */}
      {deltaRows.length > 0 && (
        <div>
          <div style={lbl}>Variation par feature</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {deltaRows.map(row => (
              <div key={row.key} style={{
                padding: '5px 8px', background: C.bgInput,
                border: `1px solid ${C.border}`, borderRadius: 2,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontFamily: fLabel, fontSize: 7, color: C.muted }}>{row.label}</span>
                  <div style={{ display: 'flex', gap: 6, fontFamily: fMono, fontSize: 8 }}>
                    {selectedDurs.map((d, i) => (
                      <span key={d} style={{ color: colors[i] }}>
                        {(row.vals[i] * 100).toFixed(1)}%
                      </span>
                    ))}
                  </div>
                </div>
                {/* Range bar */}
                <div style={{ height: 2, background: 'var(--border-default)', borderRadius: 1, position: 'relative' }}>
                  {selectedDurs.map((d, i) => {
                    const maxAll = Math.max(...row.vals, 0.001);
                    const pct    = (row.vals[i] / maxAll) * 100;
                    return (
                      <div key={d} style={{
                        position: 'absolute', top: 0, left: 0,
                        height: '100%', width: `${pct.toFixed(1)}%`,
                        background: colors[i], borderRadius: 1, opacity: 0.7,
                      }} />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {availDurs.length > 1 && (
        <div style={{
          padding: '8px 12px', background: 'rgba(78,205,196,0.05)',
          border: '1px solid rgba(78,205,196,0.15)', borderRadius: 2,
        }}>
          <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, lineHeight: 1.7 }}>
            {availDurs.length} paliers disponibles · durée actuelle :{' '}
            <span style={{ color: DUR_COLORS[currentDuration] ?? C.accent }}>{currentDuration} min</span>
          </div>
          {deltaRows.length > 0 && (
            <div style={{ fontFamily: fMono, fontSize: 9, color: C.textDim, marginTop: 2 }}>
              Variation max : <span style={{ color: C.text }}>
                {(deltaRows[0].range * 100).toFixed(1)}%
              </span> sur {deltaRows[0].label}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Compare panel ────────────────────────────────────────────────────────────
function CompareView({
  poiA, poiB, summary, featKeys, onExit, onFlyTo,
}: {
  poiA:    ClusterPoi;
  poiB:    ClusterPoi;
  summary: Record<string, ClusterSummaryEntry>;
  featKeys: string[];
  onExit:  () => void;
  onFlyTo: (lat: number, lng: number, zoom?: number) => void;
}) {
  const lbl = {
    fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: '0.04em',
    color: 'var(--text-secondary)', marginBottom: 6,
    paddingLeft: 8, borderLeft: '2px solid rgba(78,205,196,0.25)',
  };

  const clA = summary[String(poiA.cluster_id)];
  const clB = summary[String(poiB.cluster_id)];

  // Delta table
  const deltas = featKeys.map(k => ({
    key:   k,
    label: FEAT_SHORT[k] ?? k,
    valA:  poiA.profile_features[k] ?? clA?.avg_profile[k] ?? 0,
    valB:  poiB.profile_features[k] ?? clB?.avg_profile[k] ?? 0,
  })).map(d => ({ ...d, delta: d.valA - d.valB }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const top3 = deltas.slice(0, 3).map(d => d.label);

  function fmt(v: number) { return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={lbl}>Comparaison</div>
        <button onClick={onExit} style={{
          fontFamily: "'Inter', sans-serif", fontSize: 7, padding: '3px 7px',
          background: 'none', border: '1px solid #261a35', color: 'var(--text-secondary)',
          borderRadius: 2, cursor: 'pointer',
        }}>Fermer</button>
      </div>

      {/* POI headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {([poiA, poiB] as const).map((poi, i) => (
          <button key={i} onClick={() => poi.lat && onFlyTo(poi.lat, poi.lng!, 12)} style={{
            padding: '7px 8px', background: 'var(--bg-level-2)',
            border: `1px solid ${[poiA, poiB][i].cluster_color}55`,
            borderRadius: 2, textAlign: 'left', cursor: 'pointer', width: '100%',
          }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color: 'var(--text-primary)', fontWeight: 700 }}>
              {poi.poi_name.slice(0, 18) || poi.poi_id.slice(0, 8)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <span style={{ width: 6, height: 6, borderRadius: 1, background: [poiA, poiB][i].cluster_color, display: 'inline-block' }} />
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 6.5, color: 'var(--text-secondary)' }}>
                {poi.cluster_label.split('/')[0].trim().slice(0, 14)}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Radar */}
      {featKeys.length >= 3 && (
        <div style={{ background: 'var(--bg-level-2)', border: '1px solid #261a35', borderRadius: 2, padding: 10 }}>
          <div style={lbl}>Profils compar\u00e9s</div>
          <RadarChart
            profiles={[
              poiA.profile_features,
              poiB.profile_features,
              ...(clA ? [clA.avg_profile] : []),
            ]}
            colors={[poiA.cluster_color, poiB.cluster_color, '#666666']}
            labels={[
              poiA.poi_name.slice(0, 10),
              poiB.poi_name.slice(0, 10),
              'Moy. cluster',
            ]}
            featureKeys={featKeys}
            size={180}
          />
        </div>
      )}

      {/* Delta table */}
      <div>
        <div style={lbl}>Delta par feature</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {deltas.map(d => {
            const absDelta = Math.abs(d.delta);
            const barW     = Math.min(100, absDelta * 500);
            return (
              <div key={d.key} style={{
                padding: '4px 8px', background: 'var(--bg-level-2)',
                border: '1px solid #261a35', borderRadius: 2,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 7, color: 'var(--text-secondary)' }}>{d.label}</span>
                  <div style={{ display: 'flex', gap: 10, fontFamily: "'JetBrains Mono',monospace", fontSize: 8 }}>
                    <span style={{ color: poiA.cluster_color }}>{(d.valA * 100).toFixed(1)}%</span>
                    <span style={{ color: poiB.cluster_color }}>{(d.valB * 100).toFixed(1)}%</span>
                    <span style={{ color: d.delta > 0 ? '#3dffa0' : '#f87171', fontWeight: 700 }}>{fmt(d.delta)}</span>
                  </div>
                </div>
                {/* Delta bar */}
                <div style={{ height: 2, background: 'var(--border-default)', borderRadius: 1 }}>
                  <div style={{
                    height: '100%', width: `${barW}%`,
                    background: d.delta > 0 ? '#3dffa0' : '#f87171',
                    borderRadius: 1, transition: 'width 200ms linear',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Verdict */}
      <div style={{
        padding: '10px 12px', background: 'rgba(78,205,196,0.06)',
        border: '1px solid rgba(78,205,196,0.2)', borderRadius: 2,
      }}>
        <div style={lbl}>Verdict</div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: 'var(--text-primary)', lineHeight: 1.7 }}>
          {poiA.cluster_id === poiB.cluster_id
            ? `Même cluster (${poiA.cluster_label.split('/')[0].trim()}). Profils similaires.`
            : `Clusters distincts. Différences principales :`}
        </div>
        {poiA.cluster_id !== poiB.cluster_id && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {top3.map((f, i) => (
              <div key={f} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color: 'var(--text-secondary)' }}>
                {i + 1}. {f}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hexRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}
