'use client';

import { useEffect, useRef, useState } from 'react';

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

export default function MaplibreMapClient({ panneaux }: { panneaux: Panneau[] }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const [maplibreLoaded, setMaplibreLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeMap = async () => {
      try {
        if (!mapContainer.current) {
          console.error('[MaplibreMapClient] ❌ Container non trouvé');
          setError('Container non trouvé');
          return;
        }

        console.log('[MaplibreMapClient] ✅ Container trouvé');

        // Charger maplibre-gl dynamiquement
        console.log('[MaplibreMapClient] Chargement de maplibre-gl...');
        const maplibregl = await import('maplibre-gl');
        console.log('[MaplibreMapClient] ✅ maplibre-gl chargé');

        if (map.current) {
          console.log('[MaplibreMapClient] Carte déjà initialisée, abandon');
          return;
        }

        // Style avec tuiles OpenStreetMap
        const style = {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
            },
          },
          layers: [
            {
              id: 'osm',
              type: 'raster',
              source: 'osm',
            },
          ],
        };

        console.log('[MaplibreMapClient] Initialisation de la carte...');

        // Initialiser la carte
        map.current = new maplibregl.default.Map({
          container: mapContainer.current,
          style: style as any,
          center: [2.3522, 48.8566],
          zoom: 9,
        });

        // Ajouter les markers et popups
        const addMarkers = () => {
          if (!map.current) return;

          panneaux.forEach((panneau, index) => {
            const lat = panneau.lat || panneau.latitude;
            const lng = panneau.lng || panneau.longitude;

            if (!lat || !lng) {
              console.warn(`[MaplibreMapClient] Panneau ${index} sans coordonnées`);
              return;
            }

            const popupHTML = `
              <div style="padding: 10px; font-family: sans-serif; font-size: 13px; color: #333;">
                <p style="margin: 0 0 6px 0; font-weight: bold; color: #000;">${panneau.nom || 'Panneau'}</p>
                <p style="margin: 3px 0; color: #666;"><strong>Régie:</strong> ${panneau.regie || '-'}</p>
                <p style="margin: 3px 0; color: #666;"><strong>Format:</strong> ${panneau.format || '-'}</p>
                <p style="margin: 3px 0; color: #666;"><strong>Ville:</strong> ${panneau.ville || '-'}</p>
              </div>
            `;

            const popup = new maplibregl.default.Popup({
              offset: 25,
              closeButton: true,
              closeOnClick: false,
            }).setHTML(popupHTML);

            new maplibregl.default.Marker({ color: '#ef4444' })
              .setLngLat([lng, lat])
              .setPopup(popup)
              .addTo(map.current);
          });

          console.log(`[MaplibreMapClient] ✅ ${panneaux.length} markers ajoutés`);
        };

        // FitBounds si panneaux présents
        const fitToBounds = () => {
          if (!map.current) return;

          if (panneaux.length === 0) {
            console.log('[MaplibreMapClient] Aucun panneau, centrage sur Paris');
            return;
          }

          const bounds = new maplibregl.default.LngLatBounds();
          let hasValidBounds = false;

          panneaux.forEach((panneau) => {
            const lat = panneau.lat || panneau.latitude;
            const lng = panneau.lng || panneau.longitude;
            if (lat && lng) {
              bounds.extend([lng, lat]);
              hasValidBounds = true;
            }
          });

          if (hasValidBounds && !bounds.isEmpty()) {
            console.log('[MaplibreMapClient] Centrage automatique sur les résultats');
            map.current.fitBounds(bounds, { padding: 50, duration: 1000 });
          }
        };

        // Attendre que la carte soit chargée
        const onMapLoad = () => {
          console.log('[MaplibreMapClient] ✅ Carte chargée, ajout des markers...');
          addMarkers();
          fitToBounds();
        };

        if (map.current.loaded()) {
          onMapLoad();
        } else {
          map.current.on('load', onMapLoad);
        }

        setMaplibreLoaded(true);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Maplibre-gl n\'est pas installé';
        console.error('[MaplibreMapClient] ❌ Erreur:', errorMessage);
        setError(errorMessage);
      }
    };

    initializeMap();
  }, [panneaux]);

  // ⭐ TOUJOURS rendre le div avec le ref + overlay conditionnel par dessus
  return (
    <div style={{ position: 'relative', width: '100%', height: '500px' }}>
      {/* Le container de la carte - TOUJOURS rendu pour que le ref existe */}
      <div
        ref={mapContainer}
        style={{
          width: '100%',
          height: '500px',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid #475569',
        }}
      />

      {/* Overlay d'erreur */}
      {error && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            borderRadius: '8px',
            border: '1px solid #ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.95)',
            flexDirection: 'column',
            gap: '12px',
            zIndex: 10,
          }}
        >
          <div style={{ textAlign: 'center', color: '#fca5a5' }}>
            <p style={{ marginBottom: '8px', fontSize: '16px', fontWeight: 'bold' }}>
              ❌ Erreur: {error}
            </p>
            <code
              style={{
                background: '#0f172a',
                padding: '8px',
                borderRadius: '4px',
                display: 'block',
                marginTop: '8px',
                fontSize: '12px',
                color: '#e0e7ff',
              }}
            >
              npm install maplibre-gl --legacy-peer-deps
            </code>
          </div>
        </div>
      )}

      {/* Overlay de chargement */}
      {!maplibreLoaded && !error && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.9)',
            zIndex: 10,
          }}
        >
          <p style={{ color: '#cbd5e1', fontSize: '14px' }}>Chargement de la carte...</p>
        </div>
      )}
    </div>
  );
}
