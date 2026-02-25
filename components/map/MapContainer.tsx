'use client';

import { useEffect, useRef } from 'react';
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

interface MapContainerProps {
  pois: POI[];
  onCoordsInfo?: (valid: number, total: number) => void;
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
    p.sous_categorie ? ` <span style="color:#94a3b8;font-size:11px">· ${p.sous_categorie}</span>` : '',
    p.adresse ? `<p style="margin:4px 0 0;color:#475569">📍 ${p.adresse}</p>` : '',
    p.ville ? `<p style="margin:4px 0 0;color:#475569">🏙️ ${p.ville}${p.code_postal ? ` (${p.code_postal})` : ''}</p>` : '',
    p.departement ? `<p style="margin:4px 0 0;color:#64748b;font-size:12px">${p.departement}${p.region ? ` · ${p.region}` : ''}</p>` : '',
    `</div>`,
  ];
  return parts.join('');
}

// Raster basemap style — tiles CARTO Light
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
      attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://openstreetmap.org/copyright">OSM</a>',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'carto-bg', type: 'raster' as const, source: 'carto' }],
};

// ─── Module-level helpers (no closure issues) ─────────────────────────────────

function renderMarkers(
  map: MapLibreMap,
  poiList: POI[],
  markersRef: React.MutableRefObject<maplibregl.Marker[]>
) {
  // Remove old markers
  markersRef.current.forEach(m => m.remove());
  markersRef.current = [];

  const valid = poiList.filter(isValidPOI);
  console.log(`[MapContainer] Rendering ${valid.length} markers`);

  valid.forEach(p => {
    const color = getCategoryColor(p.categorie);

    // Circle marker element
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function MapContainer({ pois, onCoordsInfo }: MapContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // Keep a ref so init effect always sees latest pois
  const poisRef = useRef(pois);
  poisRef.current = pois;

  // ─── Init carte (once) ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    console.log('[MapContainer] Creating map (marker mode)');
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: RASTER_STYLE as any,
      center: [INITIAL_VIEWPORT.longitude, INITIAL_VIEWPORT.latitude],
      zoom: INITIAL_VIEWPORT.zoom,
    } as any);

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.on('error', e => console.error('[MapContainer] MapLibre error:', e.error));

    // Markers are DOM elements — they work before style is loaded
    renderMarkers(map, poisRef.current, markersRef);

    return () => {
      console.log('[MapContainer] Cleanup');
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Update markers when pois change ────────────────────────────
  useEffect(() => {
    const validCount = pois.filter(isValidPOI).length;
    onCoordsInfo?.(validCount, pois.length);
    console.log(`[MapContainer] pois update: ${pois.length} total, ${validCount} valid`);

    const map = mapRef.current;
    if (!map) return; // Map not yet created; will render on init

    renderMarkers(map, pois, markersRef);
  }, [pois, onCoordsInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#e8e8e8' }} />
  );
}
