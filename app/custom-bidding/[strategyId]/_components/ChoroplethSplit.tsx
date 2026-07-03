'use client';

/**
 * Vue cartographique du module Pilotage ML.
 *
 * Deux modes pilotés par un toggle au-dessus :
 *
 *   • mode='compare' (défaut) — split-screen synchronisé :
 *       - gauche : "Diffusion sans MAGELIAN"  → palette MONO-GRIS sur la métrique réelle
 *       - droite : "Diffusion avec MAGELIAN" → palette TEAL    sur la métrique simulée
 *       (mêmes percentiles partagés pour comparaison équitable)
 *
 *   • mode='impact' — carte unique plein largeur :
 *       - palette divergente ROUGE → BLANC → VERT sur Δ = sim − real
 *       - vert  = zones boostées par MAGELIAN
 *       - rouge = zones désexposées par MAGELIAN
 *
 * Sur les 3 cartes (gauche, droite, impact), une couche outline TEAL marque
 * les zones cibles (top-quartile de la variable INSEE pondérante, ex.
 * abstention). C'est le pont visuel : on voit la cible (outline) ET la
 * diffusion (couleur).
 */
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { computePercentiles, buildFillExpression, type Percentiles } from '@/app/map/analyse/digital/_lib/palettes';
import type { PrimaryMetric } from '@/lib/bidding-ml/metric-labels';
import { metricFields, getMetricLabels } from '@/lib/bidding-ml/metric-labels';

const SyncMap = dynamic(
  () => import('@/app/map/analyse/digital/_components/SyncMap').then(m => ({ default: m.SyncMap })),
  { ssr: false },
);

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

// Palettes locales (override des palettes du module digital pour cohérence pitch)
const PALETTE_GRAY = ['#0a0a0a', '#1f1f1f', '#3a3a3a', '#5e5e5e', '#8a8a8a', '#cfcfcf'];
const PALETTE_TEAL = ['#0a0a0a', '#16537e', '#1e8a7a', '#4ecdc4', '#7eddd5', '#f7fff7'];
// Divergente : rouge intense → rouge clair → blanc → vert clair → vert intense
const PALETTE_DIVERGENT = ['#a50f15', '#fcae91', '#fee5d9', '#ffffff', '#bae4b3', '#74c476', '#238b45'];

interface Props {
  /** GeoJSON enrichi avec props { code_postal, leads_real, leads_sim, ... } + is_target. */
  geojson: GeoJSON.FeatureCollection | null;
  /** Métrique principale (impressions / clics / leads / spend). */
  metric: PrimaryMetric;
  /** Date du jour courant (pour le titre). */
  currentDate?: string;
  /** Label de la cible (ex: "zones à fort taux d'abstention"). */
  targetLabel?: string;
  /** Indique si une cible INSEE est définie (sinon : pas d'outline). */
  hasTarget?: boolean;
}

type ViewMode = 'compare' | 'impact';

export function ChoroplethSplit({ geojson, metric, currentDate, targetLabel = 'zones cibles', hasTarget = false }: Props) {
  const [mode, setMode] = useState<ViewMode>('compare');
  const labels = getMetricLabels(metric);
  const fields = metricFields(metric);
  const deltaField = `${metric}_delta`;

  // Percentiles partagés entre les deux cartes en mode compare (équité visuelle).
  const percentiles: Percentiles = useMemo(() => {
    if (!geojson) return { p10: 0, p25: 1, p50: 10, p75: 100, p90: 1000, max: 10000 };
    const values: number[] = [];
    for (const f of geojson.features) {
      const r = Number(f.properties?.[fields.real] ?? 0);
      const s = Number(f.properties?.[fields.sim] ?? 0);
      if (r > 0) values.push(r);
      if (s > 0) values.push(s);
    }
    return computePercentiles(values);
  }, [geojson, fields.real, fields.sim]);

  // Bornes de la palette divergente (mode impact) : symétriques autour de 0.
  const deltaMaxAbs = useMemo(() => {
    if (!geojson) return 1;
    let m = 0;
    for (const f of geojson.features) {
      const d = Math.abs(Number(f.properties?.[deltaField] ?? 0));
      if (d > m) m = d;
    }
    return m > 0 ? m : 1;
  }, [geojson, deltaField]);

  const fillReal = useMemo(
    () => buildFillExpression(fields.real, PALETTE_GRAY, percentiles, false),
    [fields.real, percentiles],
  );
  const fillSim = useMemo(
    () => buildFillExpression(fields.sim, PALETTE_TEAL, percentiles, false),
    [fields.sim, percentiles],
  );
  const fillDelta = useMemo(() => {
    // Palette divergente symétrique : -max → 0 → +max
    const stops = PALETTE_DIVERGENT;
    const half = Math.ceil(stops.length / 2);
    const negStops = stops.slice(0, half);
    const posStops = stops.slice(stops.length - half);
    const pairs: (string | number)[] = [];
    // -max, ..., 0, ..., +max — interpolation linéaire
    const step = deltaMaxAbs / (half - 1);
    for (let i = 0; i < half; i++) {
      pairs.push(-deltaMaxAbs + i * step, negStops[i]);
    }
    for (let i = 1; i < half; i++) {
      pairs.push(i * step, posStops[i]);
    }
    return [
      'case',
      ['==', ['has', deltaField], false], '#1a1a1a',
      ['interpolate', ['linear'], ['to-number', ['get', deltaField], 0], ...pairs],
    ];
  }, [deltaField, deltaMaxAbs]);

  // Outline cible : teal opaque pour zones cibles, gris très discret sinon.
  const lineColorExpr = useMemo(() => (
    hasTarget
      ? ['case', ['==', ['get', 'is_target'], true], '#4ecdc4', 'rgba(255,255,255,0.04)']
      : undefined
  ), [hasTarget]);
  const lineWidthExpr = useMemo(() => (
    hasTarget
      ? ['case', ['==', ['get', 'is_target'], true], 1.4, 0.3]
      : undefined
  ), [hasTarget]);

  // Sync de pan/zoom entre les 2 cartes via state parent (bidirectionnel).
  const [view, setView] = useState<{ center: [number, number]; zoom: number; bearing: number; pitch: number } | null>(null);
  const onMove = (center: [number, number], zoom: number, bearing: number, pitch: number) => {
    setView({ center, zoom, bearing, pitch });
  };

  // Workaround SyncMap (cf. version précédente) : publier en plusieurs vagues
  // pour s'assurer que setData() se fait après l'event 'load' du basemap.
  const [delayedGeoJSON, setDelayedGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => {
    if (!geojson) {
      setDelayedGeoJSON(null);
      return;
    }
    const timers = [350, 1500, 3000].map(ms =>
      setTimeout(() => setDelayedGeoJSON({ ...geojson }), ms),
    );
    return () => { timers.forEach(clearTimeout); };
  }, [geojson]);

  return (
    <div style={{ padding: '0 12px' }}>
      {/* Toggle de vue */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'inline-flex', padding: 2, gap: 2,
            background: 'rgba(255,255,255,0.04)',
            border: '0.5px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
          }}
        >
          <ToggleBtn active={mode === 'compare'} onClick={() => setMode('compare')}>
            Comparaison
          </ToggleBtn>
          <ToggleBtn active={mode === 'impact'} onClick={() => setMode('impact')}>
            Vue impact
          </ToggleBtn>
        </div>
        {hasTarget && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)' }}>
            <span style={{ width: 14, height: 0, borderTop: '1.5px solid #4ecdc4' }} />
            Outline = {targetLabel}
          </div>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
          {currentDate ? `jour : ${currentDate}` : ''}
        </div>
      </div>

      {mode === 'compare' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, height: 360 }}>
          <MapPanel
            id="custom-bidding-real"
            title="Diffusion sans MAGELIAN"
            subtitle={`${labels.name.toLowerCase()} réel(le)s · palette neutre`}
            dotColor="#8a8a8a"
            geojson={delayedGeoJSON}
            fillExpression={fillReal}
            lineColorExpr={lineColorExpr}
            lineWidthExpr={lineWidthExpr}
            onMove={onMove}
            syncTarget={view}
            metricLabel={labels.name}
            paletteStops={PALETTE_GRAY}
            paletteScale={[percentiles.p10, percentiles.p90]}
          />
          <MapPanel
            id="custom-bidding-sim"
            title="Diffusion avec MAGELIAN"
            subtitle={`${labels.name.toLowerCase()} simulé(e)s · concentré sur cible`}
            dotColor="var(--brand-teal)"
            geojson={delayedGeoJSON}
            fillExpression={fillSim}
            lineColorExpr={lineColorExpr}
            lineWidthExpr={lineWidthExpr}
            onMove={onMove}
            syncTarget={view}
            metricLabel={labels.name}
            paletteStops={PALETTE_TEAL}
            paletteScale={[percentiles.p10, percentiles.p90]}
          />
        </div>
      ) : (
        <div style={{ height: 440 }}>
          <MapPanel
            id="custom-bidding-impact"
            title="Impact direct MAGELIAN"
            subtitle={`Δ ${labels.name.toLowerCase()} = avec algo − sans algo · vert = boosté · rouge = désexposé`}
            dotColor="var(--brand-teal)"
            geojson={delayedGeoJSON}
            fillExpression={fillDelta}
            lineColorExpr={lineColorExpr}
            lineWidthExpr={lineWidthExpr}
            onMove={onMove}
            syncTarget={view}
            metricLabel={`Δ ${labels.name}`}
            paletteStops={PALETTE_DIVERGENT}
            paletteScale={[-deltaMaxAbs, deltaMaxAbs]}
            divergent
          />
        </div>
      )}
    </div>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
        background: active ? 'var(--brand-teal)' : 'transparent',
        color: active ? '#050505' : 'var(--text-secondary)',
        border: 'none', borderRadius: 4, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

interface PanelProps {
  id: string;
  title: string;
  subtitle: string;
  dotColor: string;
  geojson: GeoJSON.FeatureCollection | null;
  fillExpression: unknown[];
  lineColorExpr: unknown[] | undefined;
  lineWidthExpr: unknown[] | undefined;
  onMove: (c: [number, number], z: number, b: number, p: number) => void;
  syncTarget: { center: [number, number]; zoom: number; bearing: number; pitch: number } | null;
  metricLabel: string;
  paletteStops: string[];
  paletteScale: [number, number];
  divergent?: boolean;
}

function MapPanel({
  id, title, subtitle, dotColor, geojson, fillExpression,
  lineColorExpr, lineWidthExpr, onMove, syncTarget, metricLabel,
  paletteStops, paletteScale, divergent,
}: PanelProps) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        background: 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.08)',
        borderRadius: 8, overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8,
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          <div style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtitle}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <SyncMap
          id={id}
          geojson={geojson}
          fillExpression={fillExpression}
          lineColorExpr={lineColorExpr}
          lineWidthExpr={lineWidthExpr}
          onMove={onMove}
          syncTarget={syncTarget}
          showFeatureHover
          metricLabel={metricLabel}
          hideAdminBoundaries
        />
      </div>
      <PaletteLegend stops={paletteStops} scale={paletteScale} divergent={divergent} />
    </div>
  );
}

function PaletteLegend({ stops, scale, divergent }: { stops: string[]; scale: [number, number]; divergent?: boolean }) {
  const fmt = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    if (a >= 10) return Math.round(v).toString();
    return v.toFixed(1);
  };
  const gradient = `linear-gradient(to right, ${stops.join(', ')})`;
  return (
    <div style={{ padding: '6px 12px 8px', borderTop: '0.5px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
      <div style={{ height: 6, borderRadius: 3, background: gradient, marginBottom: 4 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
        <span>{divergent ? `−${fmt(Math.abs(scale[0]))}` : fmt(scale[0])}</span>
        {divergent && <span>0</span>}
        <span>{divergent ? `+${fmt(Math.abs(scale[1]))}` : fmt(scale[1])}</span>
      </div>
    </div>
  );
}
