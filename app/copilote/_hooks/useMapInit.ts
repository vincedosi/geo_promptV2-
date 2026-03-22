'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { MAP_STYLE, getCatColor } from '../_lib/constants';
import type { ZoneData } from '@/types/spatial';

interface SelectedBillboard {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  format?: string;
  score?: number | null;
  audience?: number | null;
  rank?: number | null;
  regie?: string;
}

/** Remplace récursivement name_en/name:en par le nom local (name) dans une expression MapLibre */
function patchLabelFr(expr: unknown): unknown {
  if (!expr) return expr;
  if (typeof expr === 'string') {
    return expr.replace(/\{name_en\}/g, '{name}').replace(/\{name:en\}/g, '{name}');
  }
  if (Array.isArray(expr)) {
    if (expr[0] === 'get' && (expr[1] === 'name_en' || expr[1] === 'name:en')) {
      return ['coalesce', ['get', 'name:fr'], ['get', 'name']];
    }
    return expr.map(patchLabelFr);
  }
  if (typeof expr === 'object' && expr !== null) {
    return Object.fromEntries(
      Object.entries(expr as Record<string, unknown>).map(([k, v]) => [k, patchLabelFr(v)])
    );
  }
  return expr;
}

export function useMapInit(
  zoneData: ZoneData | null,
  onBillboardSelect?: (billboard: SelectedBillboard) => void,
  mapStyleUrl?: string,
) {
  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef  = useRef<HTMLDivElement>(null);
  const mapRef           = useRef<maplibregl.Map | null>(null);
  const markersRef       = useRef<maplibregl.Marker[]>([]);
  const canvasOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const zoneDataRef      = useRef<ZoneData | null>(null);

  // Sync zoneDataRef so the map.on('render') closure always reads the latest value
  useEffect(() => { zoneDataRef.current = zoneData; }, [zoneData]);

  // ── Init MapLibre (recreate when style changes) ──────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const DEFAULT_CENTER: [number, number] = [2.3, 46.6];
    const DEFAULT_ZOOM = 5.5;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: (mapStyleUrl ?? MAP_STYLE) as any,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });


    // Canvas overlay POI circles
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1';
    mapContainerRef.current.appendChild(overlay);
    canvasOverlayRef.current = overlay;

    // ── Zoom indicator ────────────────────────────────────────────────────────
    const zoomBadge = document.createElement('div');
    zoomBadge.style.cssText = [
      'position:absolute',
      'top:10px',
      'left:10px',
      'z-index:10',
      'pointer-events:none',
      'background:rgba(5,5,5,0.82)',
      'border:1px solid #a855f7',
      'color:#a855f7',
      'font-family:JetBrains Mono,monospace',
      'font-size:11px',
      'letter-spacing:0.05em',
      'padding:3px 8px',
      'border-radius:2px',
    ].join(';');
    const updateZoomBadge = () => {
      const z = map.getZoom();
      const zInt = Math.floor(z);
      const tier = zInt >= 10 ? '200m' : zInt >= 8 ? '2km' : zInt >= 6 ? '5km' : '—';
      zoomBadge.textContent = `z${zInt}  ${tier}`;
    };
    updateZoomBadge();
    map.on('zoom', updateZoomBadge);
    mapContainerRef.current.appendChild(zoomBadge);

    // Draw POI radius circles on every frame
    map.on('render', () => {
      const data = zoneDataRef.current;
      const c = canvasOverlayRef.current;
      const container = mapContainerRef.current;
      if (!c || !container) return;

      const w = container.clientWidth;
      const h = container.clientHeight;
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;

      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      if (!data?.rayon_poi_metres || !data.pois.length) return;

      const rM = data.rayon_poi_metres;

      for (const p of data.pois) {
        if (p.lat == null || p.lng == null) continue;
        try {
          const pt = map.project([p.lng, p.lat]);
          const zoom = map.getZoom();
          const metersPerPx = (156543.03 * Math.cos(p.lat * Math.PI / 180)) / Math.pow(2, zoom);
          const rPx = rM / metersPerPx;
          if (rPx < 1) continue;

          const color = zoneDataRef.current?.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, rPx, 0, 2 * Math.PI);
          ctx.fillStyle = color + '1e';
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        } catch {
          // projection hors vue — skip
        }
      }
    });

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    map.on('load', () => {
      // ── Patch labels → langue locale (français) ───────────────────────────
      for (const layer of (map.getStyle()?.layers ?? [])) {
        if (layer.type !== 'symbol') continue;
        const tf = (layer.layout as Record<string, unknown>)?.['text-field'];
        if (!tf) continue;
        try { map.setLayoutProperty(layer.id, 'text-field', patchLabelFr(tf)); } catch { /* hors vue */ }
      }

      // ── Heatmap densité POI (large zoom) ─────────────────────────────────
      map.addSource('pois-heat', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'pois-heatmap',
        type: 'heatmap',
        source: 'pois-heat',
        maxzoom: 14,
        paint: {
          // Intensité croissante avec le zoom
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            0, 0.6,
            6, 1.5,
            9, 2.5,
          ] as unknown as maplibregl.ExpressionSpecification,
          // Rayon de diffusion en px selon le zoom
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            0, 3,
            5, 10,
            9, 20,
            12, 30,
          ] as unknown as maplibregl.ExpressionSpecification,
          // Palette bleu-marine (style INSEE)
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,   'rgba(33,102,172,0)',
            0.15, '#c6dbef',
            0.35, '#6baed6',
            0.60, '#2171b5',
            0.80, '#08519c',
            1,   '#08306b',
          ] as unknown as maplibregl.ExpressionSpecification,
          // Fade out progressif entre zoom 11 et 13
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            11, 1,
            13, 0,
          ] as unknown as maplibregl.ExpressionSpecification,
        },
      });

      // ── Cercles POI GPU (grands datasets, remplace les DOM markers) ──────
      // Même source que la heatmap — on ajoute des layers circle dessus.
      // Visible seulement à zoom ≥ 11 (heatmap fade-out terminé à zoom 13).
      map.addLayer({
        id: 'pois-circles',
        type: 'circle',
        source: 'pois-heat',
        minzoom: 11,
        paint: {
          'circle-color': ['coalesce', ['get', 'color'], '#6366f1'] as unknown as maplibregl.ExpressionSpecification,
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            3,  2,
            7,  3,
            11, 4,
            13, 6,
            16, 9,
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': [
            'interpolate', ['linear'], ['zoom'],
            3, 0.7,
            7, 0.85,
            12.5, 1,
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-stroke-opacity': [
            'interpolate', ['linear'], ['zoom'],
            3, 0,
            7, 0.4,
            12.5, 0.9,
          ] as unknown as maplibregl.ExpressionSpecification,
        },
        layout: { visibility: 'none' },
      });

      // Click popup pour les cercles GPU
      map.on('click', 'pois-circles', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, string>;
        const categorie = String(p.categorie ?? '').toLowerCase();
        const isBillboard = categorie === 'panneaux' || categorie === 'top_ooh';

        if (isBillboard && onBillboardSelect) {
          const lat = Number(p.lat ?? e.lngLat.lat);
          const lng = Number(p.lng ?? e.lngLat.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

          const toNumOrNull = (v: unknown): number | null => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
          };
          onBillboardSelect({
            id: String(p.id ?? p.nom ?? 'panneau'),
            nom: p.nom ?? 'Panneau',
            lat,
            lng,
            format: p.format || p.sous_categorie || undefined,
            score: toNumOrNull(p.score_ooh),
            audience: toNumOrNull(p.audience),
            rank: toNumOrNull(p.rank),
            regie: p.regie || p.adresse || undefined,
          });
          return;
        }

        const html = `<div style="font-size:12px;padding:6px 8px">` +
          `<strong>${p.nom ?? 'POI'}</strong><br/>` +
          `<span style="color:${p.color ?? '#6366f1'};font-size:11px;font-weight:600;text-transform:uppercase">${p.categorie ?? ''}</span>` +
          (p.sous_categorie ? ` <span style="color:#94a3b8;font-size:11px">· ${p.sous_categorie}</span>` : '') +
          (p.adresse ? `<br/><span style="color:#64748b;font-size:11px">📍 ${p.adresse}</span>` : '') +
          `</div>`;
        new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on('mousemove', 'pois-circles', (e) => {
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
        const categorie = String(p?.categorie ?? '').toLowerCase();
        const isBillboard = categorie === 'panneaux' || categorie === 'top_ooh';
        map.getCanvas().style.cursor = isBillboard ? 'pointer' : '';
      });
      map.on('mouseleave', 'pois-circles', () => { map.getCanvas().style.cursor = ''; });

      // ── Wizard highlight (clustering wizard — POI preview) ───────────────
      map.addSource('wizard-highlight', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'wizard-highlight-layer', type: 'circle', source: 'wizard-highlight',
        paint: {
          'circle-color': '#f59e0b',
          'circle-radius': 5,
          'circle-opacity': 0.80,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#050505',
        },
        layout: { visibility: 'none' },
      });

      // ── Zone circle ──────────────────────────────────────────────────────
      map.addSource('zone-circle', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zone-circle', paint: { 'fill-color': '#7c3aed', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'zone-outline', type: 'line', source: 'zone-circle', paint: { 'line-color': '#a78bfa', 'line-width': 2, 'line-dasharray': [4, 3] } });

      // ── Voronoï ──────────────────────────────────────────────────────────
      map.addSource('voronoi', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'voronoi-fill', type: 'fill', source: 'voronoi',
        paint: {
          'fill-color': ['get', 'voronoi_color'] as unknown as maplibregl.ExpressionSpecification,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.50, 0.35] as unknown as maplibregl.ExpressionSpecification,
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'voronoi-line', type: 'line', source: 'voronoi',
        paint: {
          'line-color': '#ffffff',
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 1.2, 0.3] as unknown as maplibregl.ExpressionSpecification,
          'line-opacity': 0.9,
        },
        layout: { visibility: 'none' },
      });

      map.on('click', 'voronoi-fill', (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties as Record<string, unknown>;
        new maplibregl.Popup({ closeButton: true, maxWidth: '250px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6;max-width:220px"><b style="color:#1e293b">${props.nom ?? '—'}</b><br/><span style="color:#64748b;font-size:11px">${props.adresse ?? ''}</span><div style="color:#94a3b8;font-size:11px;margin-top:2px">${props.ville ?? ''}</div></div>`)
          .addTo(map);
      });

      let voronoiHoveredId: number | null = null;
      map.on('mousemove', 'voronoi-fill', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (!e.features?.length) return;
        const fid = e.features[0].id as number;
        if (fid !== undefined && fid !== voronoiHoveredId) {
          if (voronoiHoveredId !== null) map.setFeatureState({ source: 'voronoi', id: voronoiHoveredId }, { hover: false });
          voronoiHoveredId = fid;
          map.setFeatureState({ source: 'voronoi', id: fid }, { hover: true });
        }
      });
      map.on('mouseleave', 'voronoi-fill', () => {
        map.getCanvas().style.cursor = '';
        if (voronoiHoveredId !== null) {
          map.setFeatureState({ source: 'voronoi', id: voronoiHoveredId }, { hover: false });
          voronoiHoveredId = null;
        }
      });

      // ── Voronoï POIs ─────────────────────────────────────────────────────
      map.addSource('voronoi-pois', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'voronoi-pois-circle', type: 'circle', source: 'voronoi-pois',
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 7, 5] as unknown as maplibregl.ExpressionSpecification,
          'circle-color': '#ef4444',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 1,
          'circle-pitch-alignment': 'map',
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'voronoi-pois-halo', type: 'circle', source: 'voronoi-pois',
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 16, 12] as unknown as maplibregl.ExpressionSpecification,
          'circle-color': '#ffffff',
          'circle-opacity': 0.3,
          'circle-blur': 1,
          'circle-pitch-alignment': 'map',
        },
        layout: { visibility: 'none' },
      }, 'voronoi-pois-circle');

      map.on('click', 'voronoi-pois-circle', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6;max-width:240px"><b style="color:#1e293b">${p.nom ?? '—'}</b><br/><span style="color:#64748b;font-size:11px">${p.adresse ?? ''}</span><div style="color:#94a3b8;font-size:11px;margin-top:2px">${p.ville ?? ''}</div></div>`)
          .addTo(map);
      });

      let voronoiPoiHoveredId: number | null = null;
      map.on('mousemove', 'voronoi-pois-circle', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (!e.features?.length) return;
        const fid = e.features[0].id as number;
        if (fid !== voronoiPoiHoveredId) {
          if (voronoiPoiHoveredId !== null) map.setFeatureState({ source: 'voronoi-pois', id: voronoiPoiHoveredId }, { hover: false });
          voronoiPoiHoveredId = fid;
          map.setFeatureState({ source: 'voronoi-pois', id: fid }, { hover: true });
        }
      });
      map.on('mouseleave', 'voronoi-pois-circle', () => {
        map.getCanvas().style.cursor = '';
        if (voronoiPoiHoveredId !== null) {
          map.setFeatureState({ source: 'voronoi-pois', id: voronoiPoiHoveredId }, { hover: false });
          voronoiPoiHoveredId = null;
        }
      });

      // ── Isochrones ────────────────────────────────────────────────────────
      map.addSource('isochrones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({ id: 'isochrones-fill', type: 'fill', source: 'isochrones', paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.18 }, layout: { visibility: 'none' } });
      map.addLayer({ id: 'isochrones-line', type: 'line', source: 'isochrones', paint: { 'line-color': '#16a34a', 'line-width': 2, 'line-opacity': 0.85 }, layout: { visibility: 'none' } });

      // ── IRIS choroplèthe (IGN 2025) ─────────────────────────────────────────
      // Source GeoJSON rechargée par viewport via moveend (useMapLayers)
      // Inséré AVANT carreaux pour z-order : IRIS sous carreaux sous POIs
      map.addSource('iris-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'iris-fill', type: 'fill',
        source: 'iris-source',
        minzoom: 9,
        paint: {
          'fill-color':   '#4292C6',
          'fill-opacity': 0.45,
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'iris-border', type: 'line',
        source: 'iris-source',
        minzoom: 9,
        paint: {
          'line-color':   'rgba(0,0,0,0.18)',
          'line-width':   0.5,
          'line-opacity': 0.5,
        },
        layout: { visibility: 'none' },
      });

      // ── Carreaux MVT (Filosofi) ─────────────────────────────────────────────
      // z6-7  → carreaux_5km  (SQL 035)
      // z8-9  → carreaux_2km  (SQL 035)
      // z10+  → carreaux_filosofi 200m
      map.addSource('carreaux-mvt', {
        type: 'vector',
        tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}?v=11`],
        minzoom: 6,
        maxzoom: 14,
        attribution: 'INSEE, Filosofi 2019',
      });
      map.addLayer({
        id: 'carreaux-mvt-fill', type: 'fill',
        source: 'carreaux-mvt', 'source-layer': 'carreaux',
        minzoom: 6,
        paint: { 'fill-color': '#FC9272', 'fill-opacity': 0.65 },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'carreaux-mvt-line', type: 'line',
        source: 'carreaux-mvt', 'source-layer': 'carreaux',
        minzoom: 9,
        paint: {
          'line-color': '#555',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.05, 10, 0.1, 12, 0.3, 14, 0.8] as unknown as maplibregl.ExpressionSpecification,
          'line-opacity': 0.35,
        },
        layout: { visibility: 'none' },
      });

      // ── Test ORS ──────────────────────────────────────────────────────────
      map.addSource('test-iso', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({ id: 'test-iso-fill', type: 'fill', source: 'test-iso', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.5 }, layout: { visibility: 'none' } });
      map.addLayer({ id: 'test-iso-line', type: 'line', source: 'test-iso', paint: { 'line-color': '#1d4ed8', 'line-width': 2, 'line-opacity': 0.9 }, layout: { visibility: 'none' } });

      map.on('click', 'test-iso-fill', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6"><b style="color:#1e293b">${p.cirfa_nom ?? '—'}</b><br/><span style="color:#2563eb;font-weight:600">⏱ ${p.minutes_req ?? '?'} min (${p.mode ?? '?'})</span><br/><span style="color:#94a3b8;font-size:10px">id: ${p.cirfa_id ?? '?'}</span></div>`)
          .addTo(map);
      });

      // ── Bataille d'Isochrones ─────────────────────────────────────────────
      map.addSource('battle-rings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'battle-fill', type: 'fill', source: 'battle-rings',
        // Filtre : ne jamais rendre les border features comme polygones remplis
        filter: ['!=', ['get', 'feature_type'], 'border'] as unknown as maplibregl.ExpressionSpecification,
        paint: {
          'fill-color':   ['coalesce', ['get', 'battle_color'],   '#4e79a7'] as unknown as maplibregl.ExpressionSpecification,
          'fill-opacity': ['coalesce', ['get', 'battle_opacity'], 0.5]       as unknown as maplibregl.ExpressionSpecification,
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'battle-ring-line', type: 'line', source: 'battle-rings',
        filter: ['!=', ['get', 'feature_type'], 'border'] as unknown as maplibregl.ExpressionSpecification,
        paint: { 'line-color': 'rgba(0,0,0,0.15)', 'line-width': 0.5, 'line-opacity': 0.6 },
        layout: { visibility: 'none' },
      });

      map.addSource('battle-borders', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'battle-cirfa-border', type: 'line', source: 'battle-borders',
        paint: { 'line-color': '#111827', 'line-width': 1, 'line-opacity': 0.3 },
        layout: { visibility: 'none' },
      });

      map.on('click', 'battle-fill', (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties as Record<string, unknown>;
        const palier = Number(props.palier ?? 0);
        new maplibregl.Popup({ closeButton: true, maxWidth: '250px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6;max-width:220px"><b style="color:#1e293b">${props.nom ?? '—'}</b><br/><span style="color:#64748b;font-size:11px">${props.adresse ?? ''}</span><div style="color:#94a3b8;font-size:11px;margin-top:2px">${props.ville ?? ''}</div><div style="margin-top:4px;font-weight:600;color:#059669">⏱ Anneau ${palier} min</div></div>`)
          .addTo(map);
      });

      map.addSource('battle-pois', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'battle-pois-circle', type: 'circle', source: 'battle-pois',
        paint: { 'circle-radius': 5, 'circle-color': '#dc2626', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff', 'circle-opacity': 1, 'circle-pitch-alignment': 'map' },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'battle-pois-halo', type: 'circle', source: 'battle-pois',
        paint: { 'circle-radius': 12, 'circle-color': '#ffffff', 'circle-opacity': 0.3, 'circle-blur': 1, 'circle-pitch-alignment': 'map' },
        layout: { visibility: 'none' },
      }, 'battle-pois-circle');

      map.on('click', 'battle-pois-circle', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.6;max-width:240px"><b style="color:#1e293b">${p.nom ?? '—'}</b><br/><span style="color:#64748b;font-size:11px">${p.adresse ?? ''}</span><div style="color:#94a3b8;font-size:11px;margin-top:2px">${p.ville ?? ''}</div></div>`)
          .addTo(map);
      });

      // ── Clustering POI Filosofi ───────────────────────────────────────────
      map.addSource('clusters-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        generateId: true,
      });
      map.addLayer({
        id: 'clusters-layer',
        type: 'circle',
        source: 'clusters-source',
        paint: {
          'circle-color':        ['get', 'cluster_color'] as unknown as maplibregl.ExpressionSpecification,
          'circle-radius':       7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity':      0.92,
        },
        layout: { visibility: 'none' },
      });

      map.on('click', 'clusters-layer', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, string>;
        let profileFeatures: Record<string, number> = {};
        try { profileFeatures = JSON.parse(p.profile_features ?? '{}'); } catch { /* */ }

        // Notify React (ClusterPanel listens via custom event)
        window.dispatchEvent(new CustomEvent('genesis:cluster-select', {
          detail: {
            poi_id:           p.poi_id,
            poi_name:         p.poi_name,
            cluster_id:       Number(p.cluster_id),
            cluster_label:    p.cluster_label,
            cluster_color:    p.cluster_color,
            categorie:        p.categorie,
            ville:            p.ville,
            profile_features: profileFeatures,
            lat:              e.lngLat.lat,
            lng:              e.lngLat.lng,
          },
        }));

        // Simple popup
        new maplibregl.Popup({ closeButton: true, maxWidth: '220px' })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-size:12px;padding:6px 8px;font-family:sans-serif">` +
            `<b style="color:#1e293b">${p.poi_name ?? '—'}</b><br/>` +
            `<span style="display:inline-block;margin-top:3px;padding:1px 6px;border-radius:2px;font-size:10px;background:${p.cluster_color};color:#fff">${p.cluster_label}</span>` +
            `<div style="color:#94a3b8;font-size:10px;margin-top:3px">${p.ville ?? ''}</div>` +
            `</div>`
          )
          .addTo(map);
      });
      map.on('mousemove',  'clusters-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'clusters-layer', () => { map.getCanvas().style.cursor = ''; });

      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
      overlay.remove();
      zoomBadge.remove();
      canvasOverlayRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStyleUrl]);

  return {
    mapContainerRef,
    mapRef,
    markersRef,
    canvasOverlayRef,
    mapReady,
    zoneDataRef,
  };
}
