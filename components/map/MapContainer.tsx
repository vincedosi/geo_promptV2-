'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { INITIAL_VIEWPORT } from '@/lib/map/config';

interface POI {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  categorie: string;
  sous_categorie?: string;
  adresse?: string;
  ville?: string;
  region?: string;
  departement?: string;
  code_postal?: string;
  [key: string]: any;
}

const BATTLE_PALETTE = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e','#e91e63','#00bcd4','#8bc34a','#ff5722','#607d8b','#795548','#9c27b0','#03a9f4','#4caf50','#ff9800','#2196f3','#c0392b'];
const BATTLE_PALIER_OPACITY: Record<number, number> = { 10: 0.65, 30: 0.50, 60: 0.38, 90: 0.28, 120: 0.18, 150: 0.11, 180: 0.08 };

interface MapContainerProps {
  pois: POI[];
  carreauxGeoJSON?: GeoJSON.FeatureCollection | null;
  carreauxMetric?: string;
  carreauxVisible?: boolean;
  onCoordsInfo?: (valid: number, total: number) => void;
  flyToTrigger?: number;
  onBoundsChange?: (bbox: [number, number, number, number]) => void;
  battleRings?:   GeoJSON.FeatureCollection | null;
  battleBorders?: GeoJSON.FeatureCollection | null;
  onBattleCirfas?: (cirfas: { id: string; nom: string; color: string }[]) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  lycee: '#6366f1',
  college: '#3b82f6',
  cirfa: '#ef4444',
  gare: '#10b981',
  sport: '#f59e0b',
  default: '#8b5cf6',
};

function getCategoryColor(cat: string): string {
  return CATEGORY_COLORS[cat?.toLowerCase()] || CATEGORY_COLORS.default;
}

function formatMetricLabel(field: string): string {
  return field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function isValidPOI(p: POI): boolean {
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  return p.lat != null && p.lng != null && !isNaN(lat) && !isNaN(lng);
}

function buildPopupHTML(p: POI, color: string): string {
  const nom = (p.nom || 'POI').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = [
    `<div style="padding:8px;font-family:sans-serif;font-size:13px;line-height:1.5">`,
    `<b>${nom}</b><br/>`,
    `<span style="color:${color};font-size:11px;text-transform:uppercase;font-weight:600">${p.categorie || ''}</span>`,
    p.sous_categorie ? ` <span style="color:#94a3b8;font-size:11px">${'\u00b7'} ${p.sous_categorie}</span>` : '',
    p.adresse ? `<p style="margin:4px 0 0;color:#475569">${'\ud83d\udccd'} ${p.adresse}</p>` : '',
    p.ville ? `<p style="margin:4px 0 0;color:#475569">${'\ud83c\udfe3\ufe0f'} ${p.ville}${p.code_postal ? ` (${p.code_postal})` : ''}</p>` : '',
    p.departement ? `<p style="margin:4px 0 0;color:#64748b;font-size:12px">${p.departement}${p.region ? ` ${'\u00b7'} ${p.region}` : ''}</p>` : '',
    `</div>`,
  ];
  return parts.join('');
}

const RASTER_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org/copyright">OSM</a>',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'carto-bg', type: 'raster' as const, source: 'carto' }],
};
// ─── Module-level helpers ────────────────────────────────────────────────────

function renderMarkers(
  map: MapLibreMap,
  poiList: POI[],
  markersRef: React.MutableRefObject<maplibregl.Marker[]>
) {
  markersRef.current.forEach(m => m.remove());
  markersRef.current = [];
  const valid = poiList.filter(isValidPOI);
  valid.forEach(p => {
    const color = getCategoryColor(p.categorie);
    const el = document.createElement('div');
    el.style.width = '10px';
    el.style.height = '10px';
    el.style.borderRadius = '50%';
    el.style.background = color;
    el.style.border = '2px solid rgba(255,255,255,0.9)';
    el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';
    el.style.cursor = 'pointer';
    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px', offset: 12 })
      .setHTML(buildPopupHTML(p, color));
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([Number(p.lng), Number(p.lat)])
      .setPopup(popup)
      .addTo(map);
    markersRef.current.push(marker);
  });
}

const CHORO_COLORS = ['#c6dbef', '#9ecae1', '#4292c6', '#2171b5', '#08306b'];

function buildFillColor(metric: string, min: number, max: number): maplibregl.ExpressionSpecification {
  if (min >= max) return CHORO_COLORS[2] as unknown as maplibregl.ExpressionSpecification;
  const step = (max - min) / (CHORO_COLORS.length - 1);
  const stops: (number | string)[] = [];
  CHORO_COLORS.forEach((color, i) => { stops.push(min + i * step, color); });
  return [
    'interpolate', ['linear'],
    ['coalesce', ['to-number', ['get', metric], 0], 0],
    ...stops,
  ] as unknown as maplibregl.ExpressionSpecification;
}

function computeMinMax(geojson: GeoJSON.FeatureCollection, metric: string): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const f of geojson.features) {
    const v = Number((f.properties as Record<string, unknown>)?.[metric]);
    if (!isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
  }
  return min === Infinity ? [0, 1] : [min, max];
}

function computeCarreauxBounds(geojson: GeoJSON.FeatureCollection): maplibregl.LngLatBoundsLike | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of geojson.features) {
    const geom = f.geometry;
    if (!geom) continue;
    const rings = geom.type === 'Polygon'
      ? (geom as GeoJSON.Polygon).coordinates
      : geom.type === 'MultiPolygon'
        ? (geom as GeoJSON.MultiPolygon).coordinates.flat()
        : [];
    for (const ring of rings) { for (const c of ring) { if (c[0] < w) w = c[0]; if (c[1] < s) s = c[1]; if (c[0] > e) e = c[0]; if (c[1] > n) n = c[1]; } }
  }
  if (w === Infinity) return null;
  return [[w, s], [e, n]];
}

function getFeatureCenter(f: GeoJSON.Feature): [number, number] | null {
  const g = f.geometry;
  if (!g) return null;
  if (g.type === 'Polygon') {
    const ring = (g as GeoJSON.Polygon).coordinates[0];
    if (!ring || ring.length === 0) return null;
    return [ring.reduce((s, c) => s + c[0], 0) / ring.length, ring.reduce((s, c) => s + c[1], 0) / ring.length];
  }
  if (g.type === 'MultiPolygon') {
    const ring = (g as GeoJSON.MultiPolygon).coordinates[0]?.[0];
    if (!ring || ring.length === 0) return null;
    return [ring.reduce((s, c) => s + c[0], 0) / ring.length, ring.reduce((s, c) => s + c[1], 0) / ring.length];
  }
  return null;
}

/** Clean GeoJSON: strip _meta and other non-standard props that confuse geojson-vt */
function cleanGeoJSON(raw: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: raw.features };
}
// ─── Zoom intelligence ─────────────────────────────────────────────────────

/**
 * Find the centroid of the densest cluster of features using a grid.
 * Returns the ACTUAL centroid of features in the densest cell (not cell center).
 */
function findDenseClusterCenter(geojson: GeoJSON.FeatureCollection): [number, number] | null {
  const GRID = 40;
  const fullBounds = computeCarreauxBounds(geojson);
  if (!fullBounds) return null;
  const bb = fullBounds as [[number, number], [number, number]];
  const cellW = (bb[1][0] - bb[0][0]) / GRID;
  const cellH = (bb[1][1] - bb[0][1]) / GRID;
  if (cellW === 0 || cellH === 0) return null;

  const cells = new Map<string, { count: number; sumLng: number; sumLat: number }>();
  for (const f of geojson.features) {
    const c = getFeatureCenter(f);
    if (!c) continue;
    const col = Math.min(Math.floor((c[0] - bb[0][0]) / cellW), GRID - 1);
    const row = Math.min(Math.floor((c[1] - bb[0][1]) / cellH), GRID - 1);
    const key = `${col},${row}`;
    const cell = cells.get(key) || { count: 0, sumLng: 0, sumLat: 0 };
    cell.count++;
    cell.sumLng += c[0];
    cell.sumLat += c[1];
    cells.set(key, cell);
  }

  if (cells.size === 0) return null;

  let bestKey = '';
  let bestCount = 0;
  for (const [key, cell] of cells) {
    if (cell.count > bestCount) { bestCount = cell.count; bestKey = key; }
  }

  const best = cells.get(bestKey)!;
  const center: [number, number] = [best.sumLng / best.count, best.sumLat / best.count];
  console.log(`  [cluster] Grid ${GRID}x${GRID}, densest="${bestKey}" ${bestCount} features, centroid=[${center[0].toFixed(4)}, ${center[1].toFixed(4)}]`);
  return center;
}

/**
 * Zoom vers les carreaux.
 * TOUJOURS zoom=14 pour que les carreaux 200m soient bien visibles (~20px).
 * Pour donnees nationales: zoom sur le cluster le plus dense.
 * Pour donnees locales: fitBounds.
 */
function _zoomToCarreaux(map: MapLibreMap, geojson: GeoJSON.FeatureCollection) {
  const bounds = computeCarreauxBounds(geojson);
  if (!bounds) return;

  const b = bounds as [[number, number], [number, number]];
  const spanLng = b[1][0] - b[0][0];
  const spanLat = b[1][1] - b[0][1];

  console.log(`[zoom] bbox span: ${spanLng.toFixed(2)} x ${spanLat.toFixed(2)}`);

  if (spanLng > 2 || spanLat > 2) {
    // National data: find dense cluster, flyTo at z14
    const center = findDenseClusterCenter(geojson);
    if (center) {
      console.log(`[zoom] -> flyTo cluster [${center[0].toFixed(4)}, ${center[1].toFixed(4)}] z=14`);
      map.flyTo({ center, zoom: 14, duration: 1500 });
    } else {
      const fc = getFeatureCenter(geojson.features[0]);
      if (fc) {
        console.log(`[zoom] -> flyTo first feature z=14`);
        map.flyTo({ center: fc, zoom: 14, duration: 1500 });
      }
    }
  } else {
    console.log(`[zoom] -> fitBounds local`);
    map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 1200 });
  }
}
// ─── Component ──────────────────────────────────────────────────────────────

export default function MapContainer({ pois, carreauxGeoJSON, carreauxMetric, carreauxVisible = true, onCoordsInfo, flyToTrigger, onBoundsChange, battleRings, battleBorders, onBattleCirfas }: MapContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const carreauxZoomedRef = useRef(false);
  const poisRef = useRef(pois);
  poisRef.current = pois;
  const [renderedCount, setRenderedCount] = useState(0);
  const onBoundsChangeRef = useRef(onBoundsChange);
  onBoundsChangeRef.current = onBoundsChange;

  const carreauxGeoJSONRef = useRef(carreauxGeoJSON);
  carreauxGeoJSONRef.current = carreauxGeoJSON;
  const carreauxMetricRef = useRef(carreauxMetric);
  carreauxMetricRef.current = carreauxMetric;
  const carreauxVisibleRef = useRef(carreauxVisible);
  carreauxVisibleRef.current = carreauxVisible;

  // ─── Init carte (once) ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    console.log('[MapContainer] Creating map');
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: RASTER_STYLE as any,
      center: [INITIAL_VIEWPORT.longitude, INITIAL_VIEWPORT.latitude],
      zoom: INITIAL_VIEWPORT.zoom,
    } as any);

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.on('error', e => console.error('[MapContainer] MapLibre error:', e.error));
    renderMarkers(map, poisRef.current, markersRef);

    const fireBounds = () => {
      const cb = onBoundsChangeRef.current;
      if (!cb) return;
      const b = map.getBounds();
      cb([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    map.on('moveend', fireBounds);

    map.on('load', () => {
      console.log('=== MAP LOAD ===');
      fireBounds();

      // GeoJSON source (empty)
      map.addSource('carreaux', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Fill layer
      map.addLayer({
        id: 'carreaux-fill',
        type: 'fill',
        source: 'carreaux',
        paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.7 },
      });

      // Outline layer
      map.addLayer({
        id: 'carreaux-line',
        type: 'line',
        source: 'carreaux',
        paint: { 'line-color': '#1a3a6a', 'line-width': 1, 'line-opacity': 0.9 },
      });

      console.log('  layers:', map.getStyle()?.layers?.map(l => l.id));

      const vis = carreauxVisibleRef.current ? 'visible' : 'none';
      map.setLayoutProperty('carreaux-fill', 'visibility', vis);
      map.setLayoutProperty('carreaux-line', 'visibility', vis);

      // Click popup
      map.on('click', 'carreaux-fill', (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties as Record<string, unknown>;
        const metric = carreauxMetricRef.current || '';
        const metricVal = metric && props[metric] != null
          ? `<b>${formatMetricLabel(metric)}</b>: ${typeof props[metric] === 'number' ? (props[metric] as number).toLocaleString('fr-FR') : props[metric]}`
          : '';
        const label = props.commune || props.libelle_iris || props.nom || props.idcar || '';
        const skipKeys = new Set(['idcar', 'x', 'y', metric, 'gml_id', 'objectid']);
        const extras: string[] = [];
        for (const [k, v] of Object.entries(props)) {
          if (skipKeys.has(k)) continue;
          if (typeof v === 'number') extras.push(`${formatMetricLabel(k)}: ${v.toLocaleString('fr-FR')}`);
          if (extras.length >= 5) break;
        }
        const html = `<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.5;max-width:280px">
          <b style="color:#1e40af">${label}</b><br/>
          <div style="margin-top:4px;display:flex;flex-direction:column;gap:2px">
            ${metricVal ? `<span>${metricVal}</span>` : ''}
            ${extras.map(e => `<span style="color:#475569">${e}</span>`).join('')}
          </div></div>`;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map);
      });

      map.on('mouseenter', 'carreaux-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'carreaux-fill', () => { map.getCanvas().style.cursor = ''; });

      // ── Sources bataille d'isochrones ─────────────────────────────────
      map.addSource('battle-rings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, generateId: true });
      map.addLayer({ id: 'battle-fill', type: 'fill', source: 'battle-rings',
        paint: { 'fill-color': ['get', 'battle_color'] as any, 'fill-opacity': ['get', 'battle_opacity'] as any },
        layout: { visibility: 'none' } });
      map.addLayer({ id: 'battle-ring-line', type: 'line', source: 'battle-rings',
        paint: { 'line-color': 'rgba(0,0,0,0.12)', 'line-width': 0.5, 'line-opacity': 0.6 },
        layout: { visibility: 'none' } });

      map.addSource('battle-borders', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'battle-cirfa-border', type: 'line', source: 'battle-borders',
        paint: { 'line-color': '#111827', 'line-width': 3, 'line-opacity': 0.85 },
        layout: { visibility: 'none' } });

      map.on('click', 'battle-fill', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6">
            <b style="color:#1e293b">${p.nom ?? '—'}</b><br/>
            <span style="color:#059669;font-weight:600">⏱ Anneau ${p.palier ?? '?'} min</span>
          </div>`).addTo(map);
      });
      map.on('mouseenter', 'battle-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'battle-fill', () => { map.getCanvas().style.cursor = ''; });

      console.log('=== MAP READY ===');
      setMapReady(true);
    });

    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      carreauxZoomedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ─── Update markers ────────────────────────────────────────────
  useEffect(() => {
    const validCount = pois.filter(isValidPOI).length;
    onCoordsInfo?.(validCount, pois.length);
    const map = mapRef.current;
    if (!map) return;
    renderMarkers(map, pois, markersRef);
  }, [pois, onCoordsInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── CARREAUX: set data + choropleth + auto-zoom ──────────────
  useEffect(() => {
    const map = mapRef.current;
    console.log('=== CARREAUX EFFECT === ready:', mapReady, 'features:', carreauxGeoJSON?.features?.length ?? 0);

    if (!map || !mapReady) return;

    const source = map.getSource('carreaux') as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      console.error('  source "carreaux" NOT FOUND!');
      return;
    }

    if (!carreauxGeoJSON || carreauxGeoJSON.features.length === 0) {
      source.setData({ type: 'FeatureCollection', features: [] });
      carreauxZoomedRef.current = false;
      setRenderedCount(0);
      return;
    }

    // Log first feature
    const f0 = carreauxGeoJSON.features[0];
    if (f0?.geometry?.type === 'Polygon') {
      const ring = (f0.geometry as GeoJSON.Polygon).coordinates[0];
      console.log('  f[0] ring:', ring?.length, 'pts, first:', ring?.[0]);
    }

    // ── CRITICAL: Clean GeoJSON (remove _meta etc.) ──
    const cleanData = cleanGeoJSON(carreauxGeoJSON);
    console.log(`  setData(${cleanData.features.length} features)...`);
    source.setData(cleanData);

    // ── Force layers on top + visible ──
    try { map.moveLayer('carreaux-fill'); map.moveLayer('carreaux-line'); } catch {}
    map.setLayoutProperty('carreaux-fill', 'visibility', 'visible');
    map.setLayoutProperty('carreaux-line', 'visibility', 'visible');

    // ── Choropleth ──
    const metric = carreauxMetric || 'ind';
    const [mn, mx] = computeMinMax(carreauxGeoJSON, metric);
    console.log(`  metric="${metric}" [${mn}, ${mx}]`);

    if (mn < mx) {
      try {
        map.setPaintProperty('carreaux-fill', 'fill-color', buildFillColor(metric, mn, mx));
      } catch (err) {
        console.error('  choropleth error:', err);
        map.setPaintProperty('carreaux-fill', 'fill-color', '#4a90d9');
      }
    } else {
      map.setPaintProperty('carreaux-fill', 'fill-color', '#4a90d9');
    }
    map.setPaintProperty('carreaux-fill', 'fill-opacity', 0.7);

    // ── Auto-zoom ──
    if (!carreauxZoomedRef.current && carreauxVisible) {
      _zoomToCarreaux(map, carreauxGeoJSON);
      carreauxZoomedRef.current = true;
    }

    // ── Force repaint ──
    map.triggerRepaint();

    // ── Post-render check (after flyTo animation ~2s + render) ──
    const t1 = setTimeout(() => {
      if (!mapRef.current) return;
      const m = mapRef.current;
      try {
        const rendered = m.queryRenderedFeatures(undefined as any, { layers: ['carreaux-fill'] });
        console.log(`  POST-CHECK 3s: ${rendered.length} carreaux on screen, zoom=${m.getZoom().toFixed(1)}`);
        setRenderedCount(rendered.length);
        if (rendered.length === 0) {
          console.error('  ZERO carreaux visible! zoom:', m.getZoom().toFixed(1), 'visibility:', m.getLayoutProperty('carreaux-fill', 'visibility'));
        }
      } catch {}
    }, 3500);

    const t2 = setTimeout(() => {
      if (!mapRef.current) return;
      const m = mapRef.current;
      try {
        const rendered = m.queryRenderedFeatures(undefined as any, { layers: ['carreaux-fill'] });
        console.log(`  POST-CHECK 6s: ${rendered.length} carreaux on screen, zoom=${m.getZoom().toFixed(1)}`);
        setRenderedCount(rendered.length);
      } catch {}
    }, 6500);

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [carreauxGeoJSON, carreauxMetric, mapReady, carreauxVisible]);

  // ─── Localiser (manual re-center) ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !flyToTrigger || !carreauxGeoJSON || carreauxGeoJSON.features.length === 0) return;
    _zoomToCarreaux(map, carreauxGeoJSON);
  }, [flyToTrigger, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Toggle visibility ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = carreauxVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('carreaux-fill', 'visibility', vis);
      map.setLayoutProperty('carreaux-line', 'visibility', vis);
    } catch {}
  }, [carreauxVisible, mapReady]);

  // ─── Battle rings ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('battle-rings') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (!battleRings?.features?.length) {
      src.setData({ type: 'FeatureCollection', features: [] });
      try { map.setLayoutProperty('battle-fill', 'visibility', 'none'); map.setLayoutProperty('battle-ring-line', 'visibility', 'none'); } catch {}
      return;
    }

    const cirfaColorMap = new Map<string, string>();
    let colorIdx = 0;
    const styledFeatures = battleRings.features.map(f => {
      const p = f.properties as any;
      const cid = String(p?.id ?? '');
      if (cid && !cirfaColorMap.has(cid)) { cirfaColorMap.set(cid, BATTLE_PALETTE[colorIdx % BATTLE_PALETTE.length]); colorIdx++; }
      const palier = Number(p?.palier ?? 120);
      return { ...f, properties: { ...p, battle_color: cirfaColorMap.get(cid) ?? BATTLE_PALETTE[0], battle_opacity: BATTLE_PALIER_OPACITY[palier] ?? 0.18 } };
    });

    src.setData({ type: 'FeatureCollection', features: styledFeatures } as GeoJSON.FeatureCollection);
    try { map.setLayoutProperty('battle-fill', 'visibility', 'visible'); map.setLayoutProperty('battle-ring-line', 'visibility', 'visible'); } catch {}

    // Fit bounds
    const bounds = new maplibregl.LngLatBounds();
    let extended = false;
    for (const f of styledFeatures) {
      const geom = (f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>).geometry;
      if (!geom) continue;
      const rings = geom.type === 'MultiPolygon' ? geom.coordinates.flat(1) : geom.type === 'Polygon' ? geom.coordinates : [];
      for (const ring of rings) for (const coord of ring) { bounds.extend([coord[0], coord[1]]); extended = true; }
    }
    if (extended) map.fitBounds(bounds, { padding: 60, maxZoom: 11, duration: 1200 });

    // Remonter la légende CIRFA
    const legend: { id: string; nom: string; color: string }[] = [];
    const seen = new Set<string>();
    for (const f of styledFeatures) {
      const p = f.properties as any;
      const cid = String(p?.id ?? '');
      if (cid && !seen.has(cid)) {
        seen.add(cid);
        legend.push({ id: cid, nom: String(p?.nom ?? cid), color: cirfaColorMap.get(cid) ?? BATTLE_PALETTE[0] });
      }
    }
    onBattleCirfas?.(legend);
  }, [battleRings, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Battle borders ────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('battle-borders') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (battleBorders?.features?.length) {
      src.setData(battleBorders as GeoJSON.FeatureCollection);
      try { map.setLayoutProperty('battle-cirfa-border', 'visibility', 'visible'); } catch {}
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
      try { map.setLayoutProperty('battle-cirfa-border', 'visibility', 'none'); } catch {}
    }
  }, [battleBorders, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debug overlay info
  const debugInfo = carreauxGeoJSON && carreauxGeoJSON.features.length > 0
    ? (() => {
        const f0 = carreauxGeoJSON.features[0];
        const geom0 = f0?.geometry;
        let coordInfo = '?';
        if (geom0?.type === 'Polygon') {
          const pt = (geom0 as GeoJSON.Polygon).coordinates[0]?.[0];
          if (pt) {
            const lngOk = pt[0] >= -10 && pt[0] <= 15;
            const latOk = pt[1] >= 40 && pt[1] <= 55;
            coordInfo = `[${pt[0].toFixed(2)}, ${pt[1].toFixed(2)}] ${lngOk && latOk ? 'WGS84' : 'NON-WGS84!'}`;
          }
        }
        const metric = carreauxMetric || 'ind';
        const [mn, mx] = computeMinMax(carreauxGeoJSON, metric);
        return `${carreauxGeoJSON.features.length} carreaux | ${coordInfo} | ${metric}:[${mn}..${mx}] | rendered:${renderedCount}`;
      })()
    : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#e8e8e8' }} />
      {debugInfo && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8,
          background: 'rgba(0,0,0,0.8)', color: '#00ff88',
          fontFamily: 'monospace', fontSize: '11px',
          padding: '4px 8px', borderRadius: '4px',
          pointerEvents: 'none', zIndex: 20,
          maxWidth: '90%', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {debugInfo}
        </div>
      )}
    </div>
  );
}