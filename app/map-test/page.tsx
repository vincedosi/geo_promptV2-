'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const MIN_ZOOM_CARREAUX = 10;
const VIVID_COLORS = ['#00BFFF', '#00E676', '#FFEB3B', '#FF6D00', '#B71C1C'];

function computeMinMax(features: GeoJSON.Feature[], metric: string): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const f of features) {
    const v = Number((f.properties as Record<string, unknown>)?.[metric]);
    if (!isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
  }
  return min === Infinity ? [0, 1] : [min, max];
}

function extractNumericFields(features: GeoJSON.Feature[]): string[] {
  const EXCLUDE = new Set(['x', 'y', 'objectid', 'gml_id', 'idcar']);
  const numSet = new Set<string>();
  for (const f of features.slice(0, 5)) {
    const props = (f.properties || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(props)) {
      if (EXCLUDE.has(k.toLowerCase())) continue;
      if (typeof v === 'number' && !isNaN(v)) { numSet.add(k); continue; }
      if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) numSet.add(k);
    }
  }
  return [...numSet].sort();
}

// Style MapLibre : OSM en fond + couche carreaux par-dessus
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 1 } },
  ],
};

export default function MapTestPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [sources, setSources] = useState<{ tableName: string; name: string; count: number }[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [features, setFeatures] = useState<GeoJSON.Feature[]>([]);
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [metric, setMetric] = useState('');
  const [knownFields, setKnownFields] = useState<string[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [renderedCount, setRenderedCount] = useState(0);
  const [zoom, setZoom] = useState(5.5);
  const [logs, setLogs] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [queryMs, setQueryMs] = useState(0);
  const [showBasemap, setShowBasemap] = useState(true);
  const [showCarreaux, setShowCarreaux] = useState(true);
  const [rpcMissing, setRpcMissing] = useState(false);
  const [rpcSql, setRpcSql] = useState('');
  const [dataCenter, setDataCenter] = useState<{ lng: number; lat: number } | null>(null);

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('fr-FR', { hour12: false });
    setLogs(prev => [...prev.slice(-80), `[${ts}] ${msg}`]);
    console.log(`[MapTest] ${msg}`);
  };

  // ─── Pre-charger les champs disponibles dès qu'une table est sélectionnée ──
  // (indépendant du zoom — on récupère juste 3 features pour connaître les colonnes)
  useEffect(() => {
    if (!selectedTable) return;
    setFieldsLoading(true);
    addLog(`🔍 Découverte des champs pour "${selectedTable}"...`);
    fetch('/api/carreaux', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName: selectedTable, limit: 3 }),
    })
      .then(r => r.json())
      .then(data => {
        const fs: GeoJSON.Feature[] = data.features || [];
        const fields = extractNumericFields(fs);
        if (fields.length > 0) {
          setKnownFields(fields);
          setMetric(prev => (fields.includes(prev) ? prev : fields[0]));
          addLog(`✅ ${fields.length} indicateurs disponibles : ${fields.slice(0, 6).join(', ')}${fields.length > 6 ? '...' : ''}`);
        } else {
          addLog('⚠️ Aucun champ numérique trouvé dans les 3 premières features');
        }
        // Extraire le centre géographique des features échantillon
        // → permet au bouton "Localiser" de zoomer là où sont les données
        const centers = fs.flatMap(f => {
          if (!f.geometry || f.geometry.type !== 'Polygon') return [];
          const coords = (f.geometry as GeoJSON.Polygon).coordinates[0];
          const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
          const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
          return [[lng, lat]];
        });
        if (centers.length > 0) {
          const lng = centers.reduce((s, c) => s + c[0], 0) / centers.length;
          const lat = centers.reduce((s, c) => s + c[1], 0) / centers.length;
          setDataCenter({ lng, lat });
          addLog(`📍 Données localisées vers [${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E] — localisation automatique...`);
          // Auto-fly vers les données dès qu'on connaît leur position
          const map = mapRef.current;
          if (map) {
            map.flyTo({ center: [lng, lat], zoom: 12, duration: 1500 });
          }
        }
      })
      .catch(err => addLog(`❌ Découverte champs: ${err.message}`))
      .finally(() => setFieldsLoading(false));
  }, [selectedTable]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Mise à jour de numericFields depuis les features chargées ──
  const numericFields = useMemo(() => extractNumericFields(features), [features]);
  useEffect(() => {
    if (numericFields.length > 0) {
      setKnownFields(numericFields);
      if (!numericFields.includes(metric)) setMetric(numericFields[0]);
    }
  }, [numericFields]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Toggle basemap visibility ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try { map.setLayoutProperty('osm', 'visibility', showBasemap ? 'visible' : 'none'); } catch {}
  }, [showBasemap, mapReady]);

  // ─── Fetch carreaux pour le viewport actuel (bbox) ──────────────
  const fetchForViewport = useCallback((table: string, map: maplibregl.Map) => {
    const currentZoom = map.getZoom();
    if (currentZoom < MIN_ZOOM_CARREAUX) {
      addLog(`⏭ Zoom ${currentZoom.toFixed(1)} < ${MIN_ZOOM_CARREAUX} — zoom insuffisant pour les carreaux 200m`);
      setFeatures([]);
      setTruncated(false);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];

    setLoading(true);
    const t0 = performance.now();
    addLog(`📦 Chargement bbox zoom=${currentZoom.toFixed(1)}...`);

    fetch('/api/carreaux', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName: table, bbox, limit: 15000 }),
      signal: controller.signal,
    })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        // ── RPC manquante : signaler clairement ──
        if (data._meta?.rpcMissing) {
          addLog('❌ Fonction SQL get_carreaux_bbox manquante dans Supabase — voir bannière');
          setRpcMissing(true);
          setRpcSql(data._meta.sql || '');
          setFeatures([]);
          return;
        }
        setRpcMissing(false);
        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        const count = data.features?.length ?? 0;
        const isTruncated = data._meta?.truncated ?? false;
        const serverMs = data._meta?.queryMs ?? '?';
        if (count === 0) {
          addLog(`⚠ 0 carreaux dans ce viewport (${serverMs}ms) — cliquez "📍 Localiser" pour aller là où sont les données`);
        } else {
          addLog(`✅ ${count} carreaux en ${elapsed}s (serveur: ${serverMs}ms)${isTruncated ? ' ⚠ TRONQUÉ' : ''}`);
        }
        setFeatures(data.features || []);
        setTruncated(isTruncated);
        setQueryMs(typeof serverMs === 'number' ? serverMs : 0);
      })
      .catch(err => { if (err.name !== 'AbortError') addLog(`❌ ${err.message}`); })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleViewportFetch = useCallback((table: string, map: maplibregl.Map) => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => fetchForViewport(table, map), 300);
  }, [fetchForViewport]);

  // ─── 1. Charger les sources disponibles ─────────────────────────
  useEffect(() => {
    fetch('/api/carreaux')
      .then(r => r.json())
      .then(data => {
        if (data.sources) {
          setSources(data.sources);
          addLog(`${data.sources.length} source(s) disponible(s)`);
          if (data.sources.length > 0) setSelectedTable(data.sources[0].tableName);
        }
      })
      .catch(err => addLog(`❌ Sources: ${err.message}`));
  }, []);

  // ─── 2. Init MapLibre avec fond OSM ─────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    addLog('Initialisation MapLibre + OpenStreetMap...');
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [2.3, 46.6],
      zoom: 5.5,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
    // Mise à jour zoom seulement après fin du mouvement (évite re-renders sur chaque frame)
    map.on('moveend', () => setZoom(map.getZoom()));
    map.on('error', (e) => addLog(`❌ MapLibre: ${e.error?.message || JSON.stringify(e)}`));

    map.on('load', () => {
      addLog('✅ Carte chargée (OSM)');

      // Source carreaux Supabase
      map.addSource('carreaux', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'carreaux-fill',
        type: 'fill',
        source: 'carreaux',
        paint: { 'fill-color': '#FF0000', 'fill-opacity': 0.75 },
      });
      map.addLayer({
        id: 'carreaux-line',
        type: 'line',
        source: 'carreaux',
        paint: { 'line-color': '#222', 'line-width': 0.8, 'line-opacity': 0.6 },
      });

      addLog('✅ Couche carreaux prête');
      map.resize(); // force recalcul des dimensions du conteneur flex
      setMapReady(true);
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ─── 3. Viewport-based loading : moveend → fetch bbox ───────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedTable) return;

    const handleMoveEnd = () => scheduleViewportFetch(selectedTable, map);
    map.on('moveend', handleMoveEnd);
    fetchForViewport(selectedTable, map);

    return () => {
      map.off('moveend', handleMoveEnd);
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [mapReady, selectedTable, scheduleViewportFetch, fetchForViewport]);

  // ─── 4. Mettre à jour la couche carreaux sur la carte ───────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource('carreaux') as maplibregl.GeoJSONSource;
    if (!source) return;

    const visible = showCarreaux && features.length > 0;

    if (!visible) {
      source.setData({ type: 'FeatureCollection', features: [] });
      setRenderedCount(0);
      map.setLayoutProperty('carreaux-fill', 'visibility', 'none');
      map.setLayoutProperty('carreaux-line', 'visibility', 'none');
    } else {
      source.setData({ type: 'FeatureCollection', features });

      // Choroplèthe par interpolation linéaire
      if (metric) {
        const [mn, mx] = computeMinMax(features, metric);
        // Cellules à valeur 0 = données supprimées (confidentialité INSEE) → transparentes
        map.setPaintProperty('carreaux-fill', 'fill-opacity', [
          'case',
          ['>', ['coalesce', ['to-number', ['get', metric], 0], 0], 0],
          0.75,
          0,
        ] as any);
        if (mn < mx) {
          // Interpolation sur les valeurs > 0 uniquement (évite le jaune/blanc sur fond clair)
          const posMin = mn > 0 ? mn : (mx / VIVID_COLORS.length);
          const step = (mx - posMin) / (VIVID_COLORS.length - 1);
          const stops: (number | string)[] = [];
          VIVID_COLORS.forEach((c, i) => stops.push(posMin + i * step, c));
          try {
            map.setPaintProperty('carreaux-fill', 'fill-color',
              ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', metric], 0], 0], ...stops] as any);
          } catch {
            map.setPaintProperty('carreaux-fill', 'fill-color', '#00BFFF');
          }
        } else {
          map.setPaintProperty('carreaux-fill', 'fill-color', '#00BFFF');
        }
      }

      map.setLayoutProperty('carreaux-fill', 'visibility', 'visible');
      map.setLayoutProperty('carreaux-line', 'visibility', 'visible');
      try { map.moveLayer('carreaux-fill'); map.moveLayer('carreaux-line'); } catch {}
    }

    map.triggerRepaint();

    const t = setTimeout(() => {
      if (!mapRef.current) return;
      try {
        const r = mapRef.current.queryRenderedFeatures(undefined as any, { layers: ['carreaux-fill'] });
        setRenderedCount(r.length);
      } catch {}
    }, 1500);
    return () => clearTimeout(t);
  }, [features, metric, mapReady, showCarreaux]);

  const zoomTooLow = zoom < MIN_ZOOM_CARREAUX;

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#0d1117' }}>

      {/* ── Sidebar ── */}
      <div style={{
        width: 300, background: '#161b22', color: '#e6edf3',
        padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14,
        fontSize: 13, borderRight: '1px solid #30363d', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#3fb950' }}>GENESIS</div>
          <div style={{ fontSize: 11, color: '#8b949e' }}>Carreaux Viewer — map-test</div>
        </div>

        {/* ── Affichage ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1 }}>Affichage</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={showBasemap} onChange={e => setShowBasemap(e.target.checked)}
              style={{ accentColor: '#3b82f6', width: 15, height: 15 }} />
            <span style={{ fontSize: 12 }}>Fond OpenStreetMap</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={showCarreaux} onChange={e => setShowCarreaux(e.target.checked)}
              style={{ accentColor: '#ff6600', width: 15, height: 15 }} />
            <span style={{ fontSize: 12 }}>Carreaux INSEE</span>
          </label>
        </div>

        <div style={{ borderTop: '1px solid #21262d' }} />

        {/* ── Source ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1 }}>Source de données</div>
          {sources.length === 0 ? (
            <div style={{ fontSize: 11, color: '#484f58', padding: '6px 8px', background: '#0d1117', borderRadius: 4 }}>
              Aucune source disponible
            </div>
          ) : (
            <select value={selectedTable || ''} onChange={(e) => setSelectedTable(e.target.value)}
              style={{ padding: '7px 10px', background: '#0d1117', color: '#e6edf3', border: '1px solid #30363d', borderRadius: 6, fontSize: 12 }}>
              {sources.map(s => (
                <option key={s.tableName} value={s.tableName}>
                  {s.name} ({s.count.toLocaleString('fr-FR')} carreaux)
                </option>
              ))}
            </select>
          )}
          {/* Boutons de navigation carte */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {/* Vue France entière */}
            <button
              onClick={() => {
                const map = mapRef.current;
                if (!map) return;
                map.flyTo({ center: [2.3, 46.6], zoom: 5.5, duration: 1200 });
                addLog('🗺 Vue France entière');
              }}
              style={{
                width: '100%', padding: '8px 10px', fontSize: 12, fontWeight: 600,
                background: '#161b22', color: '#8b949e',
                border: '1px solid #30363d',
                borderRadius: 6, cursor: 'pointer', textAlign: 'left',
              }}
            >
              🗺 Vue France entière
            </button>
            {/* Localiser les données */}
            {dataCenter && (
              <button
                onClick={() => {
                  const map = mapRef.current;
                  if (!map) return;
                  map.flyTo({ center: [dataCenter.lng, dataCenter.lat], zoom: 12, duration: 1500 });
                  addLog(`📍 Navigation vers [${dataCenter.lat.toFixed(3)}°N, ${dataCenter.lng.toFixed(3)}°E]`);
                }}
                style={{
                  width: '100%', padding: '8px 10px', fontSize: 12, fontWeight: 600,
                  background: features.length === 0 && !zoomTooLow ? 'rgba(59,130,246,0.2)' : '#161b22',
                  color: features.length === 0 && !zoomTooLow ? '#58a6ff' : '#8b949e',
                  border: `1px solid ${features.length === 0 && !zoomTooLow ? '#1d4ed8' : '#30363d'}`,
                  borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                }}
              >
                📍 Localiser les données {dataCenter ? `(${dataCenter.lat.toFixed(1)}°N)` : ''}
              </button>
            )}
          </div>
        </div>

        {/* ── Diagnostic données ── */}
        {selectedTable && (
          <button
            onClick={() => {
              addLog('🔬 Diagnostic : comptage réel en base...');
              // 1. Compte réel depuis la vraie table
              fetch(`/api/carreaux?table=${encodeURIComponent(selectedTable)}`)
                .then(r => r.json())
                .then(stats => {
                  const realCount = stats.realCount ?? 0;
                  addLog(`📊 Supabase — table "${selectedTable}" : ${realCount.toLocaleString('fr-FR')} lignes réelles en base`);
                  if (realCount === 0) {
                    addLog('❌ Table vide ! Relancez l\'import depuis /admin/carreaux-import');
                    return;
                  }
                  // 2. Bbox France complète pour vérifier la distribution géographique
                  addLog('🔬 Vérification de la distribution géographique...');
                  fetch('/api/carreaux', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tableName: selectedTable, bbox: [-5.5, 41.0, 10.0, 51.5], limit: 100 }),
                  })
                    .then(r => r.json())
                    .then(data => {
                      const found = data.features?.length ?? 0;
                      const serverMs = data._meta?.queryMs ?? '?';
                      if (data._meta?.rpcMissing) {
                        addLog('❌ Fonction get_carreaux_bbox manquante — voir bannière rouge');
                      } else if (found === 0) {
                        addLog(`❌ Géographie (${serverMs}ms) : 0 trouvés en France sur ${realCount.toLocaleString('fr-FR')} lignes → geom nulle ou mauvais SRID`);
                        addLog('💡 Vérifiez dans Supabase : SELECT ST_SRID(geom) FROM ' + selectedTable + ' LIMIT 1');
                      } else {
                        addLog(`✅ Géographie (${serverMs}ms) : ${found} carreaux visibles en France / ${realCount.toLocaleString('fr-FR')} total`);
                        if (found < realCount * 0.01) {
                          addLog(`⚠ Seulement ${found}/${realCount.toLocaleString('fr-FR')} visible → données concentrées dans une petite zone`);
                        }
                        if (features.length === 0 && data.features?.[0]?.geometry) {
                          const coords = (data.features[0].geometry as GeoJSON.Polygon).coordinates[0];
                          const lng = coords.reduce((s: number, c: number[]) => s + c[0], 0) / coords.length;
                          const lat = coords.reduce((s: number, c: number[]) => s + c[1], 0) / coords.length;
                          mapRef.current?.flyTo({ center: [lng, lat], zoom: 12, duration: 1500 });
                          addLog('📍 Navigation automatique vers les données');
                        }
                      }
                    })
                    .catch(err => addLog(`❌ Bbox France: ${err.message}`));
                })
                .catch(err => addLog(`❌ Comptage: ${err.message}`));
            }}
            style={{
              width: '100%', padding: '7px 10px', fontSize: 11, fontWeight: 500,
              background: 'rgba(245,158,11,0.1)', color: '#f59e0b',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 6, cursor: 'pointer', textAlign: 'left',
            }}
          >
            🔬 Diagnostiquer les données
          </button>
        )}

        {/* ── Indicateur — TOUJOURS VISIBLE ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1 }}>
            Indicateur {knownFields.length > 0 ? `(${knownFields.length})` : ''}
          </div>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            disabled={knownFields.length === 0}
            style={{
              padding: '7px 10px', background: '#0d1117', borderRadius: 6, fontSize: 12,
              color: knownFields.length === 0 ? '#484f58' : '#e6edf3',
              border: `1px solid ${knownFields.length === 0 ? '#21262d' : '#30363d'}`,
              cursor: knownFields.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {knownFields.length === 0
              ? <option value="">{fieldsLoading ? 'Chargement des indicateurs...' : 'Sélectionnez une source'}</option>
              : knownFields.map(f => <option key={f} value={f}>{f}</option>)
            }
          </select>
          {knownFields.length > 0 && features.length > 0 && metric && (() => {
            const [mn, mx] = computeMinMax(features, metric);
            return (
              <div style={{ fontSize: 10, color: '#8b949e', fontFamily: 'monospace' }}>
                min: {mn.toFixed(1)} — max: {mx.toFixed(1)}
              </div>
            );
          })()}
          {/* Légende couleur */}
          {knownFields.length > 0 && (
            <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>
              {VIVID_COLORS.map((c, i) => (
                <div key={i} style={{ flex: 1, height: 6, background: c, borderRadius: i === 0 ? '3px 0 0 3px' : i === VIVID_COLORS.length - 1 ? '0 3px 3px 0' : 0 }} />
              ))}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid #21262d' }} />

        {/* ── Statut ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1 }}>Statut</div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#8b949e' }}>Zoom</span>
            <span style={{
              fontWeight: 700, fontFamily: 'monospace',
              color: zoomTooLow ? '#f59e0b' : '#3fb950',
            }}>
              {zoom.toFixed(1)} {zoomTooLow ? `(min ${MIN_ZOOM_CARREAUX})` : ''}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#8b949e' }}>Carreaux chargés</span>
            <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#58a6ff' }}>
              {loading ? '...' : features.length.toLocaleString('fr-FR')}
              {truncated && <span style={{ color: '#f59e0b' }}> ⚠</span>}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#8b949e' }}>Affichés</span>
            <span style={{ fontWeight: 700, fontFamily: 'monospace', color: renderedCount > 0 ? '#3fb950' : '#484f58' }}>
              {renderedCount.toLocaleString('fr-FR')}
            </span>
          </div>

          {queryMs > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#8b949e' }}>Requête</span>
              <span style={{ fontFamily: 'monospace', color: queryMs < 500 ? '#3fb950' : queryMs < 2000 ? '#f59e0b' : '#f85149' }}>{queryMs}ms</span>
            </div>
          )}

          {zoomTooLow && (
            <div style={{ marginTop: 4, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, fontSize: 11, color: '#f59e0b' }}>
              Les carreaux 200m nécessitent un zoom ≥ {MIN_ZOOM_CARREAUX}.<br />
              Zoomez sur votre zone d'intérêt.
            </div>
          )}

          {truncated && !zoomTooLow && (
            <div style={{ marginTop: 4, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, fontSize: 11, color: '#f59e0b' }}>
              Limite 15 000 carreaux atteinte — zoomez davantage
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid #21262d' }} />

        {/* ── Logs ── */}
        <div style={{ flex: 1, minHeight: 160 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Logs ({logs.length})
          </div>
          <div style={{
            background: '#0d1117', borderRadius: 6, padding: '8px 10px',
            fontFamily: 'monospace', fontSize: 10, lineHeight: 1.6,
            color: '#8b949e', overflowY: 'auto', maxHeight: 280,
          }}>
            {logs.length === 0
              ? <span style={{ color: '#30363d' }}>// en attente...</span>
              : logs.map((l, i) => (
                <div key={i} style={{
                  color: l.includes('❌') ? '#f85149' : l.includes('✅') ? '#3fb950' : l.includes('📦') || l.includes('🔍') ? '#58a6ff' : l.includes('⚠') ? '#f59e0b' : '#8b949e',
                }}>{l}</div>
              ))
            }
          </div>
        </div>
      </div>

      {/* ── Carte ── */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>

        {/* Bannière RPC manquante */}
        {rpcMissing && (
          <div style={{
            background: '#3d0000', borderBottom: '2px solid #f85149',
            color: '#ffa198', fontFamily: 'monospace', fontSize: 12,
            padding: '10px 16px', zIndex: 20, flexShrink: 0,
          }}>
            <div style={{ fontWeight: 700, color: '#f85149', marginBottom: 6 }}>
              ⚠ Fonction SQL manquante dans Supabase — aucun carreau ne peut s'afficher
            </div>
            <div style={{ marginBottom: 8, color: '#e6edf3', fontSize: 11 }}>
              Allez dans <b>Supabase Dashboard → SQL Editor</b> et exécutez ce SQL :
            </div>
            <pre style={{
              background: '#0d1117', border: '1px solid #30363d', borderRadius: 4,
              padding: '8px 12px', fontSize: 10, overflowX: 'auto',
              color: '#79c0ff', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>{`CREATE OR REPLACE FUNCTION get_carreaux_bbox(
  p_table  text,
  p_west   float8,
  p_south  float8,
  p_east   float8,
  p_north  float8,
  p_limit  int DEFAULT 15000
)
RETURNS TABLE(idcar text, geom geometry, metadata jsonb)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT idcar, geom, metadata
     FROM %I
     WHERE geom && ST_MakeEnvelope($1,$2,$3,$4,4326)
     LIMIT $5',
    p_table
  ) USING p_west, p_south, p_east, p_north, p_limit;
END;
$$;`}</pre>
          </div>
        )}

        <div ref={mapContainerRef} style={{ flex: 1, minHeight: 0 }} />

        {/* Badge statut chargement */}
        {(loading || (features.length > 0 && !zoomTooLow)) && (
          <div style={{
            position: 'absolute', top: 12, right: 12,
            background: loading ? 'rgba(59,130,246,0.92)' : 'rgba(0,0,0,0.72)',
            color: '#fff', fontFamily: 'monospace', fontSize: 12, fontWeight: 600,
            padding: '5px 12px', borderRadius: 6, zIndex: 10,
            backdropFilter: 'blur(4px)',
          }}>
            {loading
              ? '⟳ Chargement...'
              : `${features.length.toLocaleString('fr-FR')} carreaux${truncated ? ' (⚠ tronqué)' : ''}`}
          </div>
        )}
      </div>
    </div>
  );
}
