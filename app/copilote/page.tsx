'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Link from 'next/link';

// =============================================================================
// Types
// =============================================================================

interface POI {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  categorie: string;
  sous_categorie?: string;
  adresse?: string;
  ville?: string;
}

interface ZoneData {
  ville: string;
  rayon_metres: number | null;
  rayon_poi_metres: number | null;
  coordonnees: { lat: number; lng: number };
  pois: POI[];
  nb_pois: number;
  categories: Record<string, number>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  zoneData?: ZoneData;
}

// =============================================================================
// Helpers
// =============================================================================

function circleGeoJSON(
  lng: number,
  lat: number,
  radiusM: number,
  steps = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
  const R = 6371000;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dx = radiusM * Math.cos(a);
    const dy = radiusM * Math.sin(a);
    const dLng = (dx / R) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);
    const dLat = (dy / R) * (180 / Math.PI);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

// Couleurs par catégorie (cohérent avec MapContainer.tsx)
const CATEGORY_COLORS: Record<string, string> = {
  lycee: '#6366f1',
  college: '#3b82f6',
  cirfa: '#ef4444',
  gare: '#10b981',
  sport: '#f59e0b',
  default: '#8b5cf6',
};

function getCatColor(cat: string): string {
  return CATEGORY_COLORS[cat?.toLowerCase()] || CATEGORY_COLORS.default;
}

// Même style CARTO Light que /map
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
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
  layers: [{ id: 'carto-bg', type: 'raster', source: 'carto' }],
};

// =============================================================================
// Composants
// =============================================================================

function ZoneCard({ zone }: { zone: ZoneData }) {
  const catEntries = Object.entries(zone.categories).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{
      background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
      borderRadius: 10, padding: '12px 14px', marginTop: 8,
      fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16 }}>📍</span>
        <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: 13 }}>{zone.ville}</span>
        {zone.rayon_metres && (
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
            zone {(zone.rayon_metres / 1000).toFixed(1)} km
          </span>
        )}
        {zone.rayon_poi_metres && (
          <span style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4, padding: '1px 6px', color: '#10b981', fontSize: 11 }}>
            ⊙ {zone.rayon_poi_metres >= 1000 ? `${(zone.rayon_poi_metres/1000).toFixed(1)} km` : `${zone.rayon_poi_metres} m`} / POI
          </span>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <Stat label="Établissements trouvés" value={String(zone.nb_pois)} color={zone.nb_pois > 0 ? '#3dffa0' : '#f59e0b'} />
      </div>

      {zone.nb_pois === 0 ? (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '7px 10px', color: '#f59e0b', fontSize: 11 }}>
          Aucun établissement dans ce rayon — essayez un rayon plus large
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {catEntries.map(([cat, count]) => (
            <span key={cat} style={{
              background: `${getCatColor(cat)}22`,
              border: `1px solid ${getCatColor(cat)}55`,
              borderRadius: 5, padding: '3px 7px',
              color: getCatColor(cat), fontSize: 11, fontWeight: 600,
            }}>
              {cat} · {count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '7px 10px' }}>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontWeight: 700, fontSize: 14 }}>{value}</div>
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 5, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px 14px 14px 14px' }}>
      {[0, 0.2, 0.4].map((d, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.4)', display: 'inline-block', animation: `bounce 1s ${d}s ease-in-out infinite` }} />
      ))}
    </div>
  );
}

// =============================================================================
// Page principale
// =============================================================================

export default function CopilotePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [zoneData, setZoneData] = useState<ZoneData | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carreaux layer
  const [carreauxVisible, setCarreauxVisible] = useState(false);
  const [carreauxLoaded, setCarreauxLoaded] = useState(false);
  const carreauxDataRef = useRef<GeoJSON.FeatureCollection | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Canvas overlay pour les cercles POI (plus fiable que les layers GeoJSON MapLibre)
  const canvasOverlayRef = useRef<HTMLCanvasElement | null>(null);
  // Ref pour accéder à zoneData depuis le callback map.on('render') sans closure stale
  const zoneDataRef = useRef<ZoneData | null>(null);

  // Sync ref ↔ state
  useEffect(() => {
    zoneDataRef.current = zoneData;
  }, [zoneData]);

  // ── Init MapLibre ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE as any,
      center: [2.3, 46.6],
      zoom: 5.5,
    });

    // Canvas overlay POI circles — inséré APRÈS le canvas MapLibre (avant les contrôles)
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1';
    mapContainerRef.current.appendChild(overlay);
    canvasOverlayRef.current = overlay;

    // Dessin des cercles POI à chaque frame (pan, zoom, données)
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
          // Rayon en pixels = rayon_metres / (mètres par pixel à ce zoom et cette latitude)
          const zoom = map.getZoom();
          const metersPerPx = (156543.03 * Math.cos(p.lat * Math.PI / 180)) / Math.pow(2, zoom);
          const rPx = rM / metersPerPx;
          if (rPx < 1) continue;

          const color = getCatColor(p.categorie);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, rPx, 0, 2 * Math.PI);
          ctx.fillStyle = color + '1e'; // ~12% opacité
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
      // Zone globale (autour de la ville)
      map.addSource('zone-circle', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zone-circle', paint: { 'fill-color': '#7c3aed', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'zone-outline', type: 'line', source: 'zone-circle', paint: { 'line-color': '#a78bfa', 'line-width': 2, 'line-dasharray': [4, 3] } });

      // Carreaux layer (empty initially)
      map.addSource('carreaux', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: 'carreaux-fill', type: 'fill', source: 'carreaux',
        paint: { 'fill-color': '#6baed6', 'fill-opacity': 0.35 },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'carreaux-line', type: 'line', source: 'carreaux',
        paint: { 'line-color': '#2171b5', 'line-width': 1, 'line-opacity': 0.6 },
        layout: { visibility: 'none' },
      });

      // Click popup for carreaux
      map.on('click', 'carreaux-fill', (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties as Record<string, unknown>;
        const commune = props.commune || props.libelle_iris || '—';
        const pop = props.population ?? '—';
        const html = `
          <div style="padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.5;max-width:220px">
            <b style="color:#1e40af">${commune}</b><br/>
            <span style="color:#64748b;font-size:11px">${props.libelle_iris || ''}</span>
            <div style="margin-top:4px">Pop: <b>${typeof pop === 'number' ? pop.toLocaleString('fr-FR') : pop}</b></div>
            ${props.departement ? `<span style="color:#94a3b8;font-size:11px">Dept. ${props.departement}</span>` : ''}
          </div>
        `;
        new maplibregl.Popup({ closeButton: true, maxWidth: '250px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map);
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

  // ── Mettre à jour la carte quand zoneData change ──────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !zoneData) return;

    const { lat, lng } = zoneData.coordonnees;

    // Nettoyer les anciens markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Cercle de zone globale (autour de la ville)
    (map.getSource('zone-circle') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: zoneData.rayon_metres
        ? [circleGeoJSON(lng, lat, zoneData.rayon_metres)]
        : [],
    });

    // Les cercles POI sont dessinés par map.on('render') via canvasOverlay
    // Forcer un repaint pour afficher immédiatement
    map.triggerRepaint();

    // Markers POI colorés par catégorie
    zoneData.pois.forEach((p) => {
      const color = getCatColor(p.categorie);

      const el = document.createElement('div');
      el.style.cssText = `width:10px;height:10px;background:${color};border:2px solid rgba(255,255,255,0.9);border-radius:50%;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4)`;

      const nom = (p.nom || 'POI').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
        `<div style="font-size:12px;padding:6px 8px">` +
        `<strong>${nom}</strong><br/>` +
        `<span style="color:${color};font-size:11px;font-weight:600;text-transform:uppercase">${p.categorie}</span>` +
        (p.sous_categorie ? ` <span style="color:#94a3b8;font-size:11px">· ${p.sous_categorie}</span>` : '') +
        (p.adresse ? `<br/><span style="color:#64748b;font-size:11px">📍 ${p.adresse}</span>` : '') +
        `</div>`
      );

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([p.lng, p.lat])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
    });

    // Marker ville (centre)
    const cityEl = document.createElement('div');
    cityEl.innerHTML = '📍';
    cityEl.style.cssText = 'font-size:24px;cursor:default;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
    const cityMarker = new maplibregl.Marker({ element: cityEl, anchor: 'bottom' })
      .setLngLat([lng, lat]).addTo(map);
    markersRef.current.push(cityMarker);

    const r = zoneData.rayon_metres;
    const rPoi = zoneData.rayon_poi_metres;

    // Zoom adapté selon le scope géographique
    let zoom: number;
    if (rPoi) {
      // Cercles POI : zoom en pour les voir
      zoom = rPoi < 300 ? 15 : rPoi < 800 ? 14 : rPoi < 2000 ? 13 : 12;
    } else if (r) {
      // Rayon autour de la ville
      zoom = r < 1500 ? 14 : r < 4000 ? 13 : 11;
    } else if (zoneData.pois.length > 1) {
      // Auto-fit : calculer le bounding box des POIs pour ajuster le zoom
      const lats = zoneData.pois.map(p => p.lat);
      const lngs = zoneData.pois.map(p => p.lng);
      const bounds = new maplibregl.LngLatBounds(
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)]
      );
      // fitBounds prend en charge le zoom automatiquement
      map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 1200 });
      return; // skip flyTo ci-dessous
    } else {
      zoom = 12;
    }

    map.flyTo({ center: [lng, lat], zoom, duration: 1200 });
  }, [zoneData, mapReady]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Toggle carreaux layer ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const vis = carreauxVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('carreaux-fill', 'visibility', vis);
      map.setLayoutProperty('carreaux-line', 'visibility', vis);
    } catch { /* layer not yet added */ }

    // Load data on first toggle
    if (carreauxVisible && !carreauxLoaded) {
      (async () => {
        try {
          // Get first carreaux source
          const listRes = await fetch('/api/carreaux');
          const listData = await listRes.json();
          if (!listData.sources || listData.sources.length === 0) return;

          const tableName = listData.sources[0].tableName;
          const gjRes = await fetch('/api/carreaux', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableName }),
          });
          const gjData = await gjRes.json();
          if (!gjData.features) return;

          carreauxDataRef.current = gjData as GeoJSON.FeatureCollection;
          setCarreauxLoaded(true);

          const source = map.getSource('carreaux') as maplibregl.GeoJSONSource | undefined;
          if (source) {
            source.setData(gjData as GeoJSON.FeatureCollection);

            // Simple choropleth — pick first numeric property (skip x, y, idcar)
            const skipKeys = new Set(['idcar', 'x', 'y', 'gml_id', 'objectid']);
            let choroKey = '';
            const sampleProps = (gjData.features[0]?.properties || {}) as Record<string, unknown>;
            for (const [k, v] of Object.entries(sampleProps)) {
              if (skipKeys.has(k)) continue;
              if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '')) {
                choroKey = k;
                break;
              }
            }
            if (choroKey) {
              const vals = gjData.features
                .map((f: GeoJSON.Feature) => Number((f.properties as Record<string, unknown>)?.[choroKey]))
                .filter((n: number) => !isNaN(n));
              const mn = Math.min(...vals);
              const mx = Math.max(...vals);
              if (mx > mn) {
                const step = (mx - mn) / 4;
                map.setPaintProperty('carreaux-fill', 'fill-color', [
                  'interpolate', ['linear'],
                  ['coalesce', ['to-number', ['get', choroKey], 0], 0],
                  mn, '#f7fbff',
                  mn + step, '#c6dbef',
                  mn + 2 * step, '#6baed6',
                  mn + 3 * step, '#2171b5',
                  mx, '#08306b',
                ] as unknown as maplibregl.ExpressionSpecification);
              }
              console.log(`[Copilote] Choropleth metric: ${choroKey} [${mn}..${mx}]`);
            }
          }
          console.log(`[Copilote] Carreaux loaded: ${gjData.features.length} features`);
        } catch (err) {
          console.error('[Copilote] carreaux error:', err);
        }
      })();
    }
  }, [carreauxVisible, carreauxLoaded, mapReady]);

  // ── Envoi du message ───────────────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.reply ?? '',
        zoneData: data.zoneData ?? undefined,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      if (data.zoneData) setZoneData(data.zoneData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Légende catégories (depuis les données affichées)
  const activeCats = zoneData
    ? Object.keys(zoneData.categories).sort()
    : [];

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', background: '#0a0a1a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Panneau CHAT ── */}
      <div style={{ width: 400, minWidth: 360, display: 'flex', flexDirection: 'column', background: '#0f0f23', borderRight: '1px solid rgba(255,255,255,0.08)' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/map" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 20, lineHeight: 1, fontWeight: 300 }}>←</Link>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>🤖</span>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Copilote Media</span>
              <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', background: 'rgba(124,58,237,0.3)', color: '#a78bfa', padding: '2px 6px', borderRadius: 4 }}>BETA</span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Mistral · function calling · poi_france</div>
          </div>
          {isLoading && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3dffa0', animation: 'pulse 1.2s ease-in-out infinite' }} />}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Accueil */}
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🗺️</div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Décrivez votre cible</div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
                Ex : <em>&ldquo;Lycées CSP+ à Lyon dans un rayon de 3km&rdquo;</em>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  'Lycées centre-ville de Bordeaux, 2km',
                  'Établissements scolaires Toulouse, large',
                  'Lycées et collèges Paris 8e, 1km',
                  'Zone établissements Nantes agglo',
                ].map((suggestion) => (
                  <button key={suggestion} onClick={() => sendMessage(suggestion)} style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, padding: '9px 12px', color: 'rgba(255,255,255,0.6)',
                    cursor: 'pointer', fontSize: 12, textAlign: 'left', transition: 'background 0.15s',
                  }}>
                    📍 {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Liste messages */}
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ maxWidth: '82%', background: '#7c3aed', color: '#fff', borderRadius: '14px 14px 4px 14px', padding: '10px 14px', fontSize: 13, lineHeight: 1.5 }}>
                    {msg.content}
                  </div>
                </div>
              )}

              {msg.role === 'assistant' && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(61,255,160,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, marginTop: 2 }}>🤖</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {msg.zoneData && <ZoneCard zone={msg.zoneData} />}
                    {msg.content && (
                      <div style={{ marginTop: msg.zoneData ? 10 : 0, background: 'rgba(255,255,255,0.05)', borderRadius: '4px 14px 14px 14px', padding: '10px 14px', fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 1.6 }}>
                        {msg.content}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {isLoading && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(61,255,160,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🤖</div>
              <TypingDots />
            </div>
          )}

          {/* Erreur */}
          {error && (
            <div style={{ background: 'rgba(255,87,87,0.1)', border: '1px solid rgba(255,87,87,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#ff5757', fontFamily: 'JetBrains Mono, monospace' }}>
              ⚠ Erreur : {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder="Décrivez votre cible : ville, type d'établissement, rayon…"
              rows={2}
              style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, lineHeight: 1.5, resize: 'none', outline: 'none', fontFamily: 'inherit' }}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              style={{ background: input.trim() && !isLoading ? '#7c3aed' : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10, padding: '10px 16px', color: input.trim() && !isLoading ? '#fff' : 'rgba(255,255,255,0.3)', cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed', fontSize: 18, lineHeight: 1, transition: 'background 0.2s', flexShrink: 0 }}
            >
              ↑
            </button>
          </form>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 8, textAlign: 'center' }}>
            Entrée pour envoyer · Shift+Entrée pour nouvelle ligne
          </div>
        </div>
      </div>

      {/* ── Panneau CARTE ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%', background: '#e8e8e8', position: 'relative' }} />

        {/* Badge zone active */}
        {zoneData && (
          <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', zIndex: 10 }}>
            <div style={{ color: '#4f46e5', fontWeight: 700, marginBottom: 2 }}>📍 {zoneData.ville}</div>
            <div style={{ color: '#64748b' }}>
              {zoneData.rayon_metres ? `rayon ${(zoneData.rayon_metres / 1000).toFixed(1)} km · ` : ''}{zoneData.nb_pois} établissements
            </div>
          </div>
        )}

        {/* Carreaux toggle */}
        <button
          onClick={() => setCarreauxVisible(v => !v)}
          title={carreauxVisible ? 'Masquer les carreaux' : 'Afficher les carreaux démographiques'}
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 6,
            background: carreauxVisible ? 'rgba(33,113,181,0.9)' : 'rgba(255,255,255,0.9)',
            border: `1px solid ${carreauxVisible ? '#2171b5' : 'rgba(0,0,0,0.15)'}`,
            borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            color: carreauxVisible ? '#fff' : '#64748b',
            backdropFilter: 'blur(4px)', transition: 'all 0.2s',
          }}
        >
          <span style={{
            width: 10, height: 10, borderRadius: 2,
            background: carreauxVisible ? '#fff' : '#6baed6',
            border: `1.5px solid ${carreauxVisible ? '#fff' : '#2171b5'}`,
            opacity: carreauxVisible ? 0.8 : 0.6,
          }} />
          Carreaux {carreauxLoaded ? '✓' : ''}
        </button>

        {/* Légende catégories */}
        {activeCats.length > 0 && (
          <div style={{ position: 'absolute', bottom: 48, left: 16, background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, padding: '8px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#64748b', zIndex: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {activeCats.map((cat) => (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: getCatColor(cat), border: '2px solid rgba(255,255,255,0.9)', flexShrink: 0 }} />
                <span>{cat} ({zoneData!.categories[cat]})</span>
              </div>
            ))}
            {zoneData!.rayon_metres && (
              <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(99,102,241,0.25)', borderRadius: 2, border: '1.5px dashed #6366f1', flexShrink: 0 }} />
                Zone {(zoneData!.rayon_metres / 1000).toFixed(1)} km
              </div>
            )}
            {zoneData!.rayon_poi_metres && (
              <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(16,185,129,0.15)', borderRadius: '50%', border: '1.5px solid #10b981', flexShrink: 0 }} />
                Rayon {zoneData!.rayon_poi_metres >= 1000 ? `${(zoneData!.rayon_poi_metres/1000).toFixed(1)} km` : `${zoneData!.rayon_poi_metres} m`} / POI
              </div>
            )}
          </div>
        )}

        {/* Légende par défaut (avant résultats) */}
        {activeCats.length === 0 && (
          <div style={{ position: 'absolute', bottom: 48, left: 16, background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, padding: '7px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#64748b', zIndex: 10 }}>
            <div style={{ color: '#94a3b8', fontSize: 10 }}>Décrivez une zone pour commencer</div>
          </div>
        )}
      </div>

      {/* Animations */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
        @keyframes bounce { 0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)} }
        .maplibregl-popup-content { background:#fff!important;border:none!important;padding:0!important;box-shadow:0 2px 8px rgba(0,0,0,0.15)!important;border-radius:8px!important; }
      `}</style>
    </div>
  );
}
