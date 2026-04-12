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
}

export function SyncMap({ id, geojson, fillExpression, lineColor, onMove, syncTarget, zoomOffset = 0 }: SyncMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isSyncing = useRef(false);

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

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
