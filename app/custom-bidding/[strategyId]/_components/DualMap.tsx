'use client';

/**
 * DualMap — visualisation du déplacement d'impressions par MAGELIAN.
 *
 * Modes (pilotés par MapCustomizationPanel) :
 *   • single        : une carte plein largeur + toggle [Sans algo] / [Avec algo]
 *                     transition fade 800ms entre les 2 jeux de bulles.
 *   • side_by_side  : deux cartes synchronisées (avant / après) côte à côte.
 *
 * Couches (toujours présentes) :
 *   • Choroplèthe d'une variable INSEE (palette personnalisable + inversion + opacité)
 *   • Bulles aux centroïdes (CP, Département ou Région — granularité personnalisable)
 *   • Extrusion 3D du fond (toggle dans header)
 *
 * Theme-aware : toutes les couleurs de chrome via var() tokens
 * (--bg-level-X, --text-X, --border-X). Les couleurs de palette et de bulles
 * sont des données utilisateur — gardées en hex.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { applyMagelianStyle } from '@/lib/map/magelian-style';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { Box, Layers } from 'lucide-react';
import {
  buildZoneDeltas, aggregateByDept, aggregateByRegion,
  type ZoneDelta, type DeptAgg, type RegionAgg,
} from '@/lib/bidding-ml/flow-helpers';
import {
  metricFields, getMetricLabels, type PrimaryMetric,
} from '@/lib/bidding-ml/metric-labels';
import { useMapCustomization, PALETTES, type Granularity } from '@/lib/bidding-ml/use-map-customization';
import { MapCustomizationPanel } from './MapCustomizationPanel';
import { buildCircleRadiusExpression } from '../_lib/circle-radius';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const FRANCE_BOUNDS: [[number, number], [number, number]] = [[-5.5, 41.3], [9.6, 51.1]];

interface Props {
  geojson: GeoJSON.FeatureCollection | null;
  insseValues: Record<string, number> | null;
  metric: PrimaryMetric;
  targetLabel: string;
  variableLabel: string | null;
  currentDate?: string;
}

interface ViewState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

interface CirclePoint {
  id: string;
  centroid: [number, number];
  real: number;
  sim: number;
  abstention_rate: number;
  label: string;     // ex "93" ou "75001" ou "IDF"
  n_children?: number;
}

export function DualMap({ geojson, insseValues, metric, targetLabel, variableLabel, currentDate }: Props) {
  const labels = getMetricLabels(metric);
  const fields = metricFields(metric);
  const deltaField = `${metric}_delta`;
  const { config, update, reset, effectiveStops } = useMapCustomization();

  // Pour le mode single, état du toggle
  const [phase, setPhase] = useState<'before' | 'after'>('before');
  const [view, setView] = useState<ViewState | null>(null);

  // Pipeline : zones CP → dept → region selon granularité
  const zones: ZoneDelta[] = useMemo(
    () => buildZoneDeltas(geojson, insseValues, deltaField, fields.real, fields.sim),
    [geojson, insseValues, deltaField, fields.real, fields.sim],
  );
  const depts: DeptAgg[] = useMemo(() => aggregateByDept(zones), [zones]);
  const regions: RegionAgg[] = useMemo(() => aggregateByRegion(depts), [depts]);

  const points: CirclePoint[] = useMemo(() => {
    if (config.granularity === 'cp') {
      return zones
        .filter(z => z.real > 0 || z.sim > 0)
        .map(z => ({
          id: z.postal_code,
          centroid: z.centroid,
          real: z.real, sim: z.sim,
          abstention_rate: z.abstention_rate ?? 0,
          label: z.postal_code,
        }));
    }
    if (config.granularity === 'region') {
      return regions.map(r => ({
        id: r.region,
        centroid: r.centroid,
        real: r.real, sim: r.sim,
        abstention_rate: r.abstention_rate,
        label: r.region,
        n_children: r.n_dept,
      }));
    }
    return depts.map(d => ({
      id: d.dept,
      centroid: d.centroid,
      real: d.real, sim: d.sim,
      abstention_rate: d.abstention_rate,
      label: d.dept,
      n_children: d.n_cp,
    }));
  }, [zones, depts, regions, config.granularity]);

  const heatGeoJSON: GeoJSON.FeatureCollection | null = useMemo(() => {
    if (!geojson || !insseValues) return null;
    return {
      type: 'FeatureCollection',
      features: geojson.features.map(f => ({
        ...f,
        properties: {
          ...(f.properties ?? {}),
          abstention_rate: insseValues[String(f.properties?.code_postal ?? '')] ?? null,
        },
      })),
    };
  }, [geojson, insseValues]);

  const maxImpressions = useMemo(() => {
    let m = 1;
    for (const p of points) {
      if (p.real > m) m = p.real;
      if (p.sim > m) m = p.sim;
    }
    return m;
  }, [points]);

  const onMove = (next: ViewState) => setView(next);

  return (
    <div
      style={{
        margin: '12px',
        borderRadius: 10,
        overflow: 'visible',
        border: '0.5px solid var(--border-subtle)',
        background: 'var(--bg-level-1)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '0.5px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', gap: 10,
          flexWrap: 'wrap',
          position: 'relative',
          zIndex: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
          <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
            Diffusion {labels.name.toLowerCase()} sur fond {variableLabel ?? "taux d'abstention"}
          </span>
        </div>

        {/* Toggle Sans/Avec algo (mode single uniquement) */}
        {config.viewMode === 'single' && (
          <div
            style={{
              display: 'inline-flex', padding: 2, gap: 2,
              background: 'var(--bg-level-2)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 6,
            }}
          >
            <PhaseBtn active={phase === 'before'} onClick={() => setPhase('before')}>
              Sans algo
            </PhaseBtn>
            <PhaseBtn active={phase === 'after'} onClick={() => setPhase('after')}>
              Avec algo
            </PhaseBtn>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {currentDate && (
            <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>{currentDate}</span>
          )}
          <button
            type="button"
            onClick={() => update('is3D', !config.is3D)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
              background: config.is3D ? 'var(--brand-teal)' : 'var(--bg-level-2)',
              color: config.is3D ? 'var(--bg-level-0)' : 'var(--text-secondary)',
              border: `0.5px solid ${config.is3D ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
              borderRadius: 6, cursor: 'pointer',
            }}
            title={config.is3D ? 'Repasser en vue plate' : 'Activer la vue 3D'}
          >
            {config.is3D ? <Box size={12} strokeWidth={1.8} /> : <Layers size={12} strokeWidth={1.8} />}
            {config.is3D ? 'Vue 3D' : 'Vue plate'}
          </button>
          <MapCustomizationPanel config={config} update={update} reset={reset} />
        </div>
      </div>

      {/* Body : single ou side-by-side */}
      {config.viewMode === 'single' ? (
        <div style={{ padding: 8, background: 'var(--bg-level-0)' }}>
          <MapPanel
            id="dual-single"
            phaseValue={phase}
            heatGeoJSON={heatGeoJSON}
            points={points}
            maxImpressions={maxImpressions}
            paletteStops={effectiveStops}
            bgOpacity={config.bgOpacity}
            colorBefore={config.bubbleColorBefore}
            colorAfter={config.bubbleColorAfter}
            bubbleOpacity={config.bubbleOpacity}
            bubbleStroke={config.bubbleStroke}
            is3D={config.is3D}
            onMove={onMove}
            syncTarget={null}
            metricName={labels.name}
            granularity={config.granularity}
            height={520}
          />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 8, background: 'var(--bg-level-0)' }}>
          <SidePanel
            side="before"
            title="Avant MAGELIAN"
            subtitle={`${labels.name.toLowerCase()} réelles · diffusion non ciblée`}
            heatGeoJSON={heatGeoJSON}
            points={points}
            maxImpressions={maxImpressions}
            paletteStops={effectiveStops}
            bgOpacity={config.bgOpacity}
            color={config.bubbleColorBefore}
            bubbleOpacity={config.bubbleOpacity}
            bubbleStroke={config.bubbleStroke}
            is3D={config.is3D}
            onMove={onMove}
            syncTarget={view}
            metricName={labels.name}
            granularity={config.granularity}
          />
          <SidePanel
            side="after"
            title="Avec MAGELIAN"
            subtitle={`${labels.name.toLowerCase()} simulées · concentré sur ${targetLabel}`}
            heatGeoJSON={heatGeoJSON}
            points={points}
            maxImpressions={maxImpressions}
            paletteStops={effectiveStops}
            bgOpacity={config.bgOpacity}
            color={config.bubbleColorAfter}
            bubbleOpacity={config.bubbleOpacity}
            bubbleStroke={config.bubbleStroke}
            is3D={config.is3D}
            onMove={onMove}
            syncTarget={view}
            metricName={labels.name}
            granularity={config.granularity}
          />
        </div>
      )}

      {/* Légende globale */}
      <Legend
        variableLabel={variableLabel}
        metricName={labels.name}
        paletteStops={effectiveStops}
        colorBefore={config.bubbleColorBefore}
        colorAfter={config.bubbleColorAfter}
        bubbleOpacity={config.bubbleOpacity}
        bubbleStroke={config.bubbleStroke}
        granularity={config.granularity}
      />
    </div>
  );
}

// =============================================================================
// PHASE TOGGLE BUTTON
// =============================================================================

function PhaseBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
        background: active ? 'var(--text-primary)' : 'transparent',
        color: active ? 'var(--bg-level-0)' : 'var(--text-secondary)',
        border: 'none', borderRadius: 4, cursor: 'pointer',
        transition: 'all 200ms',
      }}
    >
      {children}
    </button>
  );
}

// =============================================================================
// MAP PANEL — mode SINGLE avec toggle phase animé
// =============================================================================

interface MapPanelProps {
  id: string;
  phaseValue: 'before' | 'after';
  heatGeoJSON: GeoJSON.FeatureCollection | null;
  points: CirclePoint[];
  maxImpressions: number;
  paletteStops: string[];
  bgOpacity: number;
  colorBefore: string;
  colorAfter: string;
  bubbleOpacity: number;
  bubbleStroke: number;
  is3D: boolean;
  onMove: (v: ViewState) => void;
  syncTarget: ViewState | null;
  metricName: string;
  granularity: Granularity;
  height: number;
}

function MapPanel({
  id, phaseValue, heatGeoJSON, points, maxImpressions, paletteStops, bgOpacity,
  colorBefore, colorAfter, bubbleOpacity, bubbleStroke, is3D,
  onMove, syncTarget, metricName, granularity, height,
}: MapPanelProps) {
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isSyncingRef = useRef(false);
  const styleReadyRef = useRef(false);
  const [styleReady, setStyleReady] = useState(false);

  const heatLayerId = `dual-heat-${id}`;
  const heatExtrLayerId = `dual-heat-extr-${id}`;
  const heatLineLayerId = `dual-heat-line-${id}`;
  const circleLayerId = `dual-circle-${id}`;
  const sourceId = `dual-${id}`;
  const circleSourceId = `dual-circle-src-${id}`;

  const circleGeoJSON: GeoJSON.FeatureCollection = useMemo(() => ({
    type: 'FeatureCollection',
    features: points.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p.centroid },
      properties: {
        id: p.id, label: p.label,
        impressions: phaseValue === 'before' ? p.real : p.sim,
        real: p.real, sim: p.sim,
        abstention: p.abstention_rate,
        n_children: p.n_children ?? 0,
      },
    })),
  }), [points, phaseValue]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [2.5, 46.5], zoom: 5,
      attributionControl: false,
    });
    mapRef.current = map;
    map.once('load', () => {
      try { map.fitBounds(FRANCE_BOUNDS, { padding: 18, animate: false }); } catch { /* ok */ }
      applyMagelianStyle(map, themeRef.current);

      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(circleSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({
        id: heatLayerId, type: 'fill', source: sourceId,
        paint: { 'fill-color': '#1a1a1a', 'fill-opacity': bgOpacity },
      });
      map.addLayer({
        id: heatExtrLayerId, type: 'fill-extrusion', source: sourceId,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#1a1a1a',
          'fill-extrusion-height': [
            'interpolate', ['linear'], ['to-number', ['get', 'abstention_rate'], 0],
            10, 1000, 60, 70000,
          ],
          'fill-extrusion-opacity': 0.85,
          'fill-extrusion-base': 0,
        },
      });
      map.addLayer({
        id: heatLineLayerId, type: 'line', source: sourceId,
        paint: { 'line-color': 'rgba(255,255,255,0.3)', 'line-width': 0.25 },
      });
      map.addLayer({
        id: circleLayerId, type: 'circle', source: circleSourceId,
        paint: {
          'circle-color': colorBefore,
          'circle-opacity': bubbleOpacity,
          'circle-stroke-color': '#000',
          'circle-stroke-width': bubbleStroke,
          'circle-stroke-opacity': 0.85,
          'circle-radius': 0,
          'circle-pitch-alignment': 'map',
          'circle-radius-transition': { duration: 600, delay: 0 },
          'circle-color-transition': { duration: 800, delay: 0 },
        },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      map.on('mouseenter', circleLayerId, (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const f = e.features?.[0];
        if (!f || f.geometry.type !== 'Point') return;
        const p = f.properties as Record<string, unknown>;
        const real = Math.round(Number(p.real ?? 0)).toLocaleString('fr-FR');
        const sim = Math.round(Number(p.sim ?? 0)).toLocaleString('fr-FR');
        const abst = Number(p.abstention ?? 0).toFixed(1);
        const html = `
          <div style="font-family:${fInter};font-size:11px;color:var(--text-primary);background:var(--bg-level-1);border:0.5px solid var(--border-default);border-radius:6px;padding:8px 10px;min-width:180px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
              <span style="font-weight:500">${granularity === 'cp' ? 'CP' : granularity === 'dept' ? 'Dept' : 'Région'} ${String(p.label ?? '')}</span>
              <span style="margin-left:auto;color:var(--text-tertiary);font-size:10px">${abst}% abst.</span>
            </div>
            <div style="display:flex;justify-content:space-between;gap:12px;font-family:${fMono};font-size:11px">
              <span style="color:var(--text-tertiary)">${metricName} sans algo</span>
              <span style="color:var(--text-primary)">${real}</span>
            </div>
            <div style="display:flex;justify-content:space-between;gap:12px;font-family:${fMono};font-size:11px;margin-top:2px">
              <span style="color:var(--text-tertiary)">${metricName} avec algo</span>
              <span style="color:var(--brand-teal);font-weight:600">${sim}</span>
            </div>
          </div>
        `;
        popup.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setHTML(html).addTo(map);
      });
      map.on('mouseleave', circleLayerId, () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });

      styleReadyRef.current = true;
      setStyleReady(true);
    });

    const handleMove = () => {
      if (isSyncingRef.current) return;
      const c = map.getCenter();
      onMove({
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
    };
    map.on('move', handleMove);

    const ro = new ResizeObserver(() => map.resize());
    if (containerRef.current) ro.observe(containerRef.current);
    map.once('idle', () => map.resize());

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sources
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !heatGeoJSON) return;
    const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(heatGeoJSON);
  }, [heatGeoJSON, styleReady, sourceId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const src = map.getSource(circleSourceId) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(circleGeoJSON);
  }, [circleGeoJSON, styleReady, circleSourceId]);

  // Palette + opacité du fond
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const colorExpr = buildHeatColorExpression(paletteStops);
    try {
      map.setPaintProperty(heatLayerId, 'fill-color', colorExpr as maplibregl.ExpressionSpecification);
      map.setPaintProperty(heatLayerId, 'fill-opacity', bgOpacity);
      map.setPaintProperty(heatExtrLayerId, 'fill-extrusion-color', colorExpr as maplibregl.ExpressionSpecification);
    } catch { /* ok */ }
  }, [paletteStops, bgOpacity, styleReady, heatLayerId, heatExtrLayerId]);

  // Couleur des bulles : transition douce gérée par circle-color-transition au layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    try {
      const color = phaseValue === 'before' ? colorBefore : colorAfter;
      map.setPaintProperty(circleLayerId, 'circle-color', color);
      map.setPaintProperty(circleLayerId, 'circle-opacity', bubbleOpacity);
      map.setPaintProperty(circleLayerId, 'circle-stroke-width', bubbleStroke);
      map.setPaintProperty(circleLayerId, 'circle-stroke-color', strokeColor(color));
    } catch { /* ok */ }
  }, [phaseValue, colorBefore, colorAfter, bubbleOpacity, bubbleStroke, styleReady, circleLayerId]);

  // Rayon des bulles : adapté à la granularité (max plus petit en CP car beaucoup de points)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const maxRadius = granularity === 'cp' ? 18 : granularity === 'region' ? 42 : 32;
    try {
      map.setPaintProperty(
        circleLayerId,
        'circle-radius',
        buildCircleRadiusExpression(maxImpressions, maxRadius) as maplibregl.ExpressionSpecification,
      );
    } catch { /* ok */ }
  }, [maxImpressions, granularity, styleReady, circleLayerId]);

  // 3D toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    try {
      map.setLayoutProperty(heatLayerId, 'visibility', is3D ? 'none' : 'visible');
      map.setLayoutProperty(heatExtrLayerId, 'visibility', is3D ? 'visible' : 'none');
      map.easeTo({ pitch: is3D ? 50 : 0, bearing: is3D ? -15 : 0, duration: 800 });
    } catch { /* ok */ }
  }, [is3D, styleReady, heatLayerId, heatExtrLayerId]);

  // Sync (mode side-by-side)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !syncTarget) return;
    isSyncingRef.current = true;
    map.jumpTo({
      center: syncTarget.center,
      zoom: syncTarget.zoom,
      bearing: syncTarget.bearing,
      pitch: syncTarget.pitch,
    });
    requestAnimationFrame(() => { isSyncingRef.current = false; });
  }, [syncTarget]);

  return <div ref={containerRef} style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }} />;
}

// =============================================================================
// SIDE PANEL (mode side-by-side) — wrapper avec header par carte
// =============================================================================

interface SidePanelProps extends Omit<MapPanelProps, 'id' | 'phaseValue' | 'colorBefore' | 'colorAfter' | 'height'> {
  side: 'before' | 'after';
  title: string;
  subtitle: string;
  color: string;
}

function SidePanel({ side, title, subtitle, color, ...rest }: SidePanelProps) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-level-1)',
        border: '0.5px solid var(--border-subtle)',
        borderRadius: 8, overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '0.5px solid var(--border-subtle)',
          background: 'var(--bg-level-2)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          <div style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtitle}
          </div>
        </div>
      </div>
      <MapPanel
        {...rest}
        id={`dual-${side}`}
        phaseValue={side}
        colorBefore={color}
        colorAfter={color}
        height={460}
      />
    </div>
  );
}

// =============================================================================
// LEGEND
// =============================================================================

function Legend({
  variableLabel, metricName, paletteStops,
  colorBefore, colorAfter, bubbleOpacity, bubbleStroke, granularity,
}: {
  variableLabel: string | null;
  metricName: string;
  paletteStops: string[];
  colorBefore: string;
  colorAfter: string;
  bubbleOpacity: number;
  bubbleStroke: number;
  granularity: Granularity;
}) {
  const heatGradient = `linear-gradient(to right, ${paletteStops.join(', ')})`;
  const granLabel = granularity === 'cp' ? 'code postal' : granularity === 'dept' ? 'département' : 'région';
  return (
    <div
      style={{
        padding: '10px 14px',
        borderTop: '0.5px solid var(--border-subtle)',
        background: 'var(--bg-level-2)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 16,
        alignItems: 'center',
      }}
    >
      <div>
        <div style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)', marginBottom: 6 }}>
          Fond — {variableLabel ?? "taux d'abstention"}
        </div>
        <div style={{ height: 8, borderRadius: 4, background: heatGradient, marginBottom: 4, border: '0.5px solid var(--border-subtle)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
          <span>faible</span>
          <span>fort</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 28, height: 28, borderRadius: '50%',
          background: colorBefore,
          opacity: bubbleOpacity,
          border: `${bubbleStroke}px solid ${strokeColor(colorBefore)}`,
          flexShrink: 0,
        }} />
        <div>
          <div style={{ fontSize: 11, fontFamily: fInter, color: 'var(--text-primary)', fontWeight: 500 }}>
            Sans algo
          </div>
          <div style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)' }}>
            {metricName.toLowerCase()} réelles · par {granLabel}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 28, height: 28, borderRadius: '50%',
          background: colorAfter,
          opacity: bubbleOpacity,
          border: `${bubbleStroke}px solid ${strokeColor(colorAfter)}`,
          flexShrink: 0,
        }} />
        <div>
          <div style={{ fontSize: 11, fontFamily: fInter, color: 'var(--text-primary)', fontWeight: 500 }}>
            Avec MAGELIAN
          </div>
          <div style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)' }}>
            {metricName.toLowerCase()} simulées · par {granLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

/** Construit une expression MapLibre fill-color à partir de N stops palette. */
function buildHeatColorExpression(stops: string[]): unknown[] {
  const N = stops.length;
  if (N === 0) return ['rgba', 180, 180, 180, 0.25];
  // Distribution linéaire 15% → 60% (plage typique d'abstention)
  const min = 15, max = 60;
  const step = (max - min) / Math.max(1, N - 1);
  const pairs: (number | string)[] = [];
  for (let i = 0; i < N; i++) {
    pairs.push(min + i * step, stops[i]);
  }
  return [
    'case',
    ['==', ['get', 'abstention_rate'], null], 'rgba(180,180,180,0.18)',
    ['interpolate', ['linear'], ['to-number', ['get', 'abstention_rate'], 0], ...pairs],
  ];
}

/** Couleur de stroke = version assombrie de la couleur principale.
 *  Pour rester theme-neutre on assombrit la couleur en hex au lieu d'utiliser
 *  une var() (qui ne marcherait pas dans MapLibre). */
function strokeColor(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#000000';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.round(r * 0.55), dg = Math.round(g * 0.55), db = Math.round(b * 0.55);
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

// référence pour TS unused warning silencieux
void PALETTES;
