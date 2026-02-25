'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

// =============================================================================
// Types
// =============================================================================

interface Panneau {
  id: string;
  lat?: number;
  latitude?: number;
  lng?: number;
  longitude?: number;
  nom?: string;
  ville?: string;
  region?: string;
  format?: string;
  regie?: string;
  [key: string]: any;
}

interface MapIntegratedClientProps {
  panneaux: Panneau[];
  onBackToPrompt?: () => void;
}

// =============================================================================
// Helpers
// =============================================================================

function getLat(p: Panneau): number | null {
  return p.lat ?? p.latitude ?? null;
}

function getLng(p: Panneau): number | null {
  return p.lng ?? p.longitude ?? null;
}

function isValid(p: Panneau): boolean {
  return getLat(p) !== null && getLng(p) !== null;
}

function getRegieColor(regie: string | undefined): string {
  if (!regie) return '#f59e0b';
  const r = regie.toLowerCase();
  if (r.includes('multi')) return '#ef4444';
  if (r.includes('jcdecaux') || r.includes('décaux') || r.includes('decaux')) return '#3b82f6';
  if (r.includes('clear') || r.includes('clearchannel')) return '#10b981';
  return '#f59e0b';
}

/**
 * Fallback robuste pour le nom du panneau
 * panneaux_near_point ne retourne pas toujours "nom"
 */
function getPanelName(p: Panneau, index?: number): string {
  return (
    p.nom ||
    p.name ||
    p.adresse ||
    p.address ||
    p.nom_site ||
    `Panneau #${(index ?? 0) + 1}`
  );
}

/**
 * Convert panneaux array to GeoJSON FeatureCollection with ALL properties
 * (This was the critical bug - the old code only passed { cluster: false })
 */
function panneauxToGeoJSON(panneaux: Panneau[]) {
  return {
    type: 'FeatureCollection' as const,
    features: panneaux
      .filter(isValid)
      .map((p, i) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [getLng(p)!, getLat(p)!],
        },
        properties: {
          id: String(p.id || i),
          nom: getPanelName(p, i),
          ville: p.ville || '',
          region: p.region || '',
          format: p.format || '',
          regie: p.regie || '',
        },
      })),
  };
}

// =============================================================================
// Component
// =============================================================================

export default function MapIntegratedClient({
  panneaux,
  onBackToPrompt,
}: MapIntegratedClientProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const mglRef = useRef<any>(null); // Store maplibre-gl module
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const panelListRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Keep latest panneaux in a ref for event handlers (closures)
  const panneauxRef = useRef(panneaux);
  panneauxRef.current = panneaux;

  const validPanneaux = panneaux.filter(isValid);

  // =========================================================================
  // Initialize Map (runs once)
  // =========================================================================
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      if (!mapContainer.current) {
        setError('Container non trouvé');
        return;
      }

      try {
        // Dynamic import (SSR-safe)
        const mgl = await import('maplibre-gl');
        mglRef.current = mgl.default;

        if (!mounted || mapRef.current) return;

        // Create map with OSM tiles + glyphs for cluster labels
        const mapInstance = new mgl.default.Map({
          container: mapContainer.current,
          style: {
            version: 8,
            glyphs:
              'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
              osm: {
                type: 'raster',
                tiles: [
                  'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                  'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                  'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
                ],
                tileSize: 256,
                attribution: '© OpenStreetMap contributors',
              },
            },
            layers: [
              {
                id: 'osm',
                type: 'raster',
                source: 'osm',
              },
            ],
          } as any,
          center: [2.3, 46.6], // France center
          zoom: 5.5,
          attributionControl: { compact: true },
        });

        mapRef.current = mapInstance;

        // Navigation controls
        mapInstance.addControl(
          new mgl.default.NavigationControl(),
          'bottom-right'
        );

        // =====================================================================
        // On map load: add source, layers, and event handlers
        // =====================================================================
        mapInstance.on('load', () => {
          if (!mounted) return;

          const geojson = panneauxToGeoJSON(panneauxRef.current);

          // -----------------------------------------------------------------
          // Source: Native MapLibre clustering (NOT Supercluster)
          // -----------------------------------------------------------------
          mapInstance.addSource('panneaux', {
            type: 'geojson',
            data: geojson as any,
            cluster: true,
            clusterMaxZoom: 14,
            clusterRadius: 50,
          });

          // -----------------------------------------------------------------
          // Layer 1: Cluster circles
          // -----------------------------------------------------------------
          mapInstance.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'panneaux',
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': [
                'step',
                ['get', 'point_count'],
                '#3b82f6', // blue < 10
                10,
                '#f59e0b', // orange 10-50
                50,
                '#ef4444', // red > 50
              ],
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                18, // < 10
                10,
                25, // 10-50
                50,
                35, // > 50
              ],
              'circle-opacity': 0.85,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            },
          });

          // -----------------------------------------------------------------
          // Layer 2: Cluster count labels
          // -----------------------------------------------------------------
          mapInstance.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'panneaux',
            filter: ['has', 'point_count'],
            layout: {
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 13,
              'text-font': ['Open Sans Bold'],
            },
            paint: {
              'text-color': '#ffffff',
            },
          });

          // -----------------------------------------------------------------
          // Layer 3: Individual points - color by régie, size by format
          // -----------------------------------------------------------------
          mapInstance.addLayer({
            id: 'unclustered-point',
            type: 'circle',
            source: 'panneaux',
            filter: ['!', ['has', 'point_count']],
            paint: {
              'circle-color': [
                'match',
                ['get', 'regie'],
                'MULTI',
                '#ef4444',
                'JCDecaux',
                '#3b82f6',
                'Décaux',
                '#3b82f6',
                'Decaux',
                '#3b82f6',
                'ClearChannel',
                '#10b981',
                'Clear Channel',
                '#10b981',
                '#f59e0b', // default orange
              ],
              'circle-radius': [
                'match',
                ['get', 'format'],
                '4x3',
                10,
                '2m2',
                12,
                '2m²',
                12,
                'digital',
                14,
                'numérique',
                14,
                'abribus',
                8,
                'grand_format',
                16,
                'traditional',
                10,
                10, // default
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': 0.85,
            },
          });

          // -----------------------------------------------------------------
          // Interaction: Cluster click → zoom in
          // -----------------------------------------------------------------
          mapInstance.on('click', 'clusters', (e: any) => {
            const features = mapInstance.queryRenderedFeatures(e.point, {
              layers: ['clusters'],
            });
            if (!features.length) return;

            const clusterId = features[0].properties.cluster_id;
            const source = mapInstance.getSource('panneaux') as any;

            source.getClusterExpansionZoom(
              clusterId,
              (err: any, zoom: number) => {
                if (err) return;
                mapInstance.easeTo({
                  center: (features[0].geometry as any).coordinates,
                  zoom,
                  duration: 500,
                });
              }
            );
          });

          // -----------------------------------------------------------------
          // Interaction: Point click → popup + select in sidebar
          // -----------------------------------------------------------------
          mapInstance.on('click', 'unclustered-point', (e: any) => {
            const features = mapInstance.queryRenderedFeatures(e.point, {
              layers: ['unclustered-point'],
            });
            if (!features.length) return;

            const props = features[0].properties;
            const coords = (
              features[0].geometry as any
            ).coordinates.slice();

            // Select in sidebar
            setSelectedId(props.id);

            // Close existing popups
            document
              .querySelectorAll('.maplibregl-popup')
              .forEach((p) => p.remove());

            // Show popup
            if (mglRef.current) {
              new mglRef.current.Popup({ offset: 25, closeButton: true })
                .setLngLat(coords)
                .setHTML(
                  `<div style="padding:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#333;">
                    <p style="margin:0 0 6px;font-weight:bold;color:#000;font-size:14px;">${props.nom || 'Panneau'}</p>
                    <p style="margin:3px 0;color:#666;"><b>Ville:</b> ${props.ville || '-'}</p>
                    <p style="margin:3px 0;color:#666;"><b>Format:</b> ${props.format || '-'}</p>
                    <p style="margin:3px 0;color:#666;"><b>Régie:</b> ${props.regie || '-'}</p>
                  </div>`
                )
                .addTo(mapInstance);
            }
          });

          // -----------------------------------------------------------------
          // Cursor changes on hover
          // -----------------------------------------------------------------
          ['clusters', 'unclustered-point'].forEach((layer) => {
            mapInstance.on('mouseenter', layer, () => {
              mapInstance.getCanvas().style.cursor = 'pointer';
            });
            mapInstance.on('mouseleave', layer, () => {
              mapInstance.getCanvas().style.cursor = '';
            });
          });

          // -----------------------------------------------------------------
          // Fit bounds to data (zoom serré sur la zone, min 12)
          // -----------------------------------------------------------------
          const valid = panneauxRef.current.filter(isValid);
          if (valid.length > 0 && mglRef.current) {
            const bounds = new mglRef.current.LngLatBounds();
            valid.forEach((p: Panneau) =>
              bounds.extend([getLng(p)!, getLat(p)!])
            );
            if (!bounds.isEmpty()) {
              mapInstance.fitBounds(bounds, {
                padding: 60,
                maxZoom: 15,
                minZoom: 12,
                duration: 1000,
              });
            }
          }

          setMapReady(true);
        });
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error ? err.message : 'Erreur chargement carte'
          );
        }
      }
    };

    init();

    return () => {
      mounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // =========================================================================
  // Update source data when panneaux change
  // =========================================================================
  useEffect(() => {
    if (!mapRef.current || !mapReady || !mglRef.current) return;

    const source = mapRef.current.getSource('panneaux') as any;
    if (!source) return;

    source.setData(panneauxToGeoJSON(panneaux) as any);

    // Re-fit bounds to new data
    const valid = panneaux.filter(isValid);
    if (valid.length > 0) {
      const bounds = new mglRef.current.LngLatBounds();
      valid.forEach((p: Panneau) =>
        bounds.extend([getLng(p)!, getLat(p)!])
      );
      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds, {
          padding: 60,
          maxZoom: 15,
          minZoom: 12,
          duration: 1000,
        });
      }
    }
  }, [panneaux, mapReady]);

  // =========================================================================
  // Auto-scroll sidebar to selected panel
  // =========================================================================
  useEffect(() => {
    if (selectedId && panelListRefs.current[selectedId]) {
      panelListRefs.current[selectedId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedId]);

  // =========================================================================
  // Sidebar → Map: click panel in list → flyTo + popup
  // =========================================================================
  const handlePanelClick = useCallback(
    (panneau: Panneau, index?: number) => {
      setSelectedId(String(panneau.id));

      if (!mapRef.current || !mglRef.current) return;

      const lat = getLat(panneau);
      const lng = getLng(panneau);
      if (!lat || !lng) return;

      const displayName = getPanelName(panneau, index);

      // Close existing popups
      document
        .querySelectorAll('.maplibregl-popup')
        .forEach((p) => p.remove());

      // Fly to panel
      mapRef.current.easeTo({
        center: [lng, lat],
        zoom: 15,
        duration: 800,
      });

      // Show popup
      new mglRef.current.Popup({ offset: 25, closeButton: true })
        .setLngLat([lng, lat])
        .setHTML(
          `<div style="padding:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#333;">
            <p style="margin:0 0 6px;font-weight:bold;color:#000;font-size:14px;">${displayName}</p>
            <p style="margin:3px 0;color:#666;"><b>Ville:</b> ${panneau.ville || '-'}</p>
            <p style="margin:3px 0;color:#666;"><b>Format:</b> ${panneau.format || '-'}</p>
            <p style="margin:3px 0;color:#666;"><b>Régie:</b> ${panneau.regie || '-'}</p>
          </div>`
        )
        .addTo(mapRef.current);
    },
    []
  );

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div
      className="flex w-full"
      style={{ height: '100vh', backgroundColor: '#0a0a0a' }}
    >
      {/* ================================================================= */}
      {/* SIDEBAR (280px) */}
      {/* ================================================================= */}
      {!collapsed ? (
        <div
          className="flex flex-col h-full border-r border-slate-700 overflow-hidden flex-shrink-0"
          style={{ width: '280px', backgroundColor: '#1a1a1a' }}
        >
          {/* Header: Back button + Close */}
          <div
            className="border-b border-slate-700 p-4 flex items-center justify-between"
            style={{ backgroundColor: '#2d2d2d' }}
          >
            <button
              onClick={onBackToPrompt}
              className="text-sm font-semibold transition-colors flex items-center gap-1"
              style={{ color: '#3b82f6' }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = '#06b6d4')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = '#3b82f6')
              }
            >
              ← Nouveau prompt
            </button>
            <button
              onClick={() => setCollapsed(true)}
              className="text-slate-400 hover:text-white transition-colors text-lg"
              title="Réduire"
            >
              ✕
            </button>
          </div>

          {/* Stats */}
          <div
            className="px-4 py-3 text-xs border-b border-slate-700"
            style={{ backgroundColor: '#0a0a0a' }}
          >
            <p className="text-slate-300">
              <span
                className="font-semibold"
                style={{ color: '#3b82f6' }}
              >
                {validPanneaux.length}
              </span>{' '}
              panneaux affichés
            </p>
          </div>

          {/* Légende régie */}
          <div className="px-4 py-3 border-b border-slate-700 text-xs space-y-1.5">
            <p className="text-slate-500 font-semibold uppercase tracking-wider mb-2" style={{ fontSize: '10px' }}>
              Légende régie
            </p>
            {[
              { color: '#3b82f6', label: 'JCDecaux' },
              { color: '#10b981', label: 'Clear Channel' },
              { color: '#ef4444', label: 'MULTI' },
              { color: '#f59e0b', label: 'Autre' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-slate-300">{item.label}</span>
              </div>
            ))}
          </div>

          {/* Panel List (scrollable) */}
          <div className="flex-1 overflow-y-auto">
            {validPanneaux.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">
                Aucun panneau avec coordonnées
              </div>
            ) : (
              <div className="divide-y divide-slate-700/50">
                {validPanneaux.map((panneau, index) => {
                  const isSelected = selectedId === String(panneau.id);
                  return (
                    <button
                      key={panneau.id}
                      ref={(el) => {
                        if (el)
                          panelListRefs.current[String(panneau.id)] = el;
                      }}
                      onClick={() => handlePanelClick(panneau, index)}
                      className="w-full text-left px-4 py-3 transition-all text-sm cursor-pointer group"
                      style={{
                        borderLeft: isSelected
                          ? '4px solid #3b82f6'
                          : '4px solid transparent',
                        backgroundColor: isSelected
                          ? 'rgba(59, 130, 246, 0.1)'
                          : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected)
                          e.currentTarget.style.backgroundColor =
                            'rgba(255,255,255,0.05)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected)
                          e.currentTarget.style.backgroundColor =
                            'transparent';
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
                          style={{
                            backgroundColor: getRegieColor(panneau.regie),
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className="font-semibold transition-colors truncate"
                            style={{
                              color: isSelected ? '#3b82f6' : '#ffffff',
                            }}
                          >
                            {getPanelName(panneau, index)}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5 truncate">
                            {panneau.ville || '-'} •{' '}
                            {panneau.format || '-'} •{' '}
                            {panneau.regie || '-'}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Collapsed sidebar: toggle button */
        <button
          onClick={() => setCollapsed(false)}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-30 px-3 py-4 rounded-r-lg border border-l-0 border-slate-700 transition-colors"
          style={{ backgroundColor: '#1a1a1a' }}
          title="Ouvrir la liste"
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = '#2d2d2d')
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = '#1a1a1a')
          }
        >
          <span className="text-white text-lg">☰</span>
        </button>
      )}

      {/* ================================================================= */}
      {/* MAP (fills remaining width) */}
      {/* ================================================================= */}
      <div className="flex-1 relative">
        {/* Map container - ALWAYS rendered (critical for ref) */}
        <div
          ref={mapContainer}
          style={{ width: '100%', height: '100%' }}
        />

        {/* Error overlay */}
        {error && (
          <div
            className="absolute inset-0 flex items-center justify-center z-10"
            style={{ backgroundColor: 'rgba(10, 10, 10, 0.95)' }}
          >
            <div className="text-center">
              <p
                className="text-lg font-bold mb-2"
                style={{ color: '#ef4444' }}
              >
                ❌ Erreur
              </p>
              <p className="text-sm text-slate-400 mb-3">{error}</p>
              <code className="block text-xs px-4 py-2 rounded" style={{ backgroundColor: '#1a1a1a', color: '#cbd5e1' }}>
                npm install maplibre-gl --legacy-peer-deps
              </code>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {!mapReady && !error && (
          <div
            className="absolute inset-0 flex items-center justify-center z-10"
            style={{ backgroundColor: 'rgba(10, 10, 10, 0.9)' }}
          >
            <div className="text-center">
              <div
                className="w-10 h-10 rounded-full border-4 animate-spin mb-3 mx-auto"
                style={{
                  borderColor: '#334155',
                  borderTopColor: '#3b82f6',
                }}
              />
              <p className="text-slate-400 text-sm">
                Chargement de la carte...
              </p>
            </div>
          </div>
        )}

        {/* Selected panel info bar (top of map) */}
        {selectedId &&
          (() => {
            const panelIndex = validPanneaux.findIndex(
              (p) => String(p.id) === selectedId
            );
            const panel = panelIndex >= 0 ? validPanneaux[panelIndex] : null;
            if (!panel) return null;
            return (
              <div
                className="absolute top-4 left-4 right-4 z-10 px-4 py-3 rounded-lg border border-slate-700 flex items-center justify-between"
                style={{
                  backgroundColor: 'rgba(10, 10, 10, 0.85)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <div>
                  <p className="text-white font-semibold text-sm">
                    {getPanelName(panel, panelIndex)}
                  </p>
                  <p className="text-slate-400 text-xs">
                    {panel.ville || '-'} • {panel.format || '-'} •{' '}
                    {panel.regie || '-'}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="text-slate-400 hover:text-white transition-colors text-lg ml-4"
                >
                  ✕
                </button>
              </div>
            );
          })()}
      </div>
    </div>
  );
}
