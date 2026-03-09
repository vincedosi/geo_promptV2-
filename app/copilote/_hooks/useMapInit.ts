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

export function useMapInit(
  zoneData: ZoneData | null,
  onBillboardSelect?: (billboard: SelectedBillboard) => void,
) {
  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef  = useRef<HTMLDivElement>(null);
  const mapRef           = useRef<maplibregl.Map | null>(null);
  const markersRef       = useRef<maplibregl.Marker[]>([]);
  const canvasOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const zoneDataRef      = useRef<ZoneData | null>(null);

  // Sync zoneDataRef so the map.on('render') closure always reads the latest value
  useEffect(() => { zoneDataRef.current = zoneData; }, [zoneData]);

  // ── Init MapLibre (once) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE as any,
      center: [2.3, 46.6],
      zoom: 5.5,
    });

    // Canvas overlay POI circles
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1';
    mapContainerRef.current.appendChild(overlay);
    canvasOverlayRef.current = overlay;

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
            11, 3,
            13, 5,
            16, 8,
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': [
            'interpolate', ['linear'], ['zoom'],
            11, 0,
            12.5, 1,
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-stroke-opacity': [
            'interpolate', ['linear'], ['zoom'],
            11, 0,
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
        console.log('[useMapInit click] categorie:', categorie, 'isBillboard:', isBillboard, 'p:', p);

        if (isBillboard && onBillboardSelect) {
          const lat = Number(p.lat ?? e.lngLat.lat);
          const lng = Number(p.lng ?? e.lngLat.lng);
          console.log('[useMapInit click] lat:', lat, 'lng:', lng, 'isFinite:', Number.isFinite(lat), Number.isFinite(lng));
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

          const toNumOrNull = (v: unknown): number | null => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
          };

          console.log('[useMapInit click] CALLING onBillboardSelect');
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

      // ── Carreaux ──────────────────────────────────────────────────────────
      map.addSource('carreaux', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({ id: 'carreaux-fill', type: 'fill', source: 'carreaux', paint: { 'fill-color': '#6baed6', 'fill-opacity': 0.35 }, layout: { visibility: 'none' } });
      map.addLayer({ id: 'carreaux-line', type: 'line', source: 'carreaux', paint: { 'line-color': '#2171b5', 'line-width': 1, 'line-opacity': 0.6 }, layout: { visibility: 'none' } });

      map.on('click', 'carreaux-fill', (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties as Record<string, unknown>;
        const commune = props.commune || props.libelle_iris || '—';
        const pop = props.population ?? '—';
        new maplibregl.Popup({ closeButton: true, maxWidth: '250px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.5;max-width:220px"><b style="color:#1e40af">${commune}</b><br/><span style="color:#64748b;font-size:11px">${props.libelle_iris || ''}</span><div style="margin-top:4px">Pop: <b>${typeof pop === 'number' ? pop.toLocaleString('fr-FR') : pop}</b></div>${props.departement ? `<span style="color:#94a3b8;font-size:11px">Dept. ${props.departement}</span>` : ''}</div>`)
          .addTo(map);
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
        paint: {
          'fill-color':   ['get', 'battle_color']  as unknown as maplibregl.ExpressionSpecification,
          'fill-opacity': ['get', 'battle_opacity'] as unknown as maplibregl.ExpressionSpecification,
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({ id: 'battle-ring-line', type: 'line', source: 'battle-rings', paint: { 'line-color': 'rgba(0,0,0,0.15)', 'line-width': 0.5, 'line-opacity': 0.6 }, layout: { visibility: 'none' } });

      map.addSource('battle-borders', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'battle-cirfa-border', type: 'line', source: 'battle-borders',
        paint: { 'line-color': '#111827', 'line-width': 3, 'line-opacity': 0.85 },
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

      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      overlay.remove();
      canvasOverlayRef.current = null;
    };
  }, []);

  return {
    mapContainerRef,
    mapRef,
    markersRef,
    canvasOverlayRef,
    mapReady,
    zoneDataRef,
  };
}
