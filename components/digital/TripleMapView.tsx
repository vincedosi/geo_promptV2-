'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { SyncMap } from '@/app/map/analyse/digital/_components/SyncMap';
import { MapLegend } from '@/app/map/analyse/digital/_components/MapLegend';
import { useDigitalData } from '@/app/map/analyse/digital/_lib/use-digital-data';
import { PALETTES, RATIO_PALETTE, computePercentiles, buildFillExpression } from '@/app/map/analyse/digital/_lib/palettes';
import { adminFetch } from '@/lib/admin-fetch';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

// POP_LABELS généré dynamiquement depuis IRIS_DB_COLUMNS — source unique
// entre l'accordéon IRIS et la section Campagnes média.
const POP_LABELS: Record<string, string> = Object.fromEntries(
  IRIS_DB_COLUMNS.map(c => [c.name, c.label]),
);

interface PalPickerProps {
  palettes: { id: string; stops: string[] }[];
  selected: string;
  onChange: (id: string) => void;
}

function PalettePicker({ palettes, selected, onChange }: PalPickerProps) {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {palettes.map(p => (
        <button key={p.id} onClick={() => onChange(p.id)} style={{
          width: 18, height: 10, borderRadius: 2, cursor: 'pointer', padding: 0,
          background: `linear-gradient(to right, ${p.stops.join(', ')})`,
          border: `1.5px solid ${selected === p.id ? 'var(--text-primary)' : 'transparent'}`,
          transition: 'border-color 150ms var(--ease-hover)',
        }} />
      ))}
    </div>
  );
}

function SingleMapPanel({ title, titleAccent, palettes, palette, onPaletteChange, inverted, onInvertedChange, mapId, geojson, fillExpression, lineColor, onMove, syncTarget, zoomOffset, percentiles, legendStops, legendMin, legendMid, legendMax, showFeatureHover, metricLabel }: {
  title: string;
  titleAccent?: string;
  palettes: { id: string; stops: string[] }[];
  palette: string;
  onPaletteChange: (id: string) => void;
  inverted: boolean;
  onInvertedChange: (v: boolean) => void;
  mapId: string;
  geojson: GeoJSON.FeatureCollection | null;
  fillExpression: unknown[];
  lineColor: string;
  onMove: (center: [number, number], zoom: number, bearing: number, pitch: number) => void;
  syncTarget: { center: [number, number]; zoom: number; bearing: number; pitch: number } | null;
  zoomOffset?: number;
  percentiles: { p50: number; max: number } | null;
  legendStops: string[];
  legendMin: string;
  legendMid: string;
  legendMax: string;
  showFeatureHover?: boolean;
  metricLabel?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '6px 10px', fontFamily: fInter, borderBottom: '0.5px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {title}{titleAccent && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--brand-teal)', marginLeft: 4 }}>{titleAccent}</span>}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {palettes.length > 0 && <PalettePicker palettes={palettes} selected={palette} onChange={onPaletteChange} />}
          {palettes.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', fontSize: 9, color: 'var(--text-tertiary)' }}>
              <input type="checkbox" checked={inverted} onChange={e => onInvertedChange(e.target.checked)} style={{ accentColor: 'var(--brand-teal)', width: 9, height: 9 }} />
              inv
            </label>
          )}
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <SyncMap
          id={mapId} geojson={geojson} fillExpression={fillExpression} lineColor={lineColor}
          onMove={onMove} syncTarget={syncTarget} zoomOffset={zoomOffset}
          showFeatureHover={showFeatureHover} metricLabel={metricLabel}
        />
      </div>
      {percentiles && <MapLegend title={title} stops={legendStops} minLabel={legendMin} midLabel={legendMid} maxLabel={legendMax} />}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface TripleMapViewProps {
  campaignId: string;
  scale: string;
  popField: string;
  metric: string;
  selectedMedia?: string[];
}

export function TripleMapView({ campaignId, scale, popField, metric, selectedMedia }: TripleMapViewProps) {
  const { theme } = useTheme();
  const { geojson, geojsonLoading, fetchMap } = useDigitalData();

  // Stable ref for selectedMedia to avoid useEffect re-trigger on array identity change
  const mediaRef = useRef(selectedMedia ?? []);
  mediaRef.current = selectedMedia ?? [];

  // Palette state per map
  // Default plasma pour les 3 cartes (vue comparée). Ajustable via le picker
  // en header de chaque carte si l'user veut diversifier.
  const [impPalette, setImpPalette] = useState('plasma');
  const [impInverted, setImpInverted] = useState(false);
  const [popPalette, setPopPalette] = useState('plasma');
  const [popInverted, setPopInverted] = useState(false);
  const [ratioPalette, setRatioPalette] = useState('plasma');
  const [ratioInverted, setRatioInverted] = useState(false);

  // Sync state
  const [syncState, setSyncState] = useState<{
    center: [number, number]; zoom: number; bearing: number; pitch: number;
  } | null>(null);
  const [syncSource, setSyncSource] = useState<string | null>(null);

  const handleMove = useCallback((source: string) => (center: [number, number], zoom: number, bearing: number, pitch: number) => {
    setSyncSource(source);
    setSyncState({ center, zoom, bearing, pitch });
  }, []);

  // Fetch map data when props change (use mediaRef to avoid array identity changes)
  useEffect(() => {
    if (campaignId) fetchMap(campaignId, scale, popField, mediaRef.current, metric);
  }, [campaignId, scale, popField, metric, fetchMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute percentiles + expressions
  const stats = useMemo(() => {
    if (!geojson) return { impPerc: null, popPerc: null, ratioPerc: null };
    const impValues = geojson.features.map(f => Number(f.properties?.impressions) || 0);
    const popValues = geojson.features.map(f => Number(f.properties?.pop_value) || 0);
    const ratioValues = geojson.features.map(f => Number(f.properties?.ratio) || 0).filter(v => v > 0);
    return {
      impPerc: computePercentiles(impValues),
      popPerc: computePercentiles(popValues),
      ratioPerc: computePercentiles(ratioValues),
    };
  }, [geojson]);

  const allPalettes = [...PALETTES, RATIO_PALETTE];
  const impPal = PALETTES.find(p => p.id === impPalette) ?? PALETTES[0];
  const popPal = allPalettes.find(p => p.id === popPalette) ?? PALETTES[1];
  const ratPal = allPalettes.find(p => p.id === ratioPalette) ?? RATIO_PALETTE;

  const impExpr = useMemo(() => stats.impPerc ? buildFillExpression('impressions', impPal.stops, stats.impPerc, impInverted) : ['literal', '#1a1a1a'], [stats.impPerc, impPal.stops, impInverted]);
  const popExpr = useMemo(() => stats.popPerc ? buildFillExpression('pop_value', popPal.stops, stats.popPerc, popInverted) : ['literal', '#1a1a1a'], [stats.popPerc, popPal.stops, popInverted]);
  const ratExpr = useMemo(() => stats.ratioPerc ? buildFillExpression('ratio', ratPal.stops, stats.ratioPerc, ratioInverted) : ['literal', '#1a1a1a'], [stats.ratioPerc, ratPal.stops, ratioInverted]);

  const metricLabel = metric === 'unique' ? 'Imp. uniques' : 'Impressions';

  return (
    <div style={{ display: 'flex', flex: 1, gap: 1, background: 'var(--border-subtle)', minHeight: 0, height: '100%', position: 'relative' }}>
      {/* Loading overlay — does NOT unmount maps */}
      {geojsonLoading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: theme === 'dark' ? 'rgba(5,5,5,0.7)' : 'rgba(255,255,255,0.7)',
          fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)',
        }}>
          Chargement des donnees...
        </div>
      )}
      {/* Ratio (focus — left, large) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <SingleMapPanel
          title="Ratio" titleAccent={`${metric === 'unique' ? 'imp. uniques' : 'imp.'} / ${POP_LABELS[popField] ?? popField}`}
          palettes={allPalettes} palette={ratioPalette} onPaletteChange={setRatioPalette} inverted={ratioInverted} onInvertedChange={setRatioInverted}
          mapId="ratio" geojson={geojson} fillExpression={ratExpr} lineColor="rgba(180,180,180,0.2)"
          onMove={handleMove('ratio')} syncTarget={syncSource !== 'ratio' ? syncState : null}
          percentiles={stats.ratioPerc}
          legendStops={ratioInverted ? [...ratPal.stops].reverse() : ratPal.stops}
          legendMin="sous-servi" legendMid="mediane" legendMax="sur-servi"
          showFeatureHover metricLabel={metricLabel}
        />
      </div>
      {/* Impressions + Population (right, stacked) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SingleMapPanel
            title={metricLabel}
            palettes={PALETTES} palette={impPalette} onPaletteChange={setImpPalette} inverted={impInverted} onInvertedChange={setImpInverted}
            mapId="imp" geojson={geojson} fillExpression={impExpr} lineColor="rgba(78,205,196,0.25)"
            onMove={handleMove('imp')} syncTarget={syncSource !== 'imp' ? syncState : null} zoomOffset={-0.7}
            percentiles={stats.impPerc}
            legendStops={impInverted ? [...impPal.stops].reverse() : impPal.stops}
            legendMin="0" legendMid={stats.impPerc?.p50.toLocaleString('fr-FR') ?? ''} legendMax={stats.impPerc?.max.toLocaleString('fr-FR') ?? ''}
            showFeatureHover metricLabel={metricLabel}
          />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SingleMapPanel
            title="Population" titleAccent={POP_LABELS[popField] ?? popField}
            palettes={allPalettes} palette={popPalette} onPaletteChange={setPopPalette} inverted={popInverted} onInvertedChange={setPopInverted}
            mapId="pop" geojson={geojson} fillExpression={popExpr} lineColor="rgba(66,146,198,0.25)"
            onMove={handleMove('pop')} syncTarget={syncSource !== 'pop' ? syncState : null} zoomOffset={-0.7}
            percentiles={stats.popPerc}
            legendStops={popInverted ? [...popPal.stops].reverse() : popPal.stops}
            legendMin="0" legendMid={stats.popPerc?.p50.toLocaleString('fr-FR') ?? ''} legendMax={stats.popPerc?.max.toLocaleString('fr-FR') ?? ''}
            showFeatureHover metricLabel={metricLabel}
          />
        </div>
      </div>
    </div>
  );
}
