'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { applyGeomatikStyle } from '@/lib/map/geomatik-style';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const FRANCE_CENTER: [number, number] = [2.3, 46.6];
const FRANCE_ZOOM = 5.5;

interface SyncMapProps {
  id: string;
  geojson: GeoJSON.FeatureCollection | null;
  fillExpression: unknown[];
  lineColor?: string;
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

export function SyncMap({ id, geojson, fillExpression, lineColor, onMove, syncTarget, zoomOffset = 0, hideAdminBoundaries = false, showFeatureHover = false, metricLabel = 'Impressions' }: SyncMapProps) {
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

    map.on('load', () => {
      applyGeomatikStyle(map);

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
    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          if (hideAdminBoundaries) {
            map.setPaintProperty(lineId, 'line-color', 'rgba(255,255,255,0.3)');
            map.setPaintProperty(lineId, 'line-width', 1.5);
            map.setPaintProperty(lineId, 'line-opacity', 1);
          } else {
            map.setPaintProperty(lineId, 'line-color', lineColor ?? '#333333');
            map.setPaintProperty(lineId, 'line-width', ['interpolate', ['linear'], ['zoom'], 5, 0.2, 9, 0.5, 12, 1] as maplibregl.ExpressionSpecification);
            map.setPaintProperty(lineId, 'line-opacity', 0.4);
          }
        } catch { /* noop */ }
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [hideAdminBoundaries, id, lineColor]);

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
      const label = p.label && String(p.label) !== nom ? ` <span style="color:#666">· ${String(p.label)}</span>` : '';

      // Construction conditionnelle des lignes du popup. La 3eme carte en mode
      // meteo n'a pas impressions/pop/ratio — uniquement weather_value.
      const lines: string[] = [];
      const hasImpressions = p.impressions !== undefined && p.impressions !== null;
      const hasPop = p.pop_value !== undefined && p.pop_value !== null;
      const hasRatio = p.ratio !== undefined && p.ratio !== null;
      const hasWeather = p.weather_value !== undefined && p.weather_value !== null;

      if (hasImpressions) {
        lines.push(`<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#8a8a8a">${metricLabel}</span><span style="font-family:'JetBrains Mono',monospace;color:#4ecdc4">${fmtNum(p.impressions)}</span></div>`);
      }
      if (hasPop) {
        lines.push(`<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#8a8a8a">Population</span><span style="font-family:'JetBrains Mono',monospace">${fmtNum(p.pop_value)}</span></div>`);
      }
      if (hasRatio) {
        lines.push(`<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#8a8a8a">Ratio</span><span style="font-family:'JetBrains Mono',monospace">${Number(p.ratio).toFixed(1)}</span></div>`);
      }
      if (hasWeather) {
        const wv = Number(p.weather_value);
        const wu = p.weather_unit ? String(p.weather_unit) : '';
        const wl = p.weather_label ? ` <span style="color:#666">(${String(p.weather_label)})</span>` : '';
        const sep = lines.length > 0
          ? '<div style="margin-top:6px;padding-top:6px;border-top:0.5px solid #1a1a1a"></div>'
          : '';
        lines.push(`${sep}<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#8a8a8a">${metricLabel}</span><span style="font-family:'JetBrains Mono',monospace;color:#4ecdc4">${wv.toFixed(1)} ${wu}${wl}</span></div>`);
      }

      const html = `
        <div style="font-family:'Inter',sans-serif;color:#f0f0f0;font-size:11px;line-height:1.5;min-width:160px">
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
