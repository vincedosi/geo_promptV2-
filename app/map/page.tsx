'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { circleGeoJSON, getCatColor, MAP_STYLES, MAP_STYLE } from '@/app/copilote/_lib/constants';
import { useMapInit }          from '@/app/copilote/_hooks/useMapInit';
import { useSavedMaps }        from '@/app/copilote/_hooks/useSavedMaps';
import { useMapLayers }        from '@/app/copilote/_hooks/useMapLayers';
import { useChatControls }     from '@/app/copilote/_hooks/useChatControls';
import { useRateLimitHandler } from '@/app/copilote/_hooks/useRateLimitHandler';
import { useToolProcessor, type CorrelationActionParams } from '@/app/copilote/_hooks/useToolProcessor';
import { useProviderSelector } from '@/app/copilote/_hooks/useProviderSelector';
import { MapPanel }            from '@/app/copilote/_components/MapPanel';
import { FilterPanel }         from '@/app/map/_components/FilterPanel';
import type { DirectPOISearchParams, DirectBattleParams, DirectBattleV2Params, FillIsochroneCacheParams, POIStylesMap } from '@/app/map/_components/FilterPanel';
import { IrisDetailPanel }    from '@/app/map/_components/IrisDetailPanel';
import type { IrisDetailData } from '@/app/map/_components/IrisDetailPanel';
import type { ResidualsMeta, ResidualData } from '@/app/map/_components/CorrelationPanel';
import type { ClusterGeoJSON } from '@/app/map/_components/ClusterPanel';
import dynamic from 'next/dynamic';
const StudyDashboard = dynamic(
  () => import('@/app/map/_components/StudyDashboard').then(m => ({ default: m.StudyDashboard })),
  { ssr: false },
);
import type { ZoneData, BattleResult } from '@/types/spatial';
import { exportOohReport, type OohExportData } from '@/app/copilote/_lib/ooh-export';
import { ChatPanel }       from '@/app/copilote/_components/ChatPanel';
import { WelcomeOverlay }  from '@/app/copilote/_components/WelcomeOverlay';
import { SessionBadge }    from '@/components/SessionBadge';
import type { POI } from '@/types/poi';

interface SelectedBillboard {
  id: string; nom: string; lat: number; lng: number;
  format?: string; score?: number | null; audience?: number | null;
  rank?: number | null; regie?: string;
}

// ─── HTML escape for popup content (prevents XSS from imported data) ─────────
function esc(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Helpers résidus ──────────────────────────────────────────────────────────

function normToColor(norm: number, inverted = false): string {
  const n = inverted ? -norm : norm;
  if (n <= -0.5)  return '#ef4444';
  if (n <= -0.15) return '#f97316';
  if (n <= -0.05) return '#fbbf24';
  if (n <   0.05) return '#e2e8f0';
  if (n <   0.15) return '#86efac';
  if (n <   0.5)  return '#22c55e';
  return '#059669';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MapPage() {
  const [error,    setError]    = useState<string | null>(null);
  const [zoneData, setZoneData] = useState<ZoneData | null>(null);
  const [activeTab,   setActiveTab]   = useState<'map' | 'study'>('map');
  const [studyVille,  setStudyVille]  = useState<string | null>(null);
  const [selectedBillboard, setSelectedBillboard] = useState<SelectedBillboard | null>(null);
  const [mapStyleUrl, setMapStyleUrl] = useState<string>(MAP_STYLE);
  const [battleFeatures,      setBattleFeatures]      = useState<GeoJSON.Feature[]>([]);
  const [battlePois,          setBattlePois]          = useState<POI[]>([]);
  const [battleCacheKey,      setBattleCacheKey]      = useState<string | null>(null);
  const [densityMode,         setDensityMode]         = useState<boolean>(false);
  const [poiStyles,           setPoiStyles]           = useState<POIStylesMap>({});
  // Clustering clusters
  const [clusterGeoJSON,    setClusterGeoJSON]    = useState<ClusterGeoJSON | null>(null);
  const [clustersVisible,   setClustersVisible]   = useState(false);
  const [clusterLoading,    setClusterLoading]    = useState(false);
  const [clusterDuration,   setClusterDuration]   = useState(60);
  // Wizard highlight — POIs preview pendant la configuration du clustering
  const [wizardHighlightGeoJSON, setWizardHighlightGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  // TMJA — flux routier (comptages_routiers)
  const [tmjaGeoJSON, setTmjaGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  // Corrélation IRIS × POI — params depuis le chat
  const [correlationParams, setCorrelationParams] = useState<CorrelationActionParams | null>(null);
  // Résidus de corrélation — layer MVT (match expression sur iris-source)
  const [residualsMeta,     setResidualsMeta]     = useState<ResidualsMeta | null>(null);
  const [residualOpacity,   setResidualOpacity]   = useState(0.65);
  const [residualInverted,  setResidualInverted]  = useState(false);
  const residualsClickHandlerRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);
  const residualsMouseHandlersRef = useRef<{ enter: () => void; leave: () => void } | null>(null);
  const residualLookupRef    = useRef<Map<string, ResidualData>>(new Map());
  const residualInvertedRef  = useRef(false);
  useEffect(() => { residualInvertedRef.current = residualInverted; }, [residualInverted]);

  // ── IRIS detail panel ──────────────────────────────────────────────────────
  const [selectedIrisCode,   setSelectedIrisCode]   = useState<string | null>(null);
  const [selectedIrisData,   setSelectedIrisData]   = useState<IrisDetailData | null>(null);
  const [irisDetailLoading,  setIrisDetailLoading]  = useState(false);
  const irisClickHandlerRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('genesis_map_style');
    if (stored) setMapStyleUrl(stored);
    const dm = localStorage.getItem('genesis_density_mode');
    if (dm === 'true') setDensityMode(true);
  }, []);

  const handleMapStyleChange = (url: string) => {
    setMapStyleUrl(url);
    localStorage.setItem('genesis_map_style', url);
  };

  // Stocke le résultat de bataille pré-calculé (PostGIS) — appliqué uniquement sur clic "BATAILLE"
  const pendingBattleRef = useRef<{
    geoJSON: GeoJSON.FeatureCollection;
    borders: GeoJSON.FeatureCollection;
    category?: string;
    poisForMap?: POI[];
  } | null>(null);

  const { mapContainerRef, mapRef, markersRef, mapReady } = useMapInit(zoneData, setSelectedBillboard, mapStyleUrl);

  // ── Sync wizard highlight GeoJSON → map source ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('wizard-highlight') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (wizardHighlightGeoJSON) {
      src.setData(wizardHighlightGeoJSON);
      try { map.setLayoutProperty('wizard-highlight-layer', 'visibility', 'visible'); } catch { /* */ }
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
      try { map.setLayoutProperty('wizard-highlight-layer', 'visibility', 'none'); } catch { /* */ }
    }
  }, [wizardHighlightGeoJSON, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync cluster GeoJSON → map source ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !clusterGeoJSON) return;
    const src = map.getSource('clusters-source') as maplibregl.GeoJSONSource | undefined;
    src?.setData(clusterGeoJSON as unknown as GeoJSON.FeatureCollection);
  }, [clusterGeoJSON, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync clustersVisible → layer visibility ─────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try { map.setLayoutProperty('clusters-layer', 'visibility', clustersVisible ? 'visible' : 'none'); } catch { /* */ }
  }, [clustersVisible, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync TMJA GeoJSON → map source ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('tmja-source') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (tmjaGeoJSON) {
      src.setData(tmjaGeoJSON);
      try { map.setLayoutProperty('tmja-lines', 'visibility', 'visible'); } catch { /* */ }
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
      try { map.setLayoutProperty('tmja-lines', 'visibility', 'none'); } catch { /* */ }
    }
  }, [tmjaGeoJSON, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── IRIS detail — click handler ────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const LAYER = 'iris-fill';

    // Remove previous handler if any
    if (irisClickHandlerRef.current) {
      try { map.off('click', LAYER, irisClickHandlerRef.current); } catch { /* ok */ }
    }

    const handler = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const feat = e.features?.[0];
      if (!feat) return;
      const code = feat.properties?.code_iris as string | undefined;
      if (!code) return;
      e.preventDefault?.();
      setSelectedIrisCode(code);
    };

    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    irisClickHandlerRef.current = handler;
    map.on('click', LAYER, handler);
    map.on('mouseenter', LAYER, onEnter);
    map.on('mouseleave', LAYER, onLeave);

    return () => {
      try { map.off('click', LAYER, handler); } catch { /* ok */ }
      try { map.off('mouseenter', LAYER, onEnter); } catch { /* ok */ }
      try { map.off('mouseleave', LAYER, onLeave); } catch { /* ok */ }
    };
  }, [mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── IRIS detail — fetch on code change ─────────────────────────────────────
  useEffect(() => {
    if (!selectedIrisCode) return;
    setIrisDetailLoading(true);
    setSelectedIrisData(prev => prev?.code_iris === selectedIrisCode ? prev : null);
    fetch(`/api/iris/detail?code_iris=${encodeURIComponent(selectedIrisCode)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((d: IrisDetailData) => { setSelectedIrisData(d); setIrisDetailLoading(false); })
      .catch(() => { setIrisDetailLoading(false); });
  }, [selectedIrisCode]);

  // ── flyTo / fitBounds helpers ──────────────────────────────────────────────
  const handleFlyTo = (lat: number, lng: number, zoom = 12) => {
    if (mapRef.current && mapReady) mapRef.current.flyTo({ center: [lng, lat], zoom, duration: 1000 });
  };
  const handleFitBounds = (bounds: [[number, number], [number, number]]) => {
    if (mapRef.current && mapReady)
      mapRef.current.fitBounds(
        new maplibregl.LngLatBounds(bounds[0], bounds[1]),
        { padding: 60, duration: 1000 },
      );
  };

  // ── Résidus de corrélation — layer MVT (match expression sur iris-source) ──
  const handleShowResiduals = useCallback((data: ResidualData[] | null, meta?: ResidualsMeta) => {
    const map = mapRef.current;
    if (!map) return;

    const LAYER = 'iris-residuals-fill';

    // Cleanup ancien handler + layer
    if (residualsClickHandlerRef.current) {
      try { map.off('click', LAYER, residualsClickHandlerRef.current); } catch { /* ok */ }
      residualsClickHandlerRef.current = null;
    }
    if (residualsMouseHandlersRef.current) {
      try { map.off('mouseenter', LAYER, residualsMouseHandlersRef.current.enter); } catch { /* ok */ }
      try { map.off('mouseleave', LAYER, residualsMouseHandlersRef.current.leave); } catch { /* ok */ }
      residualsMouseHandlersRef.current = null;
    }
    try {
      if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    } catch { /* ok */ }

    if (!data) {
      setResidualsMeta(null);
      residualLookupRef.current.clear();
      return;
    }

    // Lookup pour les popups (code_iris → données calculées)
    residualLookupRef.current = new Map(data.map(d => [d.code_iris, d]));

    const inverted = residualInvertedRef.current;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matchExpr: any[] = ['match', ['get', 'code_iris']];
    for (const d of data) {
      matchExpr.push(d.code_iris, normToColor(d.norm, inverted));
    }
    matchExpr.push('transparent'); // fallback pour les IRIS hors résultats

    try {
      // Inséré avant iris-border pour que les bordures restent visibles au-dessus
      map.addLayer({
        id: LAYER,
        type: 'fill',
        source: 'iris-source',
        'source-layer': 'iris',
        minzoom: 5,
        paint: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'fill-color':   matchExpr as any,
          'fill-opacity': residualOpacity,
        },
      }, 'iris-border');
    } catch {
      return;
    }

    // Popup au clic via le lookup (les données ne sont pas dans les tuiles MVT)
    const clickHandler = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties as Record<string, unknown>;
      const codeIris = String(props.code_iris ?? '');
      const d = residualLookupRef.current.get(codeIris);
      if (!d) return;
      const sign = d.residual > 0 ? '+' : '';
      const inv  = residualInvertedRef.current;
      const status = d.residual >  0.5 ? (inv ? 'Sur-équipé (rouge)'  : 'Sur-équipé')
                   : d.residual < -0.5 ? (inv ? 'Sous-équipé (vert)'  : 'Sous-équipé')
                   : 'Normal';
      const statusColor = inv
        ? (d.residual >  0.5 ? '#ef4444' : d.residual < -0.5 ? '#22c55e' : '#e2e8f0')
        : (d.residual >  0.5 ? '#22c55e' : d.residual < -0.5 ? '#ef4444' : '#e2e8f0');
      new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
        .setLngLat(e.lngLat)
        .setHTML(`<div style="font-family:system-ui;font-size:13px;line-height:1.5;color:#e2e8f0;padding:12px;">
          <strong style="font-size:12px;color:#4ecdc4;">${String(props.nom_iris ?? d.nom_iris ?? codeIris)}</strong>
          <div style="font-size:11px;color:#666666;margin-bottom:8px;">${String(props.code_dept ?? '')} · ${codeIris}</div>
          <div style="font-size:18px;font-weight:700;color:${statusColor};margin-bottom:6px;">${status} (${sign}${d.residual.toFixed(2)})</div>
          <div style="font-size:11px;color:#94a3b8;">
            POI réels : <strong>${d.poi_count}</strong><br/>
            POI prédits : <strong>${d.predicted.toFixed(2)}</strong><br/>
            Métrique : <strong>${d.metric_value.toLocaleString('fr')}</strong>
          </div>
        </div>`)
        .addTo(map);
    };
    const onResidualEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onResidualLeave = () => { map.getCanvas().style.cursor = ''; };
    residualsClickHandlerRef.current = clickHandler;
    residualsMouseHandlersRef.current = { enter: onResidualEnter, leave: onResidualLeave };
    map.on('click', LAYER, clickHandler);
    map.on('mouseenter', LAYER, onResidualEnter);
    map.on('mouseleave', LAYER, onResidualLeave);

    setResidualsMeta(meta ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ── Contrôles résidus — opacité + inversion ────────────────────────────────
  const handleResidualOpacity = useCallback((value: number) => {
    setResidualOpacity(value);
    const map = mapRef.current;
    if (map?.getLayer('iris-residuals-fill')) {
      map.setPaintProperty('iris-residuals-fill', 'fill-opacity', value);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResidualInvert = useCallback((inverted: boolean) => {
    setResidualInverted(inverted);
    residualInvertedRef.current = inverted;
    const map = mapRef.current;
    if (!map?.getLayer('iris-residuals-fill') || !residualLookupRef.current.size) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matchExpr: any[] = ['match', ['get', 'code_iris']];
    residualLookupRef.current.forEach((r, code) => {
      matchExpr.push(code, normToColor(r.norm, inverted));
    });
    matchExpr.push('transparent');
    map.setPaintProperty('iris-residuals-fill', 'fill-color', matchExpr);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Charger arrêts de transport pour la vue courante ───────────────────────
  const handleLoadTransport = async (types: string[]) => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const url = `/api/map/transport?west=${b.getWest().toFixed(4)}&south=${b.getSouth().toFixed(4)}&east=${b.getEast().toFixed(4)}&north=${b.getNorth().toFixed(4)}${types.length ? `&types=${types.join(',')}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (data?.pois) setZoneData(data);
  };

  // ── Charger TMJA pour la vue courante ───────────────────────────────────────
  const handleLoadTMJA = async () => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = map.getZoom();
    if (zoom < 8) {
      alert('Zoomez davantage (zoom ≥ 8) pour afficher les flux routiers TMJA.');
      return;
    }
    const b = map.getBounds();
    const url = `/api/map/tmja?west=${b.getWest().toFixed(4)}&south=${b.getSouth().toFixed(4)}&east=${b.getEast().toFixed(4)}&north=${b.getNorth().toFixed(4)}&zoom=${zoom.toFixed(1)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data: GeoJSON.FeatureCollection = await res.json();
    setTmjaGeoJSON(data);
  };

  // ── Highlight wizard POIs sur la carte ─────────────────────────────────────
  const handleWizardHighlight = async (poiTypes: string[], metropolitaine: boolean) => {
    try {
      const res = await fetch('/api/map/pois', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poi_types: poiTypes,
          scope:     metropolitaine ? 'metro' : 'all',
          regions:   [],
          depts:     [],
          ville:     '',
          rayon_poi: null,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.pois?.length) { setWizardHighlightGeoJSON(null); return; }
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: (data.pois as { id: string; nom: string; lat: number; lng: number }[]).map(p => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
          properties: { id: p.id, nom: p.nom },
        })),
      };
      setWizardHighlightGeoJSON(fc);
    } catch { /* ignore */ }
  };

  // ── Charger les clusters (lazy) ────────────────────────────────────────────
  const handleToggleClusters = async () => {
    if (!clustersVisible && !clusterGeoJSON) {
      setClusterLoading(true);
      try {
        const res  = await fetch(`/api/poi-clusters?duration=${clusterDuration}`);
        const data = await res.json();
        if (data.type === 'FeatureCollection') {
          setClusterGeoJSON(data as ClusterGeoJSON);
          setClustersVisible(true);
        }
      } catch { /* ignore */ } finally { setClusterLoading(false); }
    } else {
      setClustersVisible(v => !v);
    }
  };

  // ── Changer la durée de clustering — re-fetch ───────────────────────────────
  const handleClusterDurationChange = async (d: number) => {
    setClusterDuration(d);
    setClusterLoading(true);
    try {
      const res  = await fetch(`/api/poi-clusters?duration=${d}`);
      const data = await res.json();
      if (data.type === 'FeatureCollection') {
        setClusterGeoJSON(data as ClusterGeoJSON);
        setClustersVisible(true);
      }
    } catch { /* ignore */ } finally { setClusterLoading(false); }
  };

  const savedMaps = useSavedMaps({ zoneData, setZoneData });
  const mapLayers = useMapLayers({
    mapRef, mapReady,
    isochroneDataForSaveRef:  savedMaps.isochroneDataForSaveRef,
    carreauxConfigForSaveRef: savedMaps.carreauxConfigForSaveRef,
    voronoiDataForSaveRef:    savedMaps.voronoiDataForSaveRef,
    setSaveName:              savedMaps.setSaveName,
  });
  const providerSelector = useProviderSelector();
  const chat = useChatControls({
    setError,
    setZoneData,
    setIsochroneFromCache: mapLayers.setIsochroneFromCache,
    provider: providerSelector.provider,
  });
  const rateLimit = useRateLimitHandler({
    chatError:          chat.chatError,
    setError,
    sendChatMessage:    chat.sendChatMessage,
    lastUserMessageRef: chat.lastUserMessageRef,
  });
  useToolProcessor({
    messages:                chat.messages,
    setZoneData,
    setError,
    applyIsochrones:          mapLayers.applyIsochrones,
    applyVoronoi:             mapLayers.applyVoronoi,
    applyIsochroneBattle:     mapLayers.applyIsochroneBattle,
    loadCarreauxFromAI:       mapLayers.loadCarreauxFromAI,
    carreauxSourcesRef:       mapLayers.carreauxSourcesRef,
    carreauxConfigForSaveRef: savedMaps.carreauxConfigForSaveRef,
    flyToCoords: (lat, lng) => {
      if (mapRef.current && mapReady) mapRef.current.flyTo({ center: [lng, lat], zoom: 11, duration: 1200 });
    },
    triggerOohExport: async (data: OohExportData) => {
      setError('Generation du rapport Excel...');
      await exportOohReport(data, mapRef, msg => {
        if (msg) setError(msg);
        else setError(null);
      });
    },
    setCorrelationParams,
  });

  savedMaps.applyIsochronesRef.current = mapLayers.applyIsochrones;
  savedMaps.applyVoronoiRef.current    = mapLayers.applyVoronoi;
  savedMaps.loadCarreauxRef.current    = mapLayers.loadCarreauxFromAI;
  savedMaps.setMessagesRef.current     = chat.setMessages;

  // ── Markers + flyTo ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !zoneData || !zoneData.coordonnees) return;
    const { lat, lng } = zoneData.coordonnees;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const DENSITY_THRESHOLD = 500;
    const useDensity = densityMode || zoneData.pois.length > DENSITY_THRESHOLD;
    const useLayers  = !useDensity && zoneData.pois.length > 300;

    const heatSrc = map.getSource('pois-heat') as maplibregl.GeoJSONSource | undefined;
    if (heatSrc) {
      heatSrc.setData({
        type: 'FeatureCollection',
        features: zoneData.pois.map(p => {
          const ps = poiStyles[p.categorie];
          const color = ps?.color ?? zoneData.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
            properties: { id: p.id, categorie: p.categorie, nom: p.nom ?? '', color, lat: p.lat, lng: p.lng },
          };
        }),
      });
    }
    try { map.setLayoutProperty('pois-heatmap', 'visibility', useDensity ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('pois-circles', 'visibility', (useLayers || useDensity) ? 'visible' : 'none'); } catch { /* */ }

    // ── Couleur heatmap dynamique ──────────────────────────────────────────
    if (useDensity) {
      // Couleur de la catégorie affichée (1ère catégorie des POIs), sinon violet accent
      const firstCat = zoneData.pois[0]?.categorie;
      const hex = (firstCat && poiStyles[firstCat]?.color) ?? zoneData.couleur_overrides?.[firstCat ?? ''] ?? '#4ecdc4';
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      try {
        map.setPaintProperty('pois-heatmap', 'heatmap-color', [
          'interpolate', ['linear'], ['heatmap-density'],
          0,    `rgba(${r},${g},${b},0)`,
          0.15, `rgba(${r},${g},${b},0.25)`,
          0.4,  `rgba(${r},${g},${b},0.55)`,
          0.7,  `rgba(${r},${g},${b},0.82)`,
          1,    `rgba(${r},${g},${b},1)`,
        ]);
      } catch { /* */ }
    }

    (map.getSource('zone-circle') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: zoneData.rayon_metres ? [circleGeoJSON(lng, lat, zoneData.rayon_metres)] : [],
    });
    map.triggerRepaint();

    const PIN_SIZE_PX: Record<string, number> = { Petite: 8, Standard: 12, Grosse: 16, Large: 22 };
    if (!useDensity && !useLayers) {
      zoneData.pois.forEach(p => {
        const ps = poiStyles[p.categorie];
        const color = ps?.color ?? zoneData.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
        const sizePx = PIN_SIZE_PX[ps?.size ?? 'Standard'] ?? 12;
        const rankVal = p.rank;
        const el = document.createElement('div');
        if (rankVal) {
          el.style.cssText = `width:22px;height:22px;background:${color};border:2px solid rgba(255,255,255,0.95);border-radius:50%;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;font-family:system-ui,sans-serif`;
          el.textContent = String(rankVal);
        } else {
          el.style.cssText = `width:${sizePx}px;height:${sizePx}px;background:${color};border:2px solid rgba(255,255,255,0.9);border-radius:50%;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4)`;
        }
        const nom = esc(p.nom || 'POI');
        const audienceVal = p.audience;
        const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
          `<div style="font-size:12px;padding:6px 8px;color:#888">` +
          (rankVal ? `<span style="color:#f59e0b;font-weight:700;font-size:13px">#${rankVal}</span> ` : '') +
          `<strong style="color:#fff;font-size:13px">${nom}</strong><br/>` +
          `<span style="color:${color};font-size:11px;font-weight:600;text-transform:uppercase">${esc(p.categorie)}</span>` +
          (p.sous_categorie ? ` <span style="color:#555;font-size:11px">· ${esc(p.sous_categorie)}</span>` : '') +
          (audienceVal != null ? `<br/><span style="color:#3dffa0;font-size:12px;font-weight:600">+${Number(audienceVal).toLocaleString('fr-FR')} pers.</span>` : '') +
          (p.adresse ? `<br/><span style="color:#555;font-size:11px">${esc(p.adresse)}</span>` : '') +
          `</div>`
        );
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);

        if (p.categorie === 'panneaux' || p.categorie === 'top_ooh') {
          el.addEventListener('click', () => {
            setSelectedBillboard({ id: p.id, nom: p.nom ?? 'Panneau', lat: p.lat, lng: p.lng,
              format: p.sous_categorie ?? undefined, score: p.score_ooh ?? null,
              audience: p.audience ?? null, rank: p.rank ?? null, regie: p.adresse ?? undefined });
          });
        }
      });
    }

    // Marqueur ville
    const cityEl = document.createElement('div');
    cityEl.style.cssText = 'width:10px;height:10px;background:#4ecdc4;border:2px solid #fff;border-radius:2px';
    markersRef.current.push(new maplibregl.Marker({ element: cityEl, anchor: 'center' }).setLngLat([lng, lat]).addTo(map));

    if (zoneData.pois.length > 1) {
      const lats = zoneData.pois.map(p => p.lat);
      const lngs = zoneData.pois.map(p => p.lng);
      map.fitBounds(
        new maplibregl.LngLatBounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]),
        { padding: 40, maxZoom: useLayers ? 7 : 14, duration: 1200 }
      );
      return;
    }
    const r = zoneData.rayon_metres, rPoi = zoneData.rayon_poi_metres;
    let zoom = 12;
    if (rPoi) zoom = rPoi < 300 ? 15 : rPoi < 800 ? 14 : rPoi < 2000 ? 13 : 12;
    else if (r) zoom = r < 1500 ? 14 : r < 4000 ? 13 : 11;
    map.flyTo({ center: [lng, lat], zoom, duration: 1200 });
  }, [zoneData, mapReady, densityMode, poiStyles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Note: no zoom-based opacity hiding on /map page — markers stay visible at all zoom levels.
  // (FilterPanel sends national queries that fitBounds to France zoom ~5-6, hiding markers at z<10)

  const handleDirectOOH = async (regies?: string[]) => {
    setError(null);
    setZoneData(null);
    try {
      const res = await fetch('/api/map/ooh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regies: regies ?? [] }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(err.error ?? `Erreur ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.error) setError(data.error);
      else setZoneData(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur réseau');
    }
  };

  const handleDirectSearch = async (params: DirectPOISearchParams) => {
    setError(null);
    setZoneData(null);
    try {
      const res = await fetch('/api/map/pois', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(err.error ?? `Erreur ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.error) setError(data.error);
      else if (!data.pois?.length) setError(`Aucun POI trouvé pour "${params.poi_types.join(', ')}"`);
      else setZoneData(data);
    } catch (e: unknown) {
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        setError('Base de données lente — réessayez dans quelques instants');
      } else {
        setError(e instanceof Error ? e.message : 'Erreur réseau');
      }
    }
  };

  const handleDirectBattle = async (
    params: DirectBattleParams,
    onProgress?: (msg: string, pct?: number) => void,
  ): Promise<{ geometry: string; nb_pois: number; poiGroups: { id: string; nom: string; geometries: string[] }[]; battleRings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: string }[] }> => {
    setError(null);
    pendingBattleRef.current = null;
    mapLayers.clearBattlePartialRings();
    let battleData: BattleResult | null = null;
    try {
      const res = await fetch('/api/isochrone-battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:           params.category,
          mode:               params.mode,
          max_minutes:        params.max_minutes,
          durations:          params.durations,
          filtre_ville:       params.filtre_ville    ?? null,
          filtre_regions:     params.filtre_regions  ?? null,
          metropolitaine:     params.metropolitaine,
          force_recalculate:  params.force_recalculate ?? false,
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: { type: string; message?: string; data?: BattleResult; rings?: unknown[]; total?: number; completed?: number; err?: number; status?: string } | null = null;
          try { evt = JSON.parse(line); } catch { continue; }
          if (!evt) continue;
          if (evt.type === 'error') {
            const raw = String(evt.message ?? 'Erreur inconnue');
            throw new Error(raw.startsWith('<') ? 'Service temporairement indisponible (503/521)' : raw.slice(0, 200));
          }
          if (evt.type === 'result') { battleData = evt.data ?? null; continue; }
          if (evt.type === 'partial_rings' && (evt.rings?.length ?? 0) > 0) {
            // Afficher les anneaux bruts dès qu'ils arrivent (avant ST_Difference)
            mapLayers.addBattlePartialRings(evt.rings! as Parameters<typeof mapLayers.addBattlePartialRings>[0]);
            onProgress?.(`> ◆ +${evt.rings!.length} isochrones sur la carte`);
          } else if (evt.type === 'pois_loaded') {
            onProgress?.(`> ${evt.total ?? '?'} POIs trouvés — démarrage ORS...`);
          } else if (evt.type === 'progress') {
            if (evt.status === 'bataille_postgis') {
              onProgress?.('> [BATAILLE] ST_Difference en cours (PostGIS)...');
            } else {
              const completed = evt.completed ?? 0;
              const total = evt.total ?? 0;
              const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
              const errInfo = (evt.err ?? 0) > 0 ? ` (${evt.err} erreurs ORS)` : '';
              onProgress?.(`> ${completed}/${total} POIs traités — ${pct}%${errInfo}`);
            }
          }
        }
      }
      reader.releaseLock();
      if (!battleData) throw new Error('Réponse incomplète');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur réseau';
      setError(`Isochrones — ${msg}`);
      throw new Error(msg);
    }
    if (battleData!.error) {
      // Tronquer les erreurs HTML (ex: page 521 Supabase/Cloudflare)
      const rawErr: string = String(battleData!.error);
      const cleanErr = rawErr.startsWith('<') ? 'Service temporairement indisponible (503/521)' : rawErr.slice(0, 200);
      setError(`Isochrones — ${cleanErr}`);
      throw new Error(battleData!.error);
    }
    // Afficher les isochrones bruts (rings) — couvre cache hit et ORS path.
    // La bataille (ST_Difference) n'est déclenchée que sur clic du bouton BATAILLE.
    if (battleData!.battleGeoJSON?.features?.length > 0) {
      const rawRings = (battleData!.battleGeoJSON.features as any[])
        .filter((f: any) => f?.geometry)
        .map((f: any) => ({
          cirfa_id: String(f.properties?.cirfa_id ?? f.properties?.id ?? ''),
          nom:      String(f.properties?.nom ?? ''),
          lat:      Number(f.properties?.lat ?? 0),
          lng:      Number(f.properties?.lng ?? 0),
          palier:   Number(f.properties?.palier ?? 0),
          geojson:  f.geometry,
        }));
      mapLayers.clearBattlePartialRings();
      mapLayers.addBattlePartialRings(rawRings);
      setBattleFeatures(battleData!.battleGeoJSON.features);
    }
    // poisForMap peut être absent des anciens caches v3 — fallback depuis les ring features
    let poisForMap: { id: string; nom: string; lat: number; lng: number; categorie?: string; adresse?: string; ville?: string }[] = battleData!.poisForMap ?? [];
    if (poisForMap.length === 0 && battleData!.battleGeoJSON?.features?.length > 0) {
      const poisSeen = new Set<string>();
      for (const f of battleData!.battleGeoJSON.features as any[]) {
        const p = f?.properties ?? {};
        const cid = String(p.cirfa_id ?? p.id ?? '');
        const lat = Number(p.lat), lng = Number(p.lng);
        if (cid && !poisSeen.has(cid) && !isNaN(lat) && !isNaN(lng) && lat && lng) {
          poisSeen.add(cid);
          poisForMap.push({ id: cid, nom: String(p.nom ?? ''), lat, lng, categorie: params.category, adresse: String(p.adresse ?? ''), ville: String(p.ville ?? '') });
        }
      }
    }
    if (battleData!.battleCacheKey) setBattleCacheKey(battleData!.battleCacheKey);
    if (poisForMap.length > 0) {
      setBattlePois(poisForMap as any[]);
      setZoneData({
        coordonnees: { lat: poisForMap[0].lat, lng: poisForMap[0].lng },
        pois: poisForMap as any[],
        nb_pois: poisForMap.length,
        categories: { [params.category]: poisForMap.length },
        couleur_overrides: {},
        ville: params.filtre_ville ?? '',
        rayon_metres: null,
        rayon_poi_metres: null,
      });
    }
    // Fusionner tous les rings en un seul MultiPolygon simplifié (client-side, pas de Turf)
    const allPolygons: number[][][][] = [];
    // Grouper les géométries par cirfa_id pour le calcul couverture par POI
    const groupMap = new Map<string, { nom: string; geoms: string[] }>();
    for (const f of battleData!.battleGeoJSON?.features ?? []) {
      if (f.properties?.feature_type !== 'ring') continue;
      const geom = f.geometry;
      if (!geom) continue;
      if (geom.type === 'Polygon')      allPolygons.push(geom.coordinates);
      else if (geom.type === 'MultiPolygon') allPolygons.push(...geom.coordinates);
      const cid = String(f.properties?.cirfa_id ?? f.properties?.id ?? '');
      const nom = String(f.properties?.nom ?? '');
      if (cid) {
        if (!groupMap.has(cid)) groupMap.set(cid, { nom, geoms: [] });
        groupMap.get(cid)!.geoms.push(JSON.stringify(geom));
      }
    }
    // Réduire à 3 décimales (~111m) pour alléger le payload (~10× moins de bytes)
    const multiPoly = { type: 'MultiPolygon', coordinates: allPolygons };
    const simplified = JSON.parse(JSON.stringify(multiPoly, (_, v) =>
      typeof v === 'number' ? Math.round(v * 1000) / 1000 : v
    ));
    const geometry  = allPolygons.length > 0 ? JSON.stringify(simplified) : '';
    const poiGroups = [...groupMap.entries()].map(([id, { nom, geoms }]) => ({ id, nom, geometries: geoms }));
    // Convertir les ring features en RingEntry pour le bouton BATAILLE (Phase 2)
    const battleRings = (battleData!.battleGeoJSON?.features ?? [])
      .filter((f: any) => f?.properties?.feature_type === 'ring' && f?.geometry)
      .map((f: any) => ({
        cirfa_id: String(f.properties.cirfa_id ?? f.properties.id ?? ''),
        nom:      String(f.properties.nom ?? ''),
        lat:      Number(f.properties.lat ?? 0),
        lng:      Number(f.properties.lng ?? 0),
        palier:   Number(f.properties.palier ?? 0),
        geojson:  JSON.stringify(f.geometry),
      }));
    return { geometry, nb_pois: battleData!.nb_pois ?? 0, poiGroups, battleRings };
  };

  // Remplit le cache ORS sans écraser les POIs affichés sur la carte
  const handleFillIsochroneCache = async (
    params: FillIsochroneCacheParams,
    onProgress?: (msg: string) => void,
  ): Promise<void> => {
    mapLayers.clearBattlePartialRings();
    try {
      const res = await fetch('/api/isochrone-battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:          params.category,
          mode:              params.mode,
          max_minutes:       params.max_minutes,
          durations:         params.durations,
          filtre_ville:      params.filtre_ville   ?? null,
          filtre_regions:    params.filtre_regions ?? null,
          metropolitaine:    params.metropolitaine,
          force_recalculate: false,
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: any;
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === 'error') throw new Error(String(evt.message ?? 'Erreur inconnue').slice(0, 200));
          if (evt.type === 'partial_rings' && evt.rings?.length > 0) {
            mapLayers.addBattlePartialRings(evt.rings);
            onProgress?.(`> ◆ +${evt.rings.length} isochrones sur la carte`);
          } else if (evt.type === 'pois_loaded') {
            onProgress?.(`> ${evt.total} POIs trouvés — démarrage ORS...`);
          } else if (evt.type === 'progress') {
            if (evt.status === 'bataille_postgis') {
              onProgress?.('> [BATAILLE] ST_Difference en cours (PostGIS)...');
            } else {
              const pct    = Math.round((evt.completed / evt.total) * 100);
              const errInfo = evt.err > 0 ? ` (${evt.err} erreurs ORS)` : '';
              onProgress?.(`> ${evt.completed}/${evt.total} POIs traités — ${pct}%${errInfo}`);
            }
          }
          // result: on affiche juste les rings finaux si disponibles (pas de setZoneData)
          if (evt.type === 'result' && evt.data?.battleGeoJSON?.features?.length > 0) {
            const rawRings = (evt.data.battleGeoJSON.features as any[])
              .filter((f: any) => f?.geometry)
              .map((f: any) => ({
                cirfa_id: String(f.properties?.cirfa_id ?? f.properties?.id ?? ''),
                nom:      String(f.properties?.nom ?? ''),
                lat:      Number(f.properties?.lat ?? 0),
                lng:      Number(f.properties?.lng ?? 0),
                palier:   Number(f.properties?.palier ?? 0),
                geojson:  f.geometry,
              }));
            mapLayers.clearBattlePartialRings();
            mapLayers.addBattlePartialRings(rawRings);
          }
        }
      }
      reader.releaseLock();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur réseau';
      setError(`Cache fill — ${msg}`);
      throw new Error(msg);
    }
  };

  const handleApplyBattle = async (
    rings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: string }[],
    category?: string,
    poisForMap?: { id: string; nom: string; lat: number; lng: number; adresse?: string; ville?: string }[],
    onProgress?: (msg: string, pct: number) => void,
  ): Promise<void> => {
    setError(null);
    // Priorité : utiliser le résultat pré-calculé (déjà fait par la route en Phase 5)
    if (pendingBattleRef.current) {
      const { geoJSON, borders, category: cat, poisForMap: pois } = pendingBattleRef.current;
      mapLayers.applyIsochroneBattle(geoJSON, borders, cat ?? category, pois ?? poisForMap);
      return;
    }
    // Stream NDJSON depuis apply-battle
    const res = await fetch('/api/isochrone-battle/apply-battle', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ rings }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setError(`Bataille — ${err.error ?? `HTTP ${res.status}`}`);
      return;
    }
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const PCT: Record<string, number> = { clip: 15, clip_done: 45, battle: 50, done: 85 };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt: any;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'error') {
          setError(`Bataille — ${evt.message}`);
          throw new Error(evt.message);
        }
        if (evt.type === 'progress') {
          onProgress?.(evt.message, PCT[evt.step] ?? 50);
        }
        if (evt.type === 'result') {
          console.log('[handleApplyBattle] result received — nb_rings:', evt.nb_rings, '| features:', evt.battleGeoJSON?.features?.length);
          onProgress?.(`${evt.nb_rings} zones, ${evt.nb_borders} bordures`, 95);
          if (evt.battleGeoJSON?.features?.length > 0) {
            mapLayers.applyIsochroneBattle(evt.battleGeoJSON, evt.battleBorders ?? null, category, poisForMap);
            setBattleFeatures(evt.battleGeoJSON.features);
          }
        }
      }
    }
    reader.releaseLock();
  };

  const handleDirectBattleV2 = async (
    params: DirectBattleV2Params,
    onProgress?: (msg: string) => void,
  ): Promise<void> => {
    setError(null);
    mapLayers.clearBattlePartialRings();
    try {
      const res = await fetch('/api/isochrone-battle-v2', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(params),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let data: any;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: any;
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === 'error') throw new Error(evt.message ?? 'Erreur inconnue');
          if (evt.type === 'result') { data = evt.data; continue; }
          if (evt.type === 'warning') onProgress?.(`> ! ${evt.message}`);
          else if (evt.type === 'pois_loaded')  onProgress?.(`> ${evt.total} POIs chargés`);
          else if (evt.type === 'rings_loaded') onProgress?.(`> ${evt.count} anneaux en cache (${evt.missing} manquants)`);
          else if (evt.type === 'computing')    onProgress?.(`> ${evt.message}`);
        }
      }
      reader.releaseLock();
      if (!data) throw new Error('Réponse incomplète');
      if (data.error) throw new Error(data.error);

      // Afficher le résultat sur la carte
      if (data.battleGeoJSON?.features?.length > 0) {
        mapLayers.applyIsochroneBattle(data.battleGeoJSON, null, params.category, data.poisForMap);
        setBattleFeatures(data.battleGeoJSON.features);
      }

      // Mettre à jour les POIs sur la carte
      const poisForMap = data.poisForMap ?? [];
      if (poisForMap.length > 0) {
        setBattlePois(poisForMap);
        setZoneData({
          coordonnees: { lat: poisForMap[0].lat, lng: poisForMap[0].lng },
          pois: poisForMap,
          nb_pois: poisForMap.length,
          categories: { [params.category]: poisForMap.length },
          couleur_overrides: {},
          ville: params.filtre_ville ?? '',
          rayon_metres: null,
          rayon_poi_metres: null,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur réseau';
      setError(`Bataille v2 — ${msg}`);
      throw new Error(msg);
    }
  };

  const activeCats = zoneData?.categories ? Object.keys(zoneData.categories).sort() : [];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', background: '#060608' }}>
      <FilterPanel
        chatSlot={
          <ChatPanel
            containerStyle={{ width: '100%', minWidth: 0, flex: 1, borderRight: 'none', minHeight: 0 }}
            hideHeader={true}
            messages={chat.messages}
            isLoading={chat.isLoading}
            input={chat.input}
            setInput={chat.setInput}
            handleSubmit={chat.handleSubmit}
            handleKeyDown={chat.handleKeyDown}
            sendMessage={chat.sendMessage}
            messagesEndRef={chat.messagesEndRef}
            rateLimitCooldown={rateLimit.rateLimitCooldown}
            cancelCooldown={rateLimit.cancelCooldown}
            error={error}
            showSavePanel={savedMaps.showSavePanel}
            showLoadPanel={savedMaps.showLoadPanel}
            setShowSavePanel={savedMaps.setShowSavePanel}
            setShowLoadPanel={savedMaps.setShowLoadPanel}
            saveName={savedMaps.saveName}
            setSaveName={savedMaps.setSaveName}
            saveLoading={savedMaps.saveLoading}
            saveError={savedMaps.saveError}
            setSaveError={savedMaps.setSaveError}
            savedMaps={savedMaps.savedMaps}
            saveCurrentMap={savedMaps.saveCurrentMap}
            loadSavedMaps={savedMaps.loadSavedMaps}
            loadMap={savedMaps.loadMap}
            deleteMap={savedMaps.deleteMap}
            zoneData={zoneData}
            provider={providerSelector.provider}
            setProvider={providerSelector.setProvider}
            providerStatus={providerSelector.providerStatus}
            statusLoading={providerSelector.statusLoading}
            refreshProviderStatus={providerSelector.refreshStatus}
            sessionTokens={chat.sessionTokens}
            onFlyTo={handleFlyTo}
            onHighlightIris={(codeIris: string | null) => {
              const map = mapRef.current;
              if (!map || !mapReady) return;
              if (!codeIris) {
                // Retirer le filtre de highlight
                try { map.setFilter('iris-fill',   null); } catch { /* ok */ }
                try { map.setFilter('iris-border', null); } catch { /* ok */ }
                // Ne masquer les layers QUE si la choroplèthe IRIS n'est pas ouverte
                if (!mapLayers.irisVisible) {
                  try { map.setLayoutProperty('iris-fill',   'visibility', 'none'); } catch { /* ok */ }
                  try { map.setLayoutProperty('iris-border', 'visibility', 'none'); } catch { /* ok */ }
                }
              } else {
                const filter: maplibregl.FilterSpecification = ['==', ['get', 'code_iris'], codeIris];
                try { map.setLayoutProperty('iris-fill',   'visibility', 'visible'); } catch { /* ok */ }
                try { map.setLayoutProperty('iris-border', 'visibility', 'visible'); } catch { /* ok */ }
                try { map.setFilter('iris-fill',   filter); } catch { /* ok */ }
                try { map.setFilter('iris-border', filter); } catch { /* ok */ }
                // Vérifier après stabilisation de la carte (tuiles chargées + caméra stable)
                // map.once('idle') est plus fiable que 'render' : évite les faux négatifs pendant l'animation de vol
                const idleTimeout = setTimeout(() => map.off('idle', onIdle), 5000);
                const onIdle = () => {
                  clearTimeout(idleTimeout);
                  try {
                    const features = map.queryRenderedFeatures(undefined, {
                      layers: ['iris-fill'],
                      filter: filter as maplibregl.FilterSpecification,
                    });
                    if (!features.length) {
                      setError('Cet IRIS n\'est pas disponible à ce niveau de zoom');
                      setTimeout(() => setError(null), 3000);
                    }
                  } catch { /* ok — layer peut ne pas exister encore */ }
                };
                map.once('idle', onIdle);
              }
            }}
          />
        }
        sendMessage={chat.sendMessage}
        onDirectOOH={handleDirectOOH}
        onDirectSearch={handleDirectSearch}
        onDirectBattle={handleDirectBattle}
        onDirectBattleV2={handleDirectBattleV2}
        onFillIsochroneCache={handleFillIsochroneCache}
        onApplyBattle={handleApplyBattle}
        isLoading={chat.isLoading}
        error={error}
        zoneData={zoneData}
        voronoiVisible={mapLayers.voronoiVisible}
        setVoronoiVisible={mapLayers.setVoronoiVisible}
        battleVisible={mapLayers.battleVisible}
        setBattleVisible={mapLayers.setBattleVisible}
        battleOuterFillVisible={mapLayers.battleOuterFillVisible}
        setBattleOuterFillVisible={mapLayers.setBattleOuterFillVisible}
        isochroneVisible={mapLayers.isochroneVisible}
        setIsochroneVisible={mapLayers.setIsochroneVisible}
        setShowSavePanel={savedMaps.setShowSavePanel}
        battleFeatures={battleFeatures}
        battlePois={battlePois}
        battleCacheKey={battleCacheKey}
        densityMode={densityMode}
        onDensityModeChange={(v) => { setDensityMode(v); localStorage.setItem('genesis_density_mode', String(v)); }}
        onPOIStylesChange={setPoiStyles}
        clusterGeoJSON={clusterGeoJSON}
        clustersVisible={clustersVisible}
        clusterLoading={clusterLoading}
        clusterDuration={clusterDuration}
        onToggleClusters={handleToggleClusters}
        onLoadClusters={handleToggleClusters}
        onClusterDurationChange={handleClusterDurationChange}
        onFlyTo={handleFlyTo}
        onFitBounds={handleFitBounds}
        onWizardHighlight={handleWizardHighlight}
        onWizardClose={() => setWizardHighlightGeoJSON(null)}
        carreauxVisible={mapLayers.carreauxVisible}
        carreauxLoaded={mapLayers.carreauxLoaded}
        carreauxIndicateur={mapLayers.carreauxIndicateur}
        carreauxPalette={mapLayers.carreauxPalette}
        carreauxOpacity={mapLayers.carreauxOpacity}
        carreauxRange={mapLayers.carreauxRange}
        carreauxSelectedBucket={mapLayers.carreauxSelectedBucket}
        setCarreauxVisible={mapLayers.setCarreauxVisible}
        setCarreauxIndicateur={mapLayers.setCarreauxIndicateur}
        setCarreauxPalette={mapLayers.setCarreauxPalette}
        setCarreauxOpacity={mapLayers.setCarreauxOpacity}
        setCarreauxSelectedBucket={mapLayers.setCarreauxSelectedBucket}
        irisVisible={mapLayers.irisVisible}
        irisIndicateur={mapLayers.irisIndicateur}
        irisPalette={mapLayers.irisPalette}
        irisOpacity={mapLayers.irisOpacity}
        irisStats={mapLayers.irisStats}
        irisTrueOnly={mapLayers.irisTrueOnly}
        setIrisVisible={mapLayers.setIrisVisible}
        setIrisIndicateur={mapLayers.setIrisIndicateur}
        setIrisPalette={mapLayers.setIrisPalette}
        setIrisOpacity={mapLayers.setIrisOpacity}
        setIrisTrueOnly={mapLayers.setIrisTrueOnly}
        scoringMapRef={mapRef}
        scoringMapReady={mapReady}
        onScoreComputed={(v) => setStudyVille(v)}
        onLoadTransport={handleLoadTransport}
        onLoadTMJA={handleLoadTMJA}
        tmjaVisible={!!tmjaGeoJSON}
        onClearTMJA={() => setTmjaGeoJSON(null)}
        correlationParams={correlationParams}
        onShowResiduals={handleShowResiduals}
      />
      {/* ── Right panel: tabs Carte / Étude ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>

        {/* Tab bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 0,
          background: '#050505', borderBottom: '0.5px solid #1a1a1a',
          padding: '0 16px', height: 36, flexShrink: 0, zIndex: 10,
          position: 'relative',
        }}>
          {(['map', 'study'] as const).map(tab => {
            const active = activeTab === tab;
            return (
              <button key={tab} onClick={() => setActiveTab(tab)} className="topbar-tab" style={{
                padding: '0 18px', height: '100%', position: 'relative',
                background: 'transparent',
                border: 'none',
                color: active ? '#f0f0f0' : '#666666',
                fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, fontWeight: 500,
                letterSpacing: '0.01em', cursor: 'pointer',
                transition: 'color 0.2s ease',
              }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#a0a0a0'; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#666666'; }}
              >
                {tab === 'map' ? 'Carte' : 'Étude'}
                {tab === 'study' && studyVille && (
                  <span style={{ marginLeft: 6, fontSize: 9, color: '#4ecdc4', fontFamily: "'JetBrains Mono','Fira Mono',monospace" }}>{studyVille}</span>
                )}
                {/* Underline that grows from center */}
                <span style={{
                  position: 'absolute', bottom: 0, left: '50%',
                  width: active ? '100%' : '0%',
                  height: 2, background: '#4ecdc4',
                  transform: 'translateX(-50%)',
                  transition: 'width 0.25s ease',
                }} />
              </button>
            );
          })}
          <div style={{ marginLeft: 'auto' }}>
            <SessionBadge />
          </div>
        </div>

        {/* Map area — kept mounted, hidden when study tab active */}
        <div style={{ flex: 1, position: 'relative', display: activeTab === 'map' ? 'flex' : 'none' }}>
      <MapPanel
        mapContainerRef={mapContainerRef}
        zoneData={zoneData}
        activeCats={activeCats}
        isochroneVisible={mapLayers.isochroneVisible}
        isochroneMinutes={mapLayers.isochroneMinutes}
        isochroneMode={mapLayers.isochroneMode}
        isochroneFromCache={mapLayers.isochroneFromCache}
        isochroneCachedAt={mapLayers.isochroneCachedAt}
        setIsochroneVisible={mapLayers.setIsochroneVisible}
        recalculerIsochrone={chat.recalculerIsochrone}
        isLoading={chat.isLoading}
        voronoiVisible={mapLayers.voronoiVisible}
        voronoiCategory={mapLayers.voronoiCategory}
        voronoiPois={mapLayers.voronoiPois}
        setVoronoiVisible={mapLayers.setVoronoiVisible}
        voronoiDataForSaveRef={savedMaps.voronoiDataForSaveRef}
        setShowSavePanel={savedMaps.setShowSavePanel}
        setSaveError={savedMaps.setSaveError}
        battleVisible={mapLayers.battleVisible}
        battleCategory={mapLayers.battleCategory}
        battlePois={mapLayers.battlePois}
        setBattleVisible={mapLayers.setBattleVisible}
        battleMaxPalier={mapLayers.battleMaxPalier}
        setBattleMaxPalier={mapLayers.setBattleMaxPalier}
        carreauxVisible={mapLayers.carreauxVisible}
        carreauxLoaded={mapLayers.carreauxLoaded}
        carreauxLabel={mapLayers.carreauxLabel}
        carreauxIndicateur={mapLayers.carreauxIndicateur}
        carreauxPalette={mapLayers.carreauxPalette}
        carreauxOpacity={mapLayers.carreauxOpacity}
        carreauxRange={mapLayers.carreauxRange}
        carreauxSelectedBucket={mapLayers.carreauxSelectedBucket}
        setCarreauxVisible={mapLayers.setCarreauxVisible}
        setCarreauxIndicateur={mapLayers.setCarreauxIndicateur}
        setCarreauxPalette={mapLayers.setCarreauxPalette}
        setCarreauxOpacity={mapLayers.setCarreauxOpacity}
        setCarreauxSelectedBucket={mapLayers.setCarreauxSelectedBucket}
        selectedBillboard={selectedBillboard}
        closeBillboardDrawer={() => setSelectedBillboard(null)}
        mapStyleUrl={mapStyleUrl}
        mapStyles={MAP_STYLES as unknown as { id: string; label: string; url: string }[]}
        onMapStyleChange={handleMapStyleChange}
      />

          {/* Résidus de corrélation — légende flottante */}
          {residualsMeta && (
            <div style={{
              position: 'absolute', bottom: 44, left: 12, zIndex: 100,
              background: 'rgba(5,5,5,0.92)',
              border: '1px solid #1a1a1a',
              borderRadius: 2,
              padding: '10px 12px',
              minWidth: 200,
              fontFamily: "'JetBrains Mono','Fira Mono',monospace",
            }}>
              {/* Titre */}
              <div style={{ fontFamily: "'JetBrains Mono','Fira Mono',monospace", fontSize: 7, letterSpacing: '0.14em', color: '#4ecdc4', marginBottom: 6 }}>
                RÉSIDUS — {residualsMeta.catLabel.toUpperCase()} × {residualsMeta.metLabel.toUpperCase()}
              </div>

              {/* Labels légende — inversés si residualInverted */}
              {(residualInverted
                ? [
                    { color: '#ef4444', label: 'Très sur-équipé' },
                    { color: '#f97316', label: 'Sur-équipé' },
                    { color: '#fbbf24', label: 'Léger excédent' },
                    { color: '#e2e8f0', label: 'Dans la norme' },
                    { color: '#86efac', label: 'Léger déficit' },
                    { color: '#22c55e', label: 'Sous-équipé' },
                    { color: '#059669', label: 'Très sous-équipé' },
                  ]
                : [
                    { color: '#ef4444', label: 'Très sous-équipé' },
                    { color: '#f97316', label: 'Sous-équipé' },
                    { color: '#fbbf24', label: 'Léger déficit' },
                    { color: '#e2e8f0', label: 'Dans la norme' },
                    { color: '#86efac', label: 'Léger excédent' },
                    { color: '#22c55e', label: 'Sur-équipé' },
                    { color: '#059669', label: 'Très sur-équipé' },
                  ]
              ).map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 10, height: 10, background: color, borderRadius: 1, flexShrink: 0, opacity: 0.85 }} />
                  <span style={{ fontSize: 8.5, color: '#8888aa' }}>{label}</span>
                </div>
              ))}

              {/* Séparateur */}
              <div style={{ borderTop: '1px solid #1a1a1a', marginTop: 8, paddingTop: 8 }}>

                {/* Slider opacité */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                  <span style={{ fontFamily: "'JetBrains Mono','Fira Mono',monospace", fontSize: 7, letterSpacing: '0.1em', color: '#6b7280', whiteSpace: 'nowrap' }}>
                    OPACITÉ
                  </span>
                  <input
                    type="range" min={0.1} max={1} step={0.05}
                    value={residualOpacity}
                    onChange={e => handleResidualOpacity(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: '#4ecdc4', cursor: 'pointer', height: 4 }}
                  />
                  <span style={{ fontSize: 8, color: '#6b7280', minWidth: 28, textAlign: 'right' }}>
                    {Math.round(residualOpacity * 100)}%
                  </span>
                </div>

                {/* Toggle inversion */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 8.5, color: '#8888aa' }}>Inverser couleurs</span>
                  <button
                    onClick={() => handleResidualInvert(!residualInverted)}
                    style={{
                      position: 'relative',
                      width: 32, height: 16,
                      background: residualInverted ? '#4ecdc4' : '#1a1a1a',
                      border: `1px solid ${residualInverted ? '#4ecdc4' : '#262626'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'background 150ms, border-color 150ms',
                      flexShrink: 0,
                      padding: 0,
                    }}
                    title={residualInverted ? 'Rouge = excédent' : 'Rouge = déficit'}
                  >
                    <span style={{
                      position: 'absolute',
                      top: 2, left: residualInverted ? 16 : 2,
                      width: 10, height: 10,
                      background: '#fff',
                      borderRadius: '50%',
                      transition: 'left 150ms',
                    }} />
                  </button>
                </div>
                <div style={{ fontSize: 7.5, color: '#666666', marginBottom: 6 }}>
                  Rouge = {residualInverted ? 'excédent' : 'déficit'}
                </div>
              </div>

              {/* Stats */}
              <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: 6, fontSize: 8, color: '#666666' }}>
                {residualsMeta.n.toLocaleString('fr')} IRIS · r = {residualsMeta.r >= 0 ? '+' : ''}{residualsMeta.r.toFixed(2)}
              </div>

              {/* Masquer */}
              <button
                onClick={() => handleShowResiduals(null)}
                style={{
                  marginTop: 6, width: '100%', padding: '4px 0',
                  background: 'transparent', border: '1px solid #262626',
                  borderRadius: 2, color: '#666666', fontFamily: "'JetBrains Mono','Fira Mono',monospace",
                  fontSize: 7, letterSpacing: '0.1em', cursor: 'pointer',
                }}
              >
                ✕ MASQUER
              </button>
            </div>
          )}

          {/* Scoring OOH panel — déplacé dans l'onglet EXPERT > ANALYSE > accordéon Scoring OOH */}

          {/* Welcome overlay — affiché au premier chargement, par-dessus la carte */}
          <WelcomeOverlay sendMessage={chat.sendMessage} />

          {/* IRIS detail panel — overlay à droite sur la carte */}
          {(selectedIrisData || irisDetailLoading) && (
            <div style={{
              position: 'absolute', top: 0, right: 0, bottom: 0,
              width: 320, zIndex: 50,
              boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
            }}>
              <IrisDetailPanel
                data={selectedIrisData ?? { code_iris: selectedIrisCode ?? '', nom_iris: null, code_commune: null, code_dept: null, is_true_iris: null }}
                loading={irisDetailLoading}
                onClose={() => { setSelectedIrisCode(null); setSelectedIrisData(null); }}
              />
            </div>
          )}
        </div>

        {/* Study dashboard — lazy, affiché quand onglet Étude */}
        {activeTab === 'study' && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#060608' }}>
            <StudyDashboard
              ville={studyVille}
              onPanneauClick={(lat, lng) => {
                setActiveTab('map');
                setTimeout(() => handleFlyTo(lat, lng, 17), 80);
              }}
            />
          </div>
        )}
      </div>{/* end right panel */}

      <style>{`
        @keyframes mapSlide {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(250%); }
          100% { transform: translateX(250%); }
        }
        @keyframes mapFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .maplibregl-popup-content {
          background:#0a0a0a!important;border:0.5px solid #1a1a1a!important;padding:0!important;
          border-radius:6px!important;animation:mapFadeIn 0.15s ease-out!important;
        }
        .maplibregl-popup-tip {
          border-top-color:#0a0a0a!important;border-bottom-color:#0a0a0a!important;
        }
        .topbar-tab { overflow: visible !important; }
        @media (prefers-reduced-motion: reduce) {
          *, .topbar-tab span { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>
    </div>
  );
}
