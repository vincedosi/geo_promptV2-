'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { applyGeomatikStyle } from '@/lib/map/geomatik-style';
import { useTheme } from '@/lib/theme/ThemeProvider';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const FRANCE_CENTER: [number, number] = [2.5, 46.5];
const FRANCE_ZOOM = 5.2;
// Bounds France métropolitaine pour fitBounds (centre la France quel que soit
// le ratio d'aspect du conteneur — utile pour les sous-cartes du TripleMapView).
const FRANCE_BOUNDS: [[number, number], [number, number]] = [[-5.5, 41.3], [9.6, 51.1]];

interface SyncMapProps {
  id: string;
  geojson: GeoJSON.FeatureCollection | null;
  fillExpression: unknown[];
  lineColor?: string;
  /** Optional MapLibre expression overriding lineColor (e.g. ['case', ['get','is_target'], '#4ecdc4', '#333']). */
  lineColorExpr?: unknown[];
  /** Optional MapLibre expression overriding line width. */
  lineWidthExpr?: unknown[];
  onMove?: (center: [number, number], zoom: number, bearing: number, pitch: number) => void;
  syncTarget?: { center: [number, number]; zoom: number; bearing: number; pitch: number } | null;
  /** Extra zoom added when this map is in a small panel */
  zoomOffset?: number;
  /** Hide basemap admin boundaries (country/region/dept outlines from Positron style) */
  hideAdminBoundaries?: boolean;
  /** Show rich hover popup (nom + impressions + pop + ratio) — used in zones mode */
  showFeatureHover?: boolean;
  /** Metric label for the hover popup ("Impressions" or "Imp. uniques") */
  metricLabel?: string;
}

function fmtNum(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'G';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return v.toLocaleString('fr-FR');
}

export function SyncMap({ id, geojson, fillExpression, lineColor, lineColorExpr, lineWidthExpr, onMove, syncTarget, zoomOffset = 0, hideAdminBoundaries = false, showFeatureHover = false, metricLabel = 'Impressions' }: SyncMapProps) {
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isSyncing = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: FRANCE_CENTER,
      zoom: FRANCE_ZOOM,
      attributionControl: false,
    });

    // Centrage France via fitBounds — garantit que la métropole reste cadrée
    // quel que soit le ratio d'aspect du conteneur (cartes de TripleMapView
    // peuvent être étroites/hautes ou larges/basses).
    map.once('load', () => {
      try {
        map.fitBounds(FRANCE_BOUNDS, { padding: 24, animate: false });
      } catch { /* ok */ }
    });

    map.on('load', () => {
      applyGeomatikStyle(map, themeRef.current);

      map.addSource(`digital-${id}`, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: `digital-fill-${id}`,
        type: 'fill',
        source: `digital-${id}`,
        paint: { 'fill-color': '#1a1a1a', 'fill-opacity': 0.7 },
      });

      map.addLayer({
        id: `digital-line-${id}`,
        type: 'line',
        source: `digital-${id}`,
        paint: {
          'line-color': lineColor ?? '#333333',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 9, 0.5, 12, 1],
          'line-opacity': 0.4,
        },
      });

    });

    const handleMove = () => {
      if (isSyncing.current) return;
      const c = map.getCenter();
      // Emit base zoom (without offset) so other maps get the right level
      onMove?.([c.lng, c.lat], map.getZoom() - zoomOffset, map.getBearing(), map.getPitch());
    };
    map.on('move', handleMove);

    mapRef.current = map;

    // Resize observer — ensures tiles render when container goes from 0 to real size
    const ro = new ResizeObserver(() => { map.resize(); });
    if (containerRef.current) ro.observe(containerRef.current);
    map.once('idle', () => { map.resize(); });

    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-apply basemap style on theme toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const reapply = () => applyGeomatikStyle(map, theme);
    if (map.isStyleLoaded()) reapply();
    else map.once('load', reapply);
  }, [theme]);

  // Update GeoJSON data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geojson) return;
    const src = map.getSource(`digital-${id}`) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(geojson);
  }, [geojson, id]);

  // Update fill expression
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(`digital-fill-${id}`)) return;
    try {
      map.setPaintProperty(`digital-fill-${id}`, 'fill-color', fillExpression as maplibregl.ExpressionSpecification);
    } catch { /* layer not ready yet */ }
  }, [fillExpression, id]);

  // Update line color/width expressions (optional override of static lineColor)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lineId = `digital-line-${id}`;
    const apply = () => {
      if (!map.getLayer(lineId)) return;
      try {
        if (lineColorExpr) {
          map.setPaintProperty(lineId, 'line-color', lineColorExpr as maplibregl.ExpressionSpecification);
        } else if (lineColor) {
          map.setPaintProperty(lineId, 'line-color', lineColor);
        }
        if (lineWidthExpr) {
          map.setPaintProperty(lineId, 'line-width', lineWidthExpr as maplibregl.ExpressionSpecification);
          map.setPaintProperty(lineId, 'line-opacity', 1);
        }
      } catch { /* layer not ready yet */ }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [lineColorExpr, lineWidthExpr, lineColor, id]);

  // Sync from other maps
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !syncTarget) return;
    isSyncing.current = true;
    map.jumpTo({
      center: syncTarget.center,
      zoom: syncTarget.zoom + zoomOffset,
      bearing: syncTarget.bearing,
      pitch: syncTarget.pitch,
    });
    requestAnimationFrame(() => { isSyncing.current = false; });
  }, [syncTarget]);

  // Zones mode styling :
  //  1. Masquer UNIQUEMENT les boundaries admin sub-nationales (regions/depts)
  //     → garder country/coast pour que la France reste lisible
  //  2. Ajuster le layer digital-fill/line (opacité + stroke blanc)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const style = map.getStyle();
      if (!style?.layers) return;

      for (const layer of style.layers) {
        const lid = layer.id.toLowerCase();
        if (lid.startsWith('digital-')) continue;

        const isAdminLayer = lid.includes('boundary') || lid.includes('admin') || lid.includes('border');
        if (!isAdminLayer) continue;

        // Garder les layers country / coast / nation / 0
        const isCountryLayer =
          lid.includes('country') ||
          lid.includes('nation') ||
          lid.includes('coast') ||
          /(^|[_\-])0([_\-]|$)/.test(lid); // admin_0, boundary_0, etc.

        // Inspecter le filter du layer pour détecter admin_level ciblé
        let adminLevel: number | null = null;
        const f = (layer as { filter?: unknown }).filter;
        const scanFilter = (node: unknown): void => {
          if (adminLevel !== null) return;
          if (!Array.isArray(node)) return;
          // ['==', 'admin_level', N] ou ['==', ['get','admin_level'], N]
          if (node[0] === '==' || node[0] === '<=' || node[0] === '>=') {
            const key = node[1];
            const val = node[2];
            const keyIsAdminLevel =
              key === 'admin_level' ||
              (Array.isArray(key) && key[0] === 'get' && key[1] === 'admin_level');
            if (keyIsAdminLevel && typeof val === 'number') {
              adminLevel = val;
              return;
            }
          }
          for (const child of node) scanFilter(child);
        };
        scanFilter(f);

        // Décision : country (admin_level ≤ 2) OR nom country → KEEP
        //            sinon → HIDE en mode zones
        const isCountry = isCountryLayer || (adminLevel !== null && adminLevel <= 2);
        const shouldHide = hideAdminBoundaries && !isCountry;

        try {
          map.setLayoutProperty(layer.id, 'visibility', shouldHide ? 'none' : 'visible');
        } catch { /* noop */ }
      }

      // Ajuster le style des layers digital en mode zones
      const fillId = `digital-fill-${id}`;
      const lineId = `digital-line-${id}`;
      if (map.getLayer(fillId)) {
        try {
          map.setPaintProperty(fillId, 'fill-opacity', hideAdminBoundaries ? 0.65 : 0.7);
        } catch { /* noop */ }
      }
      if (map.getLayer(lineId)) {
        try {
          // Si une expression line-color/line-width est fournie, on ne l'écrase
          // pas — c'est l'effet dédié qui pilote ces propriétés (cas outline
          // cible sur cartes Pilotage ML).
          if (!lineColorExpr) {
            if (hideAdminBoundaries) {
              map.setPaintProperty(lineId, 'line-color', 'rgba(255,255,255,0.3)');
            } else {
              map.setPaintProperty(lineId, 'line-color', lineColor ?? '#333333');
            }
          }
          if (!lineWidthExpr) {
            if (hideAdminBoundaries) {
              map.setPaintProperty(lineId, 'line-width', 1.5);
              map.setPaintProperty(lineId, 'line-opacity', 1);
            } else {
              map.setPaintProperty(lineId, 'line-width', ['interpolate', ['linear'], ['zoom'], 5, 0.2, 9, 0.5, 12, 1] as maplibregl.ExpressionSpecification);
              map.setPaintProperty(lineId, 'line-opacity', 0.4);
            }
          }
        } catch { /* noop */ }
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [hideAdminBoundaries, id, lineColor, lineColorExpr, lineWidthExpr]);

  // Hover popup: nom + metric + pop + ratio
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layerId = `digital-fill-${id}`;

    const handleMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!showFeatureHover) return;
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = 'pointer';
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const nom = String(p.nom ?? p.code ?? '—');
      const label = p.label && String(p.label) !== nom ? ` <span style="color:var(--text-tertiary)">· ${String(p.label)}</span>` : '';

      // Construction conditionnelle des lignes du popup. En mode meteo, les
      // features sont enrichies avec meteo_value/unit/label (en plus des KPIs
      // DSP si presents). L'ordre : KPI DSP d'abord, separator, puis meteo.
      const lines: string[] = [];
      const hasImpressions = p.impressions !== undefined && p.impressions !== null;
      const hasPop = p.pop_value !== undefined && p.pop_value !== null;
      const hasRatio = p.ratio !== undefined && p.ratio !== null;
      const hasMeteo = p.meteo_value !== undefined && p.meteo_value !== null;

      if (hasImpressions) {
        lines.push(`<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--text-tertiary)">${metricLabel}</span><span style="font-family:'JetBrains Mono',monospace;color:var(--brand-teal)">${fmtNum(p.impressions)}</span></div>`);
      }
      if (hasPop) {
        lines.push(`<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--text-tertiary)">Population</span><span style="font-family:'JetBrains Mono',monospace">${fmtNum(p.pop_value)}</span></div>`);
      }
      if (hasRatio) {
        lines.push(`<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--text-tertiary)">Ratio</span><span style="font-family:'JetBrains Mono',monospace">${Number(p.ratio).toFixed(1)}</span></div>`);
      }
      if (hasMeteo) {
        const mv = Number(p.meteo_value);
        const mu = p.meteo_unit ? String(p.meteo_unit) : '';
        const ml = p.meteo_label ? `<div style="color:var(--text-tertiary);font-size:10px;margin-top:2px">${String(p.meteo_label)}</div>` : '';
        const sep = lines.length > 0
          ? '<div style="margin-top:6px;padding-top:6px;border-top:0.5px solid var(--border-subtle)"></div>'
          : '';
        lines.push(`${sep}<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--text-tertiary)">${metricLabel}</span><span style="font-family:'JetBrains Mono',monospace;color:var(--brand-teal)">${mv.toFixed(1)} ${mu}</span></div>${ml}`);
      }

      const html = `
        <div style="font-family:'Inter',sans-serif;color:var(--text-primary);font-size:11px;line-height:1.5;min-width:160px">
          <div style="font-weight:500;font-size:12px;margin-bottom:4px">${nom}${label}</div>
          ${lines.join('')}
        </div>`;
      if (!popupRef.current) {
        popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'digital-hover-popup' });
      }
      popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
    };
    const handleLeave = () => {
      map.getCanvas().style.cursor = '';
      popupRef.current?.remove();
    };

    const attach = () => {
      if (!map.getLayer(layerId)) return;
      map.on('mousemove', layerId, handleMove);
      map.on('mouseleave', layerId, handleLeave);
    };
    if (map.isStyleLoaded()) attach();
    else map.once('load', attach);

    return () => {
      map.off('mousemove', layerId, handleMove);
      map.off('mouseleave', layerId, handleLeave);
      popupRef.current?.remove();
    };
  }, [id, showFeatureHover, metricLabel]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
