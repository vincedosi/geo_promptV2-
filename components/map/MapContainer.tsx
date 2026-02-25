'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_STYLE, INITIAL_VIEWPORT } from '@/lib/map/config';

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
}

// Category color mapping
const CATEGORY_COLORS: Record<string, string> = {
  lycee: '#6366f1',
  college: '#3b82f6',
  cirfa: '#ef4444',
  gare: '#10b981',
  sport: '#f59e0b',
  default: '#8b5cf6',
};

function getCategoryColor(categorie: string): string {
  return CATEGORY_COLORS[categorie?.toLowerCase()] || CATEGORY_COLORS.default;
}

export default function MapContainer({ pois }: MapContainerProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  // Build GeoJSON from POIs
  const buildGeoJSON = useCallback((poiList: POI[]) => {
    return {
      type: 'FeatureCollection' as const,
      features: poiList
        .filter(p => p.lat && p.lng && !isNaN(p.lat) && !isNaN(p.lng))
        .map(p => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [p.lng, p.lat],
          },
          properties: {
            id: p.id,
            nom: p.nom || '',
            categorie: p.categorie || '',
            sous_categorie: p.sous_categorie || '',
            adresse: p.adresse || '',
            ville: p.ville || '',
            departement: p.departement || '',
            region: p.region || '',
            code_postal: p.code_postal || '',
            color: getCategoryColor(p.categorie),
          },
        })),
    };
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    try {
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: MAP_STYLE as any,
        center: [INITIAL_VIEWPORT.longitude, INITIAL_VIEWPORT.latitude],
        zoom: INITIAL_VIEWPORT.zoom,
        attributionControl: { compact: true },
      } as any);

      map.current.addControl(new maplibregl.NavigationControl(), 'bottom-right');
      map.current.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'bottom-right');

      map.current.on('style.load', () => {
        if (!map.current) return;

        // Add POI source
        map.current.addSource('pois', {
          type: 'geojson',
          data: buildGeoJSON(pois),
        });

        // POI circle layer
        map.current.addLayer({
          id: 'pois',
          type: 'circle',
          source: 'pois',
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              5, 4,
              8, 6,
              12, 10,
              16, 14,
            ],
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.85,
          },
        });

        // POI labels (visible at higher zoom)
        map.current.addLayer({
          id: 'poi-labels',
          type: 'symbol',
          source: 'pois',
          minzoom: 10,
          layout: {
            'text-field': ['get', 'nom'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-size': 11,
            'text-offset': [0, 1.5],
            'text-anchor': 'top',
            'text-max-width': 10,
          },
          paint: {
            'text-color': '#e2e8f0',
            'text-halo-color': '#0a0a0a',
            'text-halo-width': 1.5,
          },
        });

        // POI click handler — CRITICAL: pass e.point to get only clicked feature
        map.current.on('click', 'pois', (e) => {
          e.originalEvent.stopPropagation();

          const features = map.current?.queryRenderedFeatures(e.point, { layers: ['pois'] });
          if (!features || features.length === 0) return;

          const feature = features[0];
          if (feature.geometry.type !== 'Point') return;
          const lngLat = feature.geometry.coordinates;
          const props = feature.properties;

          // Close existing popup
          if (popupRef.current) {
            popupRef.current.remove();
            popupRef.current = null;
          }

          popupRef.current = new maplibregl.Popup({
            closeButton: true,
            closeOnClick: true,
            maxWidth: '320px',
          })
            .setLngLat([lngLat[0], lngLat[1]])
            .setHTML(getPoiPopupHTML(props))
            .addTo(map.current!);
        });

        // Cursor
        map.current.on('mouseenter', 'pois', () => {
          if (map.current) map.current.getCanvas().style.cursor = 'pointer';
        });
        map.current.on('mouseleave', 'pois', () => {
          if (map.current) map.current.getCanvas().style.cursor = '';
        });

        setIsMapReady(true);
      });
    } catch (error) {
      console.error('[MapContainer] Error initializing map:', error);
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Update POI data when pois prop changes
  useEffect(() => {
    if (!map.current || !isMapReady) return;

    const source = map.current.getSource('pois');
    if (source && 'setData' in source) {
      (source as any).setData(buildGeoJSON(pois));
    }
  }, [pois, isMapReady, buildGeoJSON]);

  return (
    <div
      ref={mapContainer}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0a0a0a',
      }}
    />
  );
}

/** Generate popup HTML for a POI */
function getPoiPopupHTML(props: any): string {
  const catColor = getCategoryColor(props.categorie);
  return `
    <div style="padding: 12px; font-family: Inter, -apple-system, sans-serif; font-size: 13px; color: #1e293b; max-width: 280px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${catColor};"></span>
        <strong style="font-size: 14px; color: #0f172a;">${props.nom || 'POI'}</strong>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
        <span style="background: ${catColor}22; color: ${catColor}; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase;">
          ${props.categorie || '-'}
        </span>
        ${props.sous_categorie ? `<span style="background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 12px; font-size: 11px;">${props.sous_categorie}</span>` : ''}
      </div>
      ${props.adresse ? `<p style="margin: 4px 0; color: #475569; font-size: 12px;">📍 ${props.adresse}</p>` : ''}
      ${props.ville ? `<p style="margin: 4px 0; color: #475569; font-size: 12px;">🏙️ ${props.ville}${props.code_postal ? ' (' + props.code_postal + ')' : ''}</p>` : ''}
      ${props.departement ? `<p style="margin: 4px 0; color: #475569; font-size: 12px;">📋 ${props.departement}${props.region ? ' • ' + props.region : ''}</p>` : ''}
    </div>
  `;
}
