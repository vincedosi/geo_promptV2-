'use client';
import React, { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────────────────────────────────────
const PALIER_COLORS: Record<number, string> = {
  10:  '#1D9E75',
  30:  '#378ADD',
  60:  '#BA7517',
  90:  '#E24B4A',
  120: '#791F1F',
  150: '#4ecdc4',
  180: '#475569',
};

const POI_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#4ecdc4', '#06b6d4', '#84cc16', '#f97316',
  '#ec4899', '#6366f1', '#14b8a6', '#3dbdb5',
];

export type MetricKey =
  | 'ind' | 'ind_0_3' | 'ind_4_5' | 'ind_6_10'
  | 'ind_18_24' | 'ind_25_39' | 'ind_40_54' | 'ind_55_64' | 'ind_65_79' | 'ind_80p'
  | 'ind_snv' | 'men_pauv'
  | 'men' | 'men_prop' | 'men_fmp' | 'men_coll'
  | 'log_soc' | 'log_ap90' | 'log_av45';

export const METRICS: { key: MetricKey; label: string; group: string }[] = [
  // Population
  { key: 'ind',       label: 'Total pop.',   group: 'Population' },
  { key: 'ind_0_3',   label: '0-3 ans',      group: 'Population' },
  { key: 'ind_4_5',   label: '4-5 ans',      group: 'Population' },
  { key: 'ind_6_10',  label: '6-10 ans',     group: 'Population' },
  { key: 'ind_18_24', label: '18-24 ans',    group: 'Population' },
  { key: 'ind_25_39', label: '25-39 ans',    group: 'Population' },
  { key: 'ind_40_54', label: '40-54 ans',    group: 'Population' },
  { key: 'ind_55_64', label: '55-64 ans',    group: 'Population' },
  { key: 'ind_65_79', label: '65-79 ans',    group: 'Population' },
  { key: 'ind_80p',   label: '80+ ans',      group: 'Population' },
  // Socio-économique
  { key: 'ind_snv',   label: 'Sous niv.vie', group: 'Socio' },
  { key: 'men_pauv',  label: 'Mén.pauvres',  group: 'Socio' },
  // Ménages
  { key: 'men',       label: 'Total mén.',   group: 'Ménages' },
  { key: 'men_prop',  label: 'Propriétaires',group: 'Ménages' },
  { key: 'men_fmp',   label: 'Monoparen.',   group: 'Ménages' },
  { key: 'men_coll',  label: 'Collectif',    group: 'Ménages' },
  // Logements
  { key: 'log_soc',   label: 'Social',       group: 'Logements' },
  { key: 'log_ap90',  label: 'Après 1990',   group: 'Logements' },
  { key: 'log_av45',  label: 'Avant 1945',   group: 'Logements' },
];

const METRIC_GROUPS = ['Population', 'Socio', 'Ménages', 'Logements'] as const;

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────
function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString('fr-FR');
}

// Shoelace formula en degrés², converti en km² via projection lat≈46.5° (centre France)
function approxAreaKm2(geom: GeoJSON.Geometry | string): number {
  try {
    const g: GeoJSON.Geometry = typeof geom === 'string' ? JSON.parse(geom) : geom;
    const rings =
      g.type === 'Polygon'      ? [g.coordinates[0]] :
      g.type === 'MultiPolygon' ? g.coordinates.map((p: GeoJSON.Position[][]) => p[0]) : [];
    let totalDeg2 = 0;
    for (const ring of rings) {
      let a = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      totalDeg2 += Math.abs(a) / 2;
    }
    // 111 km/deg × cos(46.5°) pour corriger la distorsion lng à la latitude FR
    return totalDeg2 * 111 * 111 * Math.cos(46.5 * Math.PI / 180);
  } catch { return 0; }
}

// ──────────────────────────────────────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────────────────────────────────────
export interface CoverageSummaryEntry {
  metric: MetricKey;
  label:  string;
  total:  number;
}

interface Props {
  isOpen?:         boolean;
  onClose?:        () => void;
  inline?:         boolean;
  battleFeatures:  GeoJSON.Feature[];
  pois:            Array<{ id: string; nom: string; lat: number; lng: number; ville?: string; adresse?: string }>;
  onResultsReady?: (summary: CoverageSummaryEntry[]) => void;
  battleCacheKey?: string;
}

interface PoiEntry { id: string; nom: string; ville?: string }
interface C1Entry    { id: string; name: string; value: number; fill: string; failed?: boolean }
interface C2Row      { name: string; segments: { palier: number; value: number; color: string }[] }
interface C3Point    { label: string; pct: number; coverage: number }
interface C4Entry    { id: string; name: string; value: number; fill: string }

// ──────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ──────────────────────────────────────────────────────────────────────────────
export function CoverageResultsPanel({ isOpen, onClose, inline = false, battleFeatures, pois, onResultsReady, battleCacheKey }: Props) {
  const [selectedMetrics, setSelectedMetrics] = useState<Set<MetricKey>>(
    new Set<MetricKey>(['ind', 'ind_18_24', 'ind_25_39', 'ind_40_54']),
  );
  const [computedMetrics, setComputedMetrics] = useState<Map<MetricKey, Map<string, number>>>(new Map());
  const [displayMetric,   setDisplayMetric]   = useState<MetricKey>('ind');
  const [loading,         setLoading]         = useState(false);
  const [fetchErr,        setFetchErr]        = useState<string | null>(null);
  const [poiOrder,      setPoiOrder]      = useState<PoiEntry[]>([]);
  const [paliers,         setPaliers]         = useState<number[]>([]);
  const [areaMap,         setAreaMap]         = useState<Map<string, number>>(new Map());
  const [tooltip,         setTooltip]         = useState<{ x: number; y: number; text: string } | null>(null);
  const [progress,        setProgress]        = useState<{ current: number; total: number; poi: string; metricLabel: string } | null>(null);
  const [failedCount,     setFailedCount]     = useState(0);
  const [firstErr,        setFirstErr]        = useState<string | null>(null);
  const [failedGroups,    setFailedGroups]    = useState<Set<string>>(new Set());
  const abortRef  = useRef<AbortController | null>(null);
  const groupsRef = useRef<{ id: string; nom: string; geometries: string[] }[]>([]);

  const handleCancel = () => { abortRef.current?.abort(); };

  const handleExportJson = () => {
    const payload = {
      exportedAt:     new Date().toISOString(),
      displayMetric,
      computedMetrics: Object.fromEntries(
        [...computedMetrics.entries()].map(([k, v]) => [k, Object.fromEntries(v)]),
      ),
      poiOrder:         poiOrder.map(c => c.id),
      paliers,
      areaMap:            Object.fromEntries(areaMap),
      battleFeaturesCount: battleFeatures.length,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `coverage-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Build static state (groups) when features change ─────────────────────
  useEffect(() => {
    if (!battleFeatures.length) {
      setPoiOrder([]); setPaliers([]); setAreaMap(new Map());
      setComputedMetrics(new Map());
      groupsRef.current = [];
      return;
    }

    const poiGeoms  = new Map<string, { nom: string; ville?: string; geoms: string[] }>();
    const palierGeoms = new Map<number, string[]>();
    const areaByPoi = new Map<string, number>();
    const poisIdx     = new Map(pois.map(p => [p.id, p]));

    for (const f of battleFeatures) {
      if (!f?.geometry || !f?.properties) continue;
      const cid    = String(f.properties.cirfa_id ?? f.properties.id ?? '');
      const palier = Number(f.properties.palier ?? 0);
      const nom    = String(f.properties.nom ?? cid);
      if (!cid || !palier) continue;

      const geomStr = JSON.stringify(f.geometry);

      if (!poiGeoms.has(cid)) {
        const poi = poisIdx.get(cid);
        poiGeoms.set(cid, { nom, ville: poi?.ville, geoms: [] });
      }
      poiGeoms.get(cid)!.geoms.push(geomStr);

      if (!palierGeoms.has(palier)) palierGeoms.set(palier, []);
      palierGeoms.get(palier)!.push(geomStr);

      areaByPoi.set(cid, (areaByPoi.get(cid) ?? 0) + approxAreaKm2(f.geometry));
    }

    const sortedPaliers = [...palierGeoms.keys()].sort((a, b) => a - b);
    const poiList     = [...poiGeoms.entries()].map(([id, d]) => ({ id, nom: d.nom, ville: d.ville }));

    setPoiOrder(poiList);
    setPaliers(sortedPaliers);
    setAreaMap(areaByPoi);
    setComputedMetrics(new Map()); // reset on new battle
    setFailedCount(0);
    setFirstErr(null);
    setFailedGroups(new Set());

    // Build API groups :
    //   c__<id>        — couverture par POI (cacheable)
    //   total_pal__<N> — union dédupliquée de TOUS les POIs pour ce palier (jamais mis en cache)
    const groups: { id: string; nom: string; geometries: string[] }[] = [];
    for (const [cid, { nom, geoms }] of poiGeoms) {
      groups.push({ id: `c__${cid}`, nom, geometries: geoms });
    }
    // Un groupe total par palier — chaque groupe = toutes les géométries de ce palier (40 geoms max)
    for (const [palier, geoms] of palierGeoms) {
      groups.push({ id: `total_pal__${palier}`, nom: `Dédupliqué ${palier}min`, geometries: geoms });
    }
    groupsRef.current = groups;

    return () => { abortRef.current?.abort(); };
  }, [battleFeatures]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Launch all selected metrics sequentially ──────────────────────────────
  const handleLaunch = () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setFetchErr(null);
    setFailedCount(0);
    setFirstErr(null);
    setFailedGroups(new Set());
    setComputedMetrics(new Map()); // reset previous results

    const metricsToRun = METRICS.filter(m => selectedMetrics.has(m.key));
    const groups       = groupsRef.current;
    const allResults   = new Map<MetricKey, Map<string, number>>();

    (async () => {
      for (let mi = 0; mi < metricsToRun.length; mi++) {
        if (abort.signal.aborted) break;
        const { key: metric, label: metricLabel } = metricsToRun[mi];

        setDisplayMetric(metric);

        const res = await fetch('/api/coverage-stats', {
          method:  'POST',
          signal:  abort.signal,
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ poiGroups: groups, metric, battleCacheKey }),
        });

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          setFetchErr(err.error ?? `HTTP ${res.status}`);
          break;
        }

        const currentCovMap = new Map<string, number>();
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let   buf     = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as {
              type: 'start' | 'progress' | 'poi_result' | 'error_partial' | 'complete';
              total?: number; current?: number; poi?: string;
              data?: { group_id: string; coverage: number; nom: string };
              results?: { group_id: string; coverage: number; nom: string }[];
            };
            if (event.type === 'progress') {
              setProgress({ current: event.current ?? 0, total: event.total ?? 1, poi: event.poi ?? '', metricLabel });
            } else if (event.type === 'poi_result' && event.data) {
              currentCovMap.set(event.data.group_id, event.data.coverage);
              allResults.set(metric, new Map(currentCovMap));
              setComputedMetrics(new Map(allResults));
            } else if (event.type === 'error_partial') {
              setFailedCount(c => c + 1);
              setFirstErr(prev => prev ?? (event as any).message ?? null);
              if ((event as any).poi) setFailedGroups(prev => new Set([...prev, (event as any).poi]));
            } else if (event.type === 'complete' && event.results) {
              for (const r of event.results) currentCovMap.set(r.group_id, r.coverage);
              allResults.set(metric, new Map(currentCovMap));
              setComputedMetrics(new Map(allResults));
            }
          }
        }
      }
    })()
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setFetchErr(e.message);
      })
      .finally(() => {
        setLoading(false);
        setProgress(null);
        if (allResults.size > 0 && onResultsReady) {
          onResultsReady(
            METRICS
              .filter(m => allResults.has(m.key))
              .map(m => {
                const covByGroup = allResults.get(m.key)!;
                // total_pal__* = couverture dédupliquée par palier — prendre le max palier disponible
                const totalPalKeys = [...covByGroup.keys()].filter(k => k.startsWith('total_pal__'));
                const maxPal = totalPalKeys.length > 0
                  ? Math.max(...totalPalKeys.map(k => parseInt(k.replace('total_pal__', ''))))
                  : 0;
                const dedup = maxPal > 0 ? (covByGroup.get(`total_pal__${maxPal}`) ?? 0) : 0;
                return {
                  metric: m.key,
                  label:  m.label,
                  total: dedup || covByGroup.get('__total__') || 0,
                };
              }),
          );
        }
      });
  };

  // ── Active covMap for display ─────────────────────────────────────────────
  const covMap = useMemo(
    () => computedMetrics.get(displayMetric) ?? new Map<string, number>(),
    [computedMetrics, displayMetric],
  );

  // ── Derived colors ────────────────────────────────────────────────────────
  const poiColors = useMemo(() => {
    const m: Record<string, string> = {};
    poiOrder.forEach((c, i) => { m[c.id] = POI_PALETTE[i % POI_PALETTE.length]; });
    return m;
  }, [poiOrder]);

  // ── Chart 1 : coverage per POI ───────────────────────────────────────────
  const chart1: C1Entry[] = useMemo(() =>
    poiOrder
      .map(c => ({
        id:     c.id,
        name:   c.nom,
        value:  covMap.get(`c__${c.id}`) ?? 0,
        fill:   poiColors[c.id] ?? '#3b82f6',
        failed: failedGroups.has(`c__${c.id}`),
      }))
      .sort((a, b) => {
        // Failed entries go to the bottom, then sort by value desc
        if (a.failed && !b.failed) return 1;
        if (!a.failed && b.failed) return -1;
        return b.value - a.value;
      }),
    [poiOrder, covMap, poiColors, failedGroups],
  );

  // ── Chart 2 : stacked by palier (area-proportional) ──────────────────────
  const chart2: C2Row[] = useMemo(() =>
    chart1.map(c => {
      const totalArea = areaMap.get(c.id) ?? 0;
      const totalCov  = c.value;

      const palierAreaMap = new Map<number, number>();
      for (const f of battleFeatures) {
        const fCid = String(f.properties?.cirfa_id ?? f.properties?.id ?? '');
        if (fCid !== c.id || !f.geometry) continue;
        const p = Number(f.properties?.palier ?? 0);
        palierAreaMap.set(p, (palierAreaMap.get(p) ?? 0) + approxAreaKm2(f.geometry));
      }

      const segments = paliers.map(p => ({
        palier: p,
        color:  PALIER_COLORS[p] ?? '#888',
        value:  totalArea > 0 ? Math.round(totalCov * (palierAreaMap.get(p) ?? 0) / totalArea) : 0,
      }));
      return { name: c.name, segments };
    }),
    [chart1, paliers, battleFeatures, areaMap],
  );

  // ── Couverture dédupliquée par palier (depuis total_pal__*) ──────────────
  const deduplicatedPerPalier = useMemo(() => {
    const map = new Map<number, number>();
    for (const palier of paliers) {
      const v = covMap.get(`total_pal__${palier}`);
      if (v != null) map.set(palier, v);
    }
    return map;
  }, [covMap, paliers]);

  const maxPalier      = useMemo(() => paliers.length > 0 ? Math.max(...paliers) : 0, [paliers]);
  const maxPalierDedup = useMemo(() => deduplicatedPerPalier.get(maxPalier) ?? 0, [deduplicatedPerPalier, maxPalier]);

  // ── Chart 3 : cumulative coverage % (derived from chart2, ref = maxPalierDedup) ──
  const chart3: C3Point[] = useMemo(() => {
    if (!chart2.length || !paliers.length) return [];
    const totalCovAll = maxPalierDedup || chart1.reduce((s, c) => s + c.value, 0);
    if (!totalCovAll) return [];
    let cumulative = 0;
    return paliers.map(p => {
      const palierCov = chart2.reduce((s, row) => {
        const seg = row.segments.find(sg => sg.palier === p);
        return s + (seg?.value ?? 0);
      }, 0);
      cumulative += palierCov;
      return { label: `${p}min`, coverage: cumulative, pct: Math.round((cumulative / totalCovAll) * 100) };
    });
  }, [chart1, chart2, paliers, maxPalierDedup]);

  // ── Chart 4 : efficiency (pop/km²) ───────────────────────────────────────
  const chart4: C4Entry[] = useMemo(() =>
    chart1
      .map(c => {
        const area = areaMap.get(c.id) ?? 0;
        return { id: c.id, name: c.name, fill: c.fill, value: area > 0 ? Math.round(c.value / area) : 0 };
      })
      .sort((a, b) => b.value - a.value),
    [chart1, areaMap],
  );

  // ── Metric cards values ───────────────────────────────────────────────────
  // totalCov = couverture dédupliquée du plus grand palier (total_pal__<max>)
  const totalCov = useMemo(() => maxPalierDedup || (chart1.reduce((s, c) => s + c.value, 0)), [maxPalierDedup, chart1]);

  const tempsMovenAcces = useMemo(() => {
    if (!totalCov || !chart3.length) return null;
    let prev = 0, weighted = 0;
    for (const pt of chart3) {
      weighted += (pt.coverage - prev) * parseInt(pt.label);
      prev = pt.coverage;
    }
    return Math.round(weighted / totalCov);
  }, [chart3, totalCov]);

  const hasData = !fetchErr && computedMetrics.size > 0;
  const displayLabel = METRICS.find(m => m.key === displayMetric)?.label ?? displayMetric;
  const canLaunch    = !loading && battleFeatures.length > 0 && selectedMetrics.size > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={inline ? {
      display: 'flex', flexDirection: 'column',
    } : {
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, zIndex: 50,
      background: 'var(--bg-surface)', borderLeft: '0.5px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column',
      transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.2s ease',
      pointerEvents: isOpen ? 'auto' : 'none',
    } as React.CSSProperties}>

      {/* ── Header (non-inline only) ─────────────────────────────────────── */}
      {!inline && (
      <div style={{
        padding:      '14px 18px',
        borderBottom: '0.5px solid var(--border-subtle)',
        display:      'flex',
        alignItems:   'center',
        gap:          10,
        flexShrink:   0,
      }}>
        <span style={{
          fontFamily:    "'Inter', system-ui, sans-serif",
          fontSize:      11,
          fontWeight:    600,
          color:         'var(--brand-teal)',
          letterSpacing: '0.04em',
          flex:          1,
        }}>
          Analyse de couverture
        </span>
        {loading && progress && (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'var(--brand-teal)' }}>
            {progress.metricLabel} {progress.current}/{progress.total}
          </span>
        )}
        {hasData && (
          <span style={{
            fontFamily:   "'JetBrains Mono', monospace",
            fontSize:     10,
            color:        'var(--success)',
            background:   '#081a10',
            border:       '0.5px solid #14532d',
            borderRadius: 2,
            padding:      '2px 7px',
            flexShrink:   0,
          }}>
            {poiOrder.length} POI
          </span>
        )}
        {!loading && computedMetrics.size > 0 && (
          <button
            onClick={handleExportJson}
            title="Exporter JSON (debug)"
            style={{
              background:     'none',
              border:         '0.5px solid var(--border-subtle)',
              color:          'var(--success)',
              cursor:         'pointer',
              width:          22,
              height:         22,
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              borderRadius:   2,
              fontSize:       11,
              flexShrink:     0,
              lineHeight:     1,
              transition:     'border-color 0.2s ease',
            }}
          >
            ↓
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            background:     'none',
            border:         '0.5px solid var(--border-subtle)',
            color:          'var(--text-tertiary)',
            cursor:         'pointer',
            width:          22,
            height:         22,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            borderRadius:   2,
            fontSize:       12,
            flexShrink:     0,
            lineHeight:     1,
            transition:     'border-color 0.2s ease, color 0.2s ease',
          }}
        >
          ✕
        </button>
      </div>
      )}

      {/* ── Metric selector + Lancer ─────────────────────────────────────────── */}
      <div style={{
        padding:      '10px 18px',
        borderBottom: '0.5px solid var(--border-subtle)',
        flexShrink:   0,
        display:      'flex',
        flexDirection: 'column',
        gap:          8,
      }}>
        {/* Checkboxes grouped by category */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {METRIC_GROUPS.map(group => {
            const groupMetrics = METRICS.filter(m => m.group === group);
            return (
              <div key={group}>
                <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 8, fontWeight: 500, color: 'var(--text-tertiary)', letterSpacing: '0.06em', marginBottom: 4 }}>
                  {group}
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {groupMetrics.map(m => {
                    const checked = selectedMetrics.has(m.key);
                    return (
                      <button
                        key={m.key}
                        disabled={loading}
                        onClick={() => setSelectedMetrics(prev => {
                          const s = new Set(prev);
                          if (s.has(m.key)) s.delete(m.key); else s.add(m.key);
                          return s;
                        })}
                        style={{
                          background:    checked ? 'rgba(78,205,196,0.08)' : 'none',
                          border:        `0.5px solid ${checked ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                          color:         checked ? 'var(--brand-teal)' : 'var(--text-tertiary)',
                          fontFamily:    "'JetBrains Mono', monospace",
                          fontSize:      9,
                          padding:       '3px 8px',
                          borderRadius:  2,
                          cursor:        loading ? 'not-allowed' : 'pointer',
                          letterSpacing: 0.3,
                          flexShrink:    0,
                          opacity:       loading ? 0.5 : 1,
                          transition:    'all 0.2s ease',
                        }}
                      >
                        {checked ? '✓ ' : ''}{m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {/* Lancer button */}
        <button
          onClick={loading ? handleCancel : handleLaunch}
          disabled={!loading && !canLaunch}
          style={{
            background:    loading ? 'rgba(239,68,68,0.08)' : canLaunch ? 'rgba(78,205,196,0.08)' : 'none',
            border:        `0.5px solid ${loading ? 'var(--danger)' : canLaunch ? 'var(--brand-teal)' : 'var(--border-default)'}`,
            color:         loading ? 'var(--danger)' : canLaunch ? 'var(--brand-teal)' : 'var(--text-tertiary)',
            fontFamily:    "'JetBrains Mono', monospace",
            fontSize:      9,
            letterSpacing: 1,
            padding:       '5px 0',
            transition:    'all 0.2s ease',
            borderRadius:  2,
            cursor:        loading || canLaunch ? 'pointer' : 'not-allowed',
            width:         '100%',
          }}
        >
          {loading
            ? (progress ? `Annuler  (${progress.metricLabel} — ${progress.current}/${progress.total})` : 'Annuler')
            : `Lancer les calculs (${selectedMetrics.size} cible${selectedMetrics.size > 1 ? 's' : ''})`}
        </button>
      </div>

      {/* ── Display metric selector (among computed) ─────────────────────────── */}
      {computedMetrics.size > 1 && (
        <div style={{
          display:      'flex',
          gap:          4,
          padding:      '7px 18px',
          borderBottom: '0.5px solid var(--border-subtle)',
          flexShrink:   0,
          flexWrap:     'wrap',
        }}>
          <span style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 8, fontWeight: 500, color: 'var(--text-tertiary)', letterSpacing: '0.04em', alignSelf: 'center', marginRight: 2 }}>
            Afficher
          </span>
          {METRICS.filter(m => computedMetrics.has(m.key)).map(m => (
            <button
              key={m.key}
              onClick={() => setDisplayMetric(m.key)}
              style={{
                background:    displayMetric === m.key ? '#0d1a0d' : 'none',
                border:        `0.5px solid ${displayMetric === m.key ? 'var(--success)' : 'var(--border-default)'}`,
                color:         displayMetric === m.key ? 'var(--success)' : 'var(--text-tertiary)',
                fontFamily:    "'JetBrains Mono', monospace",
                fontSize:      9,
                padding:       '3px 9px',
                borderRadius:  2,
                cursor:        'pointer',
                letterSpacing: 0.5,
                transition:    'all 0.2s ease',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={inline ? { padding: '12px 0' } : { flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

        {/* Empty state */}
        {battleFeatures.length === 0 && !loading && (
          <div style={{
            color:      'var(--text-tertiary)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize:   11,
            textAlign:  'center',
            paddingTop: 60,
            lineHeight: 2,
          }}>
            Calculez des isochrones<br />
            <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
              Territoire → Isochrones<br />ou Bataille isochrones
            </span>
          </div>
        )}

        {/* Ready state — battle loaded but not yet computed */}
        {battleFeatures.length > 0 && !loading && computedMetrics.size === 0 && !fetchErr && (
          <div style={{
            color:      'var(--text-tertiary)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize:   10,
            textAlign:  'center',
            paddingTop: 60,
            lineHeight: 2,
          }}>
            {poiOrder.length} POI · {paliers.length} palier{paliers.length > 1 ? 's' : ''}<br />
            <span style={{ color: 'var(--text-tertiary)', fontSize: 9 }}>Sélectionnez les cibles et lancez le calcul</span>
          </div>
        )}

        {/* Partial failures warning */}
        {!loading && failedCount > 0 && !fetchErr && (
          <div style={{
            fontFamily:   "'JetBrains Mono', monospace",
            fontSize:     9,
            color:        '#f59e0b',
            background:   'var(--bg-level-2)',
            border:       '0.5px solid #78350f',
            borderRadius: 2,
            padding:      '6px 10px',
            marginBottom: 12,
            lineHeight:   1.7,
          }}>
            ! {failedCount} groupe(s) non calculé(s) — affiché "! erreur" dans le graphique
            {failedGroups.size > 0 && (
              <div style={{ color: '#92400e', marginTop: 3, fontSize: 8 }}>
                {[...failedGroups].map(g => g.replace('c__', '').replace('total_pal__', 'pal ')).join(', ')}
              </div>
            )}
            {firstErr && (
              <div style={{ color: 'var(--text-tertiary)', marginTop: 3, fontSize: 8 }}>
                {firstErr.slice(0, 120)}
              </div>
            )}
          </div>
        )}

        {/* Fatal error */}
        {fetchErr && (
          <div style={{
            color:        'var(--danger)',
            fontFamily:   "'JetBrains Mono', monospace",
            fontSize:     10,
            padding:      12,
            border:       '0.5px solid var(--danger)',
            borderRadius: 2,
            marginBottom: 16,
            lineHeight:   1.8,
          }}>
            {fetchErr.includes('timeout') || fetchErr.includes('Timeout') || fetchErr.includes('canceling')
              ? 'Timeout — vérifiez que la migration SQL 043 est appliquée dans Supabase.'
              : fetchErr.includes('relation') || fetchErr.includes('column') || fetchErr.includes('carreaux')
              ? 'Table INSEE Filosofi non connectée — données population indisponibles.'
              : `Erreur : ${fetchErr.slice(0, 200)}`}
          </div>
        )}

        {/* Progress bar */}
        {loading && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{
                flex:         1,
                fontFamily:   "'JetBrains Mono', monospace",
                fontSize:     9,
                color:        'var(--text-tertiary)',
                letterSpacing: 0.5,
                overflow:     'hidden',
                textOverflow: 'ellipsis',
                whiteSpace:   'nowrap',
              }}>
                {progress
                  ? `[${progress.metricLabel}] ${progress.poi.replace('c__', '')}…`
                  : 'Initialisation...'}
              </div>
            </div>
            <div style={{ height: 3, background: 'var(--bg-level-2)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height:     '100%',
                borderRadius: 2,
                background: 'var(--brand-teal)',
                width:      progress ? `${Math.round((progress.current / progress.total) * 100)}%` : '0%',
                transition: 'width 0.2s ease',
              }} />
            </div>
            {/* Skeleton only when no data yet */}
            {!hasData && (
              <div style={{ marginTop: 12 }}>
                {[120, 80, 160, 100].map((h, i) => (
                  <div
                    key={i}
                    style={{
                      height:         h,
                      background:     'var(--bg-level-2)',
                      borderRadius:   4,
                      marginBottom:   12,
                      animation:      'covPulse 1.5s ease-in-out infinite',
                      animationDelay: `${i * 0.15}s`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── DATA CONTENT ────────────────────────────────────────────────── */}
        {hasData && (
          <>
            {/* ── Big number : couverture dédupliquée + metric cards ── */}
            {maxPalierDedup > 0 && (
              <div style={{
                background:   'rgba(78,205,196,0.04)',
                border:       '0.5px solid rgba(78,205,196,0.25)',
                borderRadius: 2,
                padding:      '14px 16px',
                marginBottom: 14,
                display:      'flex',
                alignItems:   'center',
                gap:          14,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily:    "'Inter', system-ui, sans-serif",
                    fontSize:      8,
                    fontWeight:    500,
                    color:         'var(--brand-teal)',
                    letterSpacing: '0.06em',
                    marginBottom:  6,
                  }}>
                    Couverture dédupliquée — {maxPalier}min
                  </div>
                  <div style={{
                    fontFamily:  "'JetBrains Mono', monospace",
                    fontSize:    32,
                    fontWeight:  700,
                    color:       'var(--brand-teal)',
                    lineHeight:  1,
                    marginBottom: 4,
                  }}>
                    {fmtNum(maxPalierDedup)}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'var(--brand-teal-50)' }}>
                    hab. uniques — sans double comptage
                  </div>
                </div>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize:   28,
                  color:      'rgba(78,205,196,0.2)',
                  lineHeight: 1,
                  userSelect: 'none',
                }}>
                  ◆
                </div>
              </div>
            )}

            {/* ── 2 Metric cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 22 }}>
              <MetricCard
                label={`${displayLabel} — somme POI`}
                value={fmtNum(chart1.reduce((s, c) => s + c.value, 0))}
                sub={`${poiOrder.length} points (avec doublons)`}
                color="var(--success)"
              />
              <MetricCard
                label="Accès médian"
                value={tempsMovenAcces != null ? `${tempsMovenAcces} min` : '—'}
                sub="temps pondéré"
                color="var(--brand-teal)"
              />
            </div>

            {/* ── Chart 1 : Classement population ── */}
            <Section title={`Couverture par point — ${displayLabel}`}>
              <HBarChart
                data={chart1.map(c => ({ label: c.name, value: c.value, color: c.fill, failed: c.failed }))}
                formatValue={fmtNum}
                onHover={setTooltip}
              />
            </Section>

            {/* ── Chart 2 : Stacked by palier ── */}
            {paliers.length > 1 && (
              <Section title="Qualité de couverture (par temps de trajet)">
                <PalierLegend paliers={paliers} />
                <StackedHBarChart
                  data={chart2}
                  formatValue={fmtNum}
                  onHover={setTooltip}
                />
              </Section>
            )}

            {/* ── Chart 3b : Couverture dédupliquée par palier ── */}
            {deduplicatedPerPalier.size > 0 && (
              <Section title="Couverture dédupliquée par isochrone (sans double comptage)">
                <HBarChart
                  data={[...deduplicatedPerPalier.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([p, v]) => ({
                      label: `${p} min`,
                      value: v,
                      color: PALIER_COLORS[p] ?? '#4ecdc4',
                    }))}
                  formatValue={fmtNum}
                  onHover={setTooltip}
                />
              </Section>
            )}

            {/* ── Chart 3 : Couverture cumulée ── */}
            {chart3.length > 1 && (
              <Section title="Couverture cumulée (estimation)">
                <AreaLineChart data={chart3} onHover={setTooltip} />
              </Section>
            )}

            {/* ── Chart 4 : Efficacité territoriale ── */}
            <Section title="Efficacité territoriale (hab/km²)">
              <HBarChart
                data={chart4.map(c => ({ label: c.name, value: c.value, color: c.fill }))}
                formatValue={v => v.toLocaleString('fr-FR')}
                onHover={setTooltip}
              />
            </Section>

            {/* ── Insights ── */}
            <div style={{
              background:   'var(--bg-level-2)',
              border:       '0.5px solid var(--border-subtle)',
              borderLeft:   '2px solid rgba(78,205,196,0.25)',
              borderRadius: 4,
              padding:      '14px 16px',
              marginTop:    4,
              marginBottom: 8,
            }}>
              <div style={{
                fontFamily:    "'Inter', system-ui, sans-serif",
                fontSize:      10,
                fontWeight:    600,
                color:         'var(--brand-teal)',
                letterSpacing: '0.04em',
                marginBottom:  12,
              }}>
                Insights
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <InsightLine color="var(--border-default)" text="Chevauchement entre zones" note="bientôt disponible" />
                <InsightLine color="var(--border-default)" text="Top 5 communes non couvertes" note="bientôt disponible" />
                <InsightLine color="var(--border-default)" text="Équité territoriale (score)" note="bientôt disponible" />
                <InsightLine color="var(--border-default)" text="Simulation d'ajout de point" note="bientôt disponible" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Tooltip flottant ─────────────────────────────────────────────────── */}
      {tooltip && (
        <div style={{
          position:      'fixed',
          left:          tooltip.x + 12,
          top:           tooltip.y - 8,
          background:    'var(--bg-level-2)',
          border:        '0.5px solid var(--border-default)',
          borderRadius:  2,
          padding:       '5px 9px',
          fontFamily:    "'JetBrains Mono', monospace",
          fontSize:      11,
          color:         'var(--text-primary)',
          zIndex:        60,
          pointerEvents: 'none',
          whiteSpace:    'nowrap',
        }}>
          {tooltip.text}
        </div>
      )}

      <style>{`
        @keyframes covPulse {
          0%, 100% { opacity: 0.3; }
          50%       { opacity: 0.6; }
        }
        @keyframes covFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cov-row-stagger { animation: covFadeIn 0.2s ease both; }
        @media (prefers-reduced-motion: reduce) {
          .cov-row-stagger { animation: none; }
          * { transition-duration: 0s !important; animation-duration: 0s !important; }
        }
      `}</style>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ──────────────────────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{
      background:   'var(--bg-level-2)',
      border:       '0.5px solid var(--border-subtle)',
      borderRadius: 4,
      padding:      '10px 10px 8px',
    }}>
      <div style={{
        fontFamily:    "'Inter', system-ui, sans-serif",
        fontSize:      8,
        fontWeight:    500,
        color:         'var(--text-tertiary)',
        letterSpacing: '0.04em',
        marginBottom:  6,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily:   "'JetBrains Mono', monospace",
        fontSize:     20,
        fontWeight:   700,
        color,
        lineHeight:   1,
        marginBottom: 4,
      }}>
        {value}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'var(--text-tertiary)' }}>
        {sub}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontFamily:    "'Inter', system-ui, sans-serif",
        fontSize:      9,
        fontWeight:    500,
        color:         'var(--text-secondary)',
        letterSpacing: '0.04em',
        marginBottom:  10,
        paddingLeft:   8,
        borderLeft:    '2px solid rgba(78,205,196,0.25)',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InsightLine({ color, text, note }: { color: string; text: string; note: string }) {
  return (
    <div style={{
      display:    'flex',
      alignItems: 'center',
      gap:        8,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize:   10,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color: 'var(--text-tertiary)' }}>{text}</span>
      <span style={{ color: 'var(--border-hover)', fontStyle: 'italic', marginLeft: 'auto', flexShrink: 0 }}>{note}</span>
    </div>
  );
}

function PalierLegend({ paliers }: { paliers: number[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
      {paliers.map(p => (
        <span key={p} style={{
          fontFamily:   "'JetBrains Mono', monospace",
          fontSize:     9,
          color:        PALIER_COLORS[p] ?? '#888',
          background:   'var(--bg-surface)',
          border:       `0.5px solid ${PALIER_COLORS[p] ?? '#888'}`,
          borderRadius: 2,
          padding:      '2px 6px',
        }}>
          {p}min
        </span>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SVG CHARTS
// ──────────────────────────────────────────────────────────────────────────────

const ROW_H     = 26;
const LABEL_W   = 110;
const BAR_GAP   = 4;
const CHART_PAD = { top: 4, right: 50, bottom: 4, left: LABEL_W + 8 };

interface HBarItem { label: string; value: number; color: string; failed?: boolean }

function HBarChart({
  data, formatValue, onHover,
}: {
  data: HBarItem[];
  formatValue: (v: number) => string;
  onHover: (t: { x: number; y: number; text: string } | null) => void;
}) {
  const max    = Math.max(...data.filter(d => !d.failed).map(d => d.value), 1);
  const barW   = 384 - CHART_PAD.left - CHART_PAD.right;
  const height = data.length * (ROW_H + BAR_GAP) + CHART_PAD.top + CHART_PAD.bottom;

  return (
    <svg width="100%" viewBox={`0 0 384 ${height}`} style={{ overflow: 'visible' }}>
      {data.map((d, i) => {
        const y     = CHART_PAD.top + i * (ROW_H + BAR_GAP);
        const color = d.failed ? '#7f1d1d' : d.color;
        const w     = d.failed || d.value === 0 ? 0 : Math.max((d.value / max) * barW, 2);
        return (
          <g key={i} className="cov-row-stagger" style={{ animationDelay: `${i * 0.04}s` }}>
            <text
              x={LABEL_W}
              y={y + ROW_H / 2 + 4}
              textAnchor="end"
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fill: d.failed ? 'var(--text-tertiary)' : 'var(--text-secondary)' }}
            >
              {d.label.length > 14 ? d.label.slice(0, 13) + '…' : d.label}
            </text>
            <rect x={CHART_PAD.left} y={y + 4} width={barW} height={ROW_H - 8} rx={2} fill="var(--bg-level-2)" />
            {w > 0 && (
              <rect
                x={CHART_PAD.left} y={y + 4}
                width={w} height={ROW_H - 8}
                rx={2} fill={color}
                style={{ cursor: 'default', transition: 'width 0.2s ease' }}
                onMouseMove={e => onHover({ x: e.clientX, y: e.clientY, text: `${d.label} — ${d.value.toLocaleString('fr-FR')} hab` })}
                onMouseLeave={() => onHover(null)}
              />
            )}
            <text
              x={CHART_PAD.left + w + 4}
              y={y + ROW_H / 2 + 4}
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fill: color }}
            >
              {d.failed ? '! erreur' : d.value === 0 ? '0' : formatValue(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function StackedHBarChart({
  data, formatValue, onHover,
}: {
  data: C2Row[];
  formatValue: (v: number) => string;
  onHover: (t: { x: number; y: number; text: string } | null) => void;
}) {
  const maxTotal = Math.max(...data.map(r => r.segments.reduce((s, sg) => s + sg.value, 0)), 1);
  const barW     = 384 - CHART_PAD.left - CHART_PAD.right;
  const height   = data.length * (ROW_H + BAR_GAP) + CHART_PAD.top + CHART_PAD.bottom;

  return (
    <svg width="100%" viewBox={`0 0 384 ${height}`} style={{ overflow: 'visible' }}>
      {data.map((row, i) => {
        const y     = CHART_PAD.top + i * (ROW_H + BAR_GAP);
        const total = row.segments.reduce((s, sg) => s + sg.value, 0);
        let   xOff  = 0;
        return (
          <g key={i}>
            <text
              x={LABEL_W}
              y={y + ROW_H / 2 + 4}
              textAnchor="end"
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fill: 'var(--text-secondary)' }}
            >
              {row.name.length > 14 ? row.name.slice(0, 13) + '…' : row.name}
            </text>
            <rect x={CHART_PAD.left} y={y + 4} width={barW} height={ROW_H - 8} rx={2} fill="var(--bg-level-2)" />
            {row.segments.map((sg, j) => {
              const w = Math.max((sg.value / maxTotal) * barW, sg.value > 0 ? 2 : 0);
              const x = CHART_PAD.left + xOff;
              xOff += w;
              return (
                <rect
                  key={j}
                  x={x} y={y + 4}
                  width={w} height={ROW_H - 8}
                  rx={j === 0 ? 2 : 0}
                  fill={sg.color}
                  style={{ cursor: 'default' }}
                  onMouseMove={e => onHover({ x: e.clientX, y: e.clientY, text: `${row.name} ${sg.palier}min — ${sg.value.toLocaleString('fr-FR')} hab` })}
                  onMouseLeave={() => onHover(null)}
                />
              );
            })}
            <text
              x={CHART_PAD.left + (total / maxTotal) * barW + 4}
              y={y + ROW_H / 2 + 4}
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fill: 'var(--text-secondary)' }}
            >
              {formatValue(total)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function AreaLineChart({
  data, onHover,
}: {
  data: C3Point[];
  onHover: (t: { x: number; y: number; text: string } | null) => void;
}) {
  const W = 384, H = 160;
  const PAD = { top: 16, right: 20, bottom: 28, left: 36 };
  const gW = W - PAD.left - PAD.right;
  const gH = H - PAD.top - PAD.bottom;
  const n  = data.length;
  if (n < 2) return null;

  const xOf = (i: number) => PAD.left + (i / (n - 1)) * gW;
  const yOf = (pct: number) => PAD.top + gH - (pct / 100) * gH;

  const pts  = data.map((d, i) => `${xOf(i)},${yOf(d.pct)}`).join(' ');
  const area = `M${xOf(0)},${yOf(0)} ` +
    data.map((d, i) => `L${xOf(i)},${yOf(d.pct)}`).join(' ') +
    ` L${xOf(n - 1)},${PAD.top + gH} L${xOf(0)},${PAD.top + gH} Z`;

  const y80 = yOf(80);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#378ADD" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#378ADD" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map(pct => (
        <g key={pct}>
          <line x1={PAD.left} x2={PAD.left + gW} y1={yOf(pct)} y2={yOf(pct)} stroke="var(--border-subtle)" strokeWidth={1} />
          <text x={PAD.left - 4} y={yOf(pct) + 4} textAnchor="end" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: 'var(--text-tertiary)' }}>
            {pct}%
          </text>
        </g>
      ))}
      <line x1={PAD.left} x2={PAD.left + gW} y1={y80} y2={y80} stroke="var(--text-tertiary)" strokeWidth={1} strokeDasharray="5 3" />
      <text x={PAD.left + gW - 2} y={y80 - 3} textAnchor="end" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: 'var(--text-tertiary)' }}>
        Objectif 80%
      </text>
      <path d={area} fill="url(#areaGrad)" />
      <polyline points={pts} fill="none" stroke="#378ADD" strokeWidth={2} strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle
            cx={xOf(i)} cy={yOf(d.pct)} r={4}
            fill="var(--bg-surface)" stroke="#378ADD" strokeWidth={2}
            style={{ cursor: 'default' }}
            onMouseMove={e => onHover({ x: e.clientX, y: e.clientY, text: `${d.label} — ${d.pct}% (${d.coverage.toLocaleString('fr-FR')} hab)` })}
            onMouseLeave={() => onHover(null)}
          />
          <text x={xOf(i)} y={H - PAD.bottom + 14} textAnchor="middle" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fill: 'var(--text-tertiary)' }}>
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
