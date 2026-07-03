'use client';

/**
 * @file app/map/page.tsx — page principale carte MAGELIAN
 * @size ~2329 lignes (cf docs/known_tech_debt.md — refactor planifié,
 *       non splitté en A4.6.2 par décision produit pour réduire le risque pitch)
 *
 * @sections internes (ordre approximatif)
 *   1. Imports + dynamic loaders         (≈ 1-90)
 *   2. Helpers (esc, normToColor, …)     (≈ 91-230)
 *   3. State management (~70 useState)   (≈ 231-450)
 *   4. URL search params handlers (?customZone, ?layer=digital) (≈ 451-700)
 *   5. POI / battle / voronoi handlers   (≈ 701-1300)
 *   6. Cluster + radio + meteo handlers  (≈ 1301-1600)
 *   7. Render JSX (IconBar + OverlayPanel + ResultsPanel + StudyDashboard) (≈ 1601-2329)
 *
 * @maintainers Pour étendre ce fichier :
 *   - NE PAS ajouter d'autres `useState` au top — extraire dans un hook
 *     dédié (ex: useBattleState(), useRadioState())
 *   - Les overlays (IconBar items) sont déjà bien isolés dans
 *     `components/map/overlays/`
 *   - Lire docs/known_tech_debt.md avant refactor structurel
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { adminFetch } from '@/lib/admin-fetch';
import { downloadZoneExport } from '@/lib/custom-geo/download-export';
import { circleGeoJSON, getCatColor, MAP_STYLES, MAP_STYLE } from '@/app/copilote/_lib/constants';
import { useMapInit }          from '@/app/copilote/_hooks/useMapInit';
import { useMeteoData }        from '@/lib/meteo/use-meteo-data';
import { buildColorExpression as buildMeteoColorExpr } from '@/lib/meteo/palettes';
import { METEO_LABEL, METEO_UNIT, type MeteoParams, type MeteoScale } from '@/lib/meteo/types';
const MeteoGeoPanel = dynamic(
  () => import('@/app/map/analyse/digital/_components/MeteoGeoPanel').then(m => ({ default: m.MeteoGeoPanel })),
  { ssr: false },
);
import { useSavedMaps }        from '@/app/copilote/_hooks/useSavedMaps';
import { useMapLayers }        from '@/app/copilote/_hooks/useMapLayers';
import { useChatControls }     from '@/app/copilote/_hooks/useChatControls';
import { useRateLimitHandler } from '@/app/copilote/_hooks/useRateLimitHandler';
import { useToolProcessor, type CorrelationActionParams } from '@/app/copilote/_hooks/useToolProcessor';
import { useProviderSelector } from '@/app/copilote/_hooks/useProviderSelector';
import { MapPanel }            from '@/app/copilote/_components/MapPanel';
import { FilterPanel, DIGITAL_PALETTES } from '@/app/map/_components/FilterPanel';
import type { DirectPOISearchParams, DirectBattleParams, DirectBattleV2Params, FillIsochroneCacheParams, POIStylesMap } from '@/app/map/_components/FilterPanel';
import { IrisDetailPanel }    from '@/app/map/_components/IrisDetailPanel';
import type { IrisDetailData } from '@/app/map/_components/IrisDetailPanel';
import type { ResidualsMeta, ResidualData } from '@/app/map/_components/CorrelationPanel';
import type { ClusterGeoJSON } from '@/app/map/_components/ClusterPanel';
import { CaptureLayers } from '@/app/map/_components/CaptureLayers';
import { CivicIndicatorsLayer, type CivicVariableCode } from '@/app/map/_components/CivicIndicatorsLayer';
import { CivicHealthMapLayer } from '@/app/map/_components/CivicHealthMapLayer';
import dynamic from 'next/dynamic';
const StudyDashboard = dynamic(
  () => import('@/app/map/_components/StudyDashboard').then(m => ({ default: m.StudyDashboard })),
  { ssr: false },
);
const TripleMapView = dynamic(
  () => import('@/components/digital/TripleMapView').then(m => ({ default: m.TripleMapView })),
  { ssr: false },
);
const DigitalAnalysisPanel = dynamic(
  () => import('@/components/digital/AnalysisPanelSwitch').then(m => ({ default: m.AnalysisPanelSwitch })),
  { ssr: false },
);
import type { ZoneData, BattleResult } from '@/types/spatial';
import { exportOohReport, type OohExportData } from '@/app/copilote/_lib/ooh-export';
import { ChatPanel }       from '@/app/copilote/_components/ChatPanel';
import { SessionBadge }    from '@/components/SessionBadge';
import { ThemeToggle }     from '@/components/ThemeToggle';
import { IconBar, type OverlayId } from '@/components/map/IconBar';
import { MapTopBar, MAP_TOPBAR_HEIGHT } from '@/components/map/MapTopBar';
import { OverlayPanel } from '@/components/map/OverlayPanel';
import { ResultsPanel, type ResultsPanelType } from '@/components/map/ResultsPanel';
import { AIOverlay } from '@/components/map/overlays/AIOverlay';
import { SettingsOverlay } from '@/components/map/overlays/SettingsOverlay';
import { ZonesOverlay } from '@/components/map/overlays/ZonesOverlay';
import { PilotageOverlay } from '@/components/map/overlays/PilotageOverlay';
const ClusteringResultsContent = dynamic(
  () => import('@/components/map/ClusteringResultsContent').then(m => ({ default: m.ClusteringResultsContent })),
  { ssr: false },
);
const CoverageResultsPanel = dynamic(
  () => import('@/components/CoverageResultsPanel').then(m => ({ default: m.CoverageResultsPanel })),
  { ssr: false },
);
const CorrelationPanelDyn = dynamic(
  () => import('@/app/map/_components/CorrelationPanel').then(m => ({ default: m.CorrelationPanel })),
  { ssr: false },
);
const ScoringPanel = dynamic(
  () => import('@/app/map/_components/ScoringPanel').then(m => ({ default: m.ScoringPanel })),
  { ssr: false },
);
import { Maximize2, Minimize2, Eraser, FileDown } from 'lucide-react';
import type { POI } from '@/types/poi';
import type { SelectedBillboard } from '@/types/map';

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
  const [activeStudy, setActiveStudy] = useState(false);
  const handleOpenStudy = useCallback(() => {
    setActiveStudy(true);
    setActiveOverlay(null);
    setActiveResults(null);
  }, []);
  const handleCloseStudy = useCallback(() => {
    setActiveStudy(false);
  }, []);
  const [iconBarHidden, setIconBarHidden] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<OverlayId | null>(null);
  const handleOverlayToggle = useCallback((id: OverlayId) => {
    setActiveOverlay(prev => prev === id ? null : id);
  }, []);
  // ── Results panel (volet gauche pour les analyses) ──
  const [activeResults, setActiveResults] = useState<ResultsPanelType | null>(null);
  const [coverageReady, setCoverageReady] = useState(false);
  // POI sélectionnés : lifted ici pour persistance entre fermeture/réouverture overlay
  // (sinon le state local de FilterPanel se perd → analyses bloquées par le check exactlyOnePOI)
  const [selectedPOI, setSelectedPOI] = useState<string[]>([]);
  // Périmètre territorial : même lift (filtre dept/région doit survivre au cycle
  // mount/unmount des overlays — sinon Bataille V2 ignore le filtre user)
  const [perimeterScope,           setPerimeterScope]           = useState<'metro' | 'all' | null>(null);
  const [perimeterSelectedRegions, setPerimeterSelectedRegions] = useState<string[]>([]);
  const [perimeterSelectedDepts,   setPerimeterSelectedDepts]   = useState<string[]>([]);
  const [perimeterVille,           setPerimeterVille]           = useState('');
  const handleOpenAnalysisResults = useCallback((type: ResultsPanelType) => {
    setActiveResults(type);
    setActiveOverlay(null);
  }, []);
  const handleCloseResults = useCallback(() => {
    setActiveResults(null);
  }, []);
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
  // Masquer les axes <5 000 véh/j par défaut pour limiter la densité visuelle
  // et alléger le rendu (tier 5-6 = ~80% des tronçons en France).
  const [tmjaHideLowTraffic, setTmjaHideLowTraffic] = useState(true);

  // Météo — choroplèthe par zones admin (Open-Meteo, polygones dép./régions)
  const [meteoVisible, setMeteoVisible] = useState(false);
  const [meteoPanelOpen, setMeteoPanelOpen] = useState(false);
  const [meteoZones, setMeteoZones] = useState<GeoJSON.FeatureCollection | null>(null);
  const meteoZonesCacheRef = useRef<Record<string, GeoJSON.FeatureCollection>>({});
  // Indicateurs civiques : variable INSEE active sur le layer choroplèthe par CP
  // (sous-section "Indicateurs civiques" dans Données terrain). null = layer désactivé.
  const [civicVariableCode, setCivicVariableCode] = useState<CivicVariableCode>(null);
  // Santé environnementale : choroplèthe allergènes ou qualité de l'air (Atmo France)
  const [civicHealthLayer, setCivicHealthLayer] = useState<'pollen' | 'atmo' | null>(null);
  const [civicProgress, setCivicProgress] = useState<{ done: number; total: number } | null>(null);
  const [civicLoading, setCivicLoading] = useState(false);
  const [civicScale, setCivicScale] = useState<'departement' | 'cp'>('departement');
  const [civicMetric, setCivicMetric] = useState('global');
  const [civicMinLevel, setCivicMinLevel] = useState(0);
  const [civicCpStatus, setCivicCpStatus] = useState<'ok' | 'no_data' | null>(null);
  const [civicCpDate, setCivicCpDate] = useState<string | null>(null);
  const [civicRefreshKey, setCivicRefreshKey] = useState(0);
  // Radio FM/DAB+ — émetteurs
  const [radioVisible,       setRadioVisible]       = useState(false);
  const [radioHeatmapMode,   setRadioHeatmapMode]   = useState(false);
  const [radioCoverageMode,  setRadioCoverageMode]  = useState(false);
  const [radioGeoJSON,       setRadioGeoJSON]       = useState<GeoJSON.FeatureCollection | null>(null);
  // Filtres multi-radios (dropdown searchable) + exclusions catégories
  const [radioFilterIds,         setRadioFilterIds]         = useState<string[]>([]);
  const [radioExcludeCategories, setRadioExcludeCategories] = useState<string[]>([]);
  const [radioFilterOptions,     setRadioFilterOptions]     = useState<{
    radios: Array<{ id: string; nom: string; cat: string | null }>;
    categories: Array<{ value: string; label: string }>;
  } | null>(null);
  const [radioLoading,       setRadioLoading]       = useState(false);
  const [radioSystemeFilter, setRadioSystemeFilter] = useState('');
  const [radioSelectedId,    setRadioSelectedId]    = useState<string | null>(null);
  const [radioSelectedNom,   setRadioSelectedNom]   = useState<string | null>(null);
  const [radioCoverageColor, setRadioCoverageColor] = useState('#4ecdc4');
  const [radioCoverageOpacity, setRadioCoverageOpacity] = useState(15);
  const [radioBorderWidth,   setRadioBorderWidth]   = useState(0.5);
  const [radioPointSize,     setRadioPointSize]     = useState(5);
  // Digital (DSP impressions choropleth)
  const [digitalVisible, setDigitalVisible] = useState(false);
  const [digitalLoading, setDigitalLoading] = useState(false);
  const [digitalStats, setDigitalStats] = useState<{ total_impressions: number; zones_count: number; campaign_name: string } | null>(null);
  // 'plasma' par défaut pour la vue fusionnée (cohérent avec TripleMapView
  // en vue comparée). Picker retiré de l'overlay Campagnes — les 3 cartes
  // de la vue comparée ont leur propre picker en header.
  const [digitalPalette, setDigitalPalette] = useState('plasma');
  const [digitalInverted, setDigitalInverted] = useState(false);
  const [digitalScale, setDigitalScale] = useState('region');
  const [digitalCompareView, setDigitalCompareView] = useState(true);
  const [digitalAnalysisOpen, setDigitalAnalysisOpen] = useState(false);
  const [digitalAnalysisClosing, setDigitalAnalysisClosing] = useState(false);
  const [digitalAnalysisSize, setDigitalAnalysisSize] = useState<'half' | 'full'>('half');
  const closeDigitalAnalysis = useCallback(() => {
    if (digitalAnalysisClosing) return;
    setDigitalAnalysisClosing(true);
    setTimeout(() => {
      setDigitalAnalysisOpen(false);
      setDigitalAnalysisSize('half');
      setDigitalAnalysisClosing(false);
    }, 200);
  }, [digitalAnalysisClosing]);
  const [digitalCampaignId, setDigitalCampaignId] = useState('');
  const [digitalPopField, setDigitalPopField] = useState('population');

  // Auto-activate Digital layer from sidebar shortcut (?layer=digital)
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get('layer') === 'digital') {
      setDigitalVisible(true);
    }
  }, [searchParams]);

  // Pré-ouverture de l'overlay Pilotage ML depuis ?overlay=pilotage&action=...
  // Utilisé par CustomBiddingBar (digital) et StrategyHeader (custom-bidding) pour
  // remplacer leurs anciens redirects vers /strategies/* (lesquelles n'existent plus).
  const [pilotageInitialAction, setPilotageInitialAction] = useState<
    | { type: 'new'; campaignId: string; draftId?: string }
    | { type: 'edit'; strategyId: string }
    | { type: 'history'; strategyId: string }
    | null
  >(null);
  useEffect(() => {
    if (searchParams.get('overlay') !== 'pilotage') return;
    const action = searchParams.get('action');
    const campaignId = searchParams.get('campaign');
    const strategyId = searchParams.get('strategy');
    const draftId = searchParams.get('draft') ?? undefined;
    setActiveOverlay('pilotage');
    if (action === 'new' && campaignId) {
      setPilotageInitialAction({ type: 'new', campaignId, draftId });
    } else if (action === 'edit' && strategyId) {
      setPilotageInitialAction({ type: 'edit', strategyId });
    } else if (action === 'history' && strategyId) {
      setPilotageInitialAction({ type: 'history', strategyId });
    }
  }, [searchParams]);

  const digitalPercentilesRef = useRef<number[]>([]);
  const digitalCampaignIdRef = useRef<string>('');

  const radioFetchRef = useRef<AbortController | null>(null);
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

  // ── Esc : si IconBar masquée, la ré-afficher (priorité basse — OverlayPanel Esc gère en premier) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && iconBarHidden) { setIconBarHidden(false); e.preventDefault(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [iconBarHidden]);

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

  // ── Sync TMJA visibility + filtre seuil bas → layer (vector tiles) ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try {
      map.setLayoutProperty('tmja-lines', 'visibility', tmjaGeoJSON ? 'visible' : 'none');
      map.setFilter(
        'tmja-lines',
        tmjaHideLowTraffic ? ['>=', ['get', 'tmja'], 5000] : null,
      );
    } catch { /* */ }
  }, [tmjaGeoJSON, tmjaHideLowTraffic, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Météo : hook data + sync source GeoJSON → choroplèthe zones admin ─────
  const meteo = useMeteoData();

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('meteo-source') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const setMeteoLayersVisibility = (visible: boolean) => {
      try {
        map.setLayoutProperty('meteo-fill', 'visibility', visible ? 'visible' : 'none');
        map.setLayoutProperty('meteo-outline', 'visibility', visible ? 'visible' : 'none');
      } catch { /* */ }
    };

    if (meteo.data && meteo.meta && meteoZones) {
      const features: GeoJSON.Feature[] = [];
      for (const f of meteoZones.features) {
        const code = String(f.properties?.code ?? '');
        const v = meteo.data[code];
        if (!v) continue;
        features.push({
          ...f,
          properties: {
            ...f.properties,
            weather_value: v.value,
            label: v.label,
            unit: v.unit,
          },
        });
      }
      src.setData({ type: 'FeatureCollection', features });
      try {
        map.setPaintProperty('meteo-fill', 'fill-color',
          buildMeteoColorExpr(meteo.meta.variable, meteo.meta.stats, 'weather_value') as maplibregl.ExpressionSpecification,
        );
      } catch { /* */ }
      setMeteoLayersVisibility(meteoVisible);
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
      setMeteoLayersVisibility(false);
    }
  }, [meteo.data, meteo.meta, meteoZones, meteoVisible, mapReady]);

  // Popup au clic sur une zone météo (nom + valeur + label qualitatif)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as { nom?: string; weather_value?: number; unit?: string; label?: string };
      const value = p.weather_value != null ? Number(p.weather_value) : null;
      new maplibregl.Popup({ closeButton: false, maxWidth: '240px' })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-family:Inter,sans-serif;font-size:12px;color:var(--text-primary)">` +
          `<div style="font-weight:500;margin-bottom:2px">${p.nom ?? ''}</div>` +
          (value != null
            ? `<div style="font-family:'JetBrains Mono',monospace;color:var(--text-secondary)">${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${p.unit ?? ''}</div>`
            : '') +
          (p.label ? `<div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">${p.label}</div>` : '') +
          `</div>`,
        )
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', 'meteo-fill', onClick);
    map.on('mouseenter', 'meteo-fill', onEnter);
    map.on('mouseleave', 'meteo-fill', onLeave);
    return () => {
      map.off('click', 'meteo-fill', onClick);
      map.off('mouseenter', 'meteo-fill', onEnter);
      map.off('mouseleave', 'meteo-fill', onLeave);
    };
  }, [mapReady]);

  // Charge les polygones de zones (cache mémoire par échelle + cache 1j navigateur)
  const ensureMeteoZones = useCallback(async (scale: MeteoScale) => {
    const cached = meteoZonesCacheRef.current[scale];
    if (cached) { setMeteoZones(cached); return; }
    try {
      const res = await adminFetch(`/api/meteo-geo/zones?scale=${scale}`, { cache: 'force-cache' });
      if (!res.ok) return;
      const fc = await res.json() as GeoJSON.FeatureCollection;
      meteoZonesCacheRef.current[scale] = fc;
      setMeteoZones(fc);
    } catch { /* */ }
  }, []);

  const handleMeteoApply = useCallback(async (params: MeteoParams) => {
    // Granularité choisie par l'utilisateur ; fallback heuristique par durée
    // pour les appels sans scale (compatibilité).
    const days = (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / 86400000;
    const scale: MeteoScale = params.scale ?? (days > 30 ? 'region' : 'departement');
    // Mode cp : le viewport restreint les zones interrogées (CP exacts si la
    // vue en contient ≤ 500, sinon échantillonnage spatial côté serveur).
    let bbox: string | undefined;
    if (scale === 'cp') {
      const b = mapRef.current?.getBounds();
      if (b) bbox = `${b.getWest().toFixed(3)},${b.getSouth().toFixed(3)},${b.getEast().toFixed(3)},${b.getNorth().toFixed(3)}`;
    }
    await ensureMeteoZones(scale);
    const ok = await meteo.fetch(scale, { ...params, bbox });
    if (ok) setMeteoVisible(true);
    return ok;
  }, [meteo, ensureMeteoZones]);

  const handleMeteoClear = useCallback(() => {
    meteo.clear();
    setMeteoVisible(false);
  }, [meteo]);

  // ── Digital: GeoJSON source + layers ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getSource('digital-cp')) return; // already added

    map.addSource('digital-cp', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id: 'digital-cp-fill',
      type: 'fill',
      source: 'digital-cp',
      paint: {
        'fill-color': 'rgba(78, 205, 196, 0.06)',
        'fill-opacity': 0.8,
      },
      layout: { visibility: 'none' },
    });

    map.addLayer({
      id: 'digital-cp-line',
      type: 'line',
      source: 'digital-cp',
      paint: {
        'line-color': 'rgba(78, 205, 196, 0.35)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 9, 0.8, 12, 1.2] as unknown as maplibregl.ExpressionSpecification,
        'line-opacity': 0.6,
      },
      layout: { visibility: 'none' },
    });
  }, [mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Digital: visibility sync ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = digitalVisible ? 'visible' : 'none';
    if (map.getLayer('digital-cp-fill')) map.setLayoutProperty('digital-cp-fill', 'visibility', vis);
    if (map.getLayer('digital-cp-line')) map.setLayoutProperty('digital-cp-line', 'visibility', vis);
  }, [digitalVisible, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Digital: re-fetch when scale changes (if already visible) ───────────────
  useEffect(() => {
    if (!digitalVisible || !digitalCampaignIdRef.current) return;
    const cid = digitalCampaignIdRef.current;
    const map = mapRef.current;
    if (!map) return;

    setDigitalLoading(true);
    adminFetch(`/api/digital/${cid}/map?bbox=-5.5,41.0,10.0,51.5&scale=${digitalScale}`)
      .then(r => r.ok ? r.json() as Promise<GeoJSON.FeatureCollection> : null)
      .then(fc => {
        if (!fc) return;
        const src = map.getSource('digital-cp') as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(fc);

        const values = fc.features.map(f => Number(f.properties?.impressions) || 0).filter(v => v > 0).sort((a, b) => a - b);
        if (values.length > 0) {
          const pct = (p: number) => values[Math.floor(p * (values.length - 1))];
          digitalPercentilesRef.current = [pct(0.1), pct(0.25), pct(0.5), pct(0.75), pct(0.9), values[values.length - 1]];
        }

        const pal = DIGITAL_PALETTES.find(p => p.id === digitalPalette) ?? DIGITAL_PALETTES[0];
        const stops = digitalInverted ? [...pal.stops].reverse() : [...pal.stops];
        const pts = digitalPercentilesRef.current;
        const pairs: (string | number)[] = [];
        for (let i = 0; i < Math.min(stops.length, pts.length); i++) pairs.push(pts[i], stops[i]);
        map.setPaintProperty('digital-cp-fill', 'fill-color', [
          'case', ['==', ['to-number', ['get', 'impressions'], 0], 0], 'var(--border-subtle)',
          ['interpolate', ['linear'], ['to-number', ['get', 'impressions'], 0], ...pairs],
        ]);
        map.setPaintProperty('digital-cp-fill', 'fill-opacity', 0.7);

        const totalImp = values.reduce((a, b) => a + b, 0);
        setDigitalStats(prev => prev ? { ...prev, total_impressions: totalImp, zones_count: fc.features.length } : prev);
      })
      .finally(() => setDigitalLoading(false));
  }, [digitalScale]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Digital: apply palette when palette/inverted/percentiles change ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !digitalVisible) return;
    if (!map.getLayer('digital-cp-fill')) return;

    const pts = digitalPercentilesRef.current;
    if (pts.length < 6) return; // need percentiles

    const pal = DIGITAL_PALETTES.find(p => p.id === digitalPalette) ?? DIGITAL_PALETTES[0];
    const stops = digitalInverted ? [...pal.stops].reverse() : [...pal.stops];

    // Build interpolation: p10, p25, p50, p75, p90, max
    const pairs: (string | number)[] = [];
    for (let i = 0; i < Math.min(stops.length, pts.length); i++) {
      pairs.push(pts[i], stops[i]);
    }

    map.setPaintProperty('digital-cp-fill', 'fill-color', [
      'case',
      ['==', ['to-number', ['get', 'impressions'], 0], 0], 'var(--border-subtle)',
      ['interpolate', ['linear'], ['to-number', ['get', 'impressions'], 0],
        ...pairs,
      ],
    ]);
    map.setPaintProperty('digital-cp-fill', 'fill-opacity', 0.7);
  }, [digitalPalette, digitalInverted, digitalVisible, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Digital: hover popup ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !digitalVisible) return;

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '260px' });
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; popup.remove(); };
    const onMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return;
      const p = e.features[0].properties;
      popup.setLngLat(e.lngLat).setHTML(`
        <div style="font-family:Inter,sans-serif;font-size:11px;color:var(--text-primary);background:var(--bg-surface);padding:8px 10px;border-radius:6px;border:0.5px solid var(--border-default)">
          <div style="font-weight:500;margin-bottom:4px">${esc(p.code)} — ${esc(p.nom)}</div>
          <div style="color:var(--text-secondary)">Impressions: <span style="color:var(--brand-teal);font-family:'JetBrains Mono',monospace">${Number(p.impressions).toLocaleString('fr-FR')}</span></div>
          ${p.pop_total ? `<div style="color:var(--text-secondary)">Population: <span style="color:var(--text-primary);font-family:'JetBrains Mono',monospace">${Number(p.pop_total).toLocaleString('fr-FR')}</span></div>` : ''}
          ${p.imp_pour_mille ? `<div style="color:var(--text-secondary)">Imp./1000 hab: <span style="color:var(--brand-teal);font-family:'JetBrains Mono',monospace">${Number(p.imp_pour_mille).toLocaleString('fr-FR')}</span></div>` : ''}
        </div>
      `).addTo(map);
    };

    map.on('mouseenter', 'digital-cp-fill', onEnter);
    map.on('mouseleave', 'digital-cp-fill', onLeave);
    map.on('mousemove', 'digital-cp-fill', onMove);
    return () => {
      map.off('mouseenter', 'digital-cp-fill', onEnter);
      map.off('mouseleave', 'digital-cp-fill', onLeave);
      map.off('mousemove', 'digital-cp-fill', onMove);
      popup.remove();
    };
  }, [digitalVisible, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const matchExpr: unknown[] = ['match', ['get', 'code_iris']];
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
        minzoom: 2,
        paint: {
          'fill-color':   matchExpr as unknown as maplibregl.ExpressionSpecification,
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
        .setHTML(`<div style="font-family:system-ui;font-size:13px;line-height:1.5;color:var(--text-primary);padding:12px;">
          <strong style="font-size:12px;color:var(--brand-teal);">${String(props.nom_iris ?? d.nom_iris ?? codeIris)}</strong>
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px;">${String(props.code_dept ?? '')} · ${codeIris}</div>
          <div style="font-size:18px;font-weight:700;color:${statusColor};margin-bottom:6px;">${status} (${sign}${d.residual.toFixed(2)})</div>
          <div style="font-size:11px;color:var(--text-secondary);">
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
    const matchExpr: unknown[] = ['match', ['get', 'code_iris']];
    residualLookupRef.current.forEach((r, code) => {
      matchExpr.push(code, normToColor(r.norm, inverted));
    });
    matchExpr.push('transparent');
    map.setPaintProperty('iris-residuals-fill', 'fill-color', matchExpr as unknown as maplibregl.ExpressionSpecification);
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

  // ── Toggle TMJA (vector tiles : affichage instantané, lazy par viewport) ───
  // On garde un FeatureCollection vide en sentinel pour réutiliser la prop
  // tmjaVisible existante côté FilterPanel et CaptureLayers — la vraie data
  // est servie par les tiles MVT via la source vector tmja-source.
  const handleLoadTMJA = async () => {
    setTmjaGeoJSON({ type: 'FeatureCollection', features: [] });
  };

  // ── Radio filter options — fetch lazy (au 1er toggle radio) ───────────────
  // L'API renvoie {categories, groupes, radios_with_emetteurs} ; on transforme
  // au shape attendu par FilterPanel : {categories, radios}.
  useEffect(() => {
    if (!radioVisible || radioFilterOptions) return;
    let aborted = false;
    adminFetch('/api/radio/filter-options')
      .then(r => r.ok ? r.json() : null)
      .then((data: { categories?: Array<{ value: string; label: string }>; radios_with_emetteurs?: Array<{ id: string; nom: string; cat: string | null }> } | null) => {
        if (aborted || !data) return;
        setRadioFilterOptions({
          categories: Array.isArray(data.categories) ? data.categories : [],
          radios:     Array.isArray(data.radios_with_emetteurs) ? data.radios_with_emetteurs : [],
        });
      })
      .catch(() => {});
    return () => { aborted = true; };
  }, [radioVisible, radioFilterOptions]);

  // ── Radio émetteurs — fetch + sync ─────────────────────────────────────────
  const handleLoadRadio = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    setRadioLoading(true);
    radioFetchRef.current?.abort();
    const ctrl = new AbortController();
    radioFetchRef.current = ctrl;
    try {
      const params = new URLSearchParams();
      if (radioSelectedId) {
        // Une radio précise sélectionnée → tous ses émetteurs (sans bbox)
        params.set('radio_id', radioSelectedId);
      } else if (radioCoverageMode) {
        // Mode couverture (cercles) → fetch GLOBAL sans bbox.
        // Sinon les cercles disparaissent au zoom in : un émetteur dont le
        // centre sort du viewport perd son cercle alors que sa couverture
        // (rayon jusqu'à 54km) intersecte encore la zone visible.
        // 11k émetteurs ≈ 3-5MB GeoJSON, MapLibre gère sans souci.
        params.set('limit', '15000');
      } else {
        // Mode clusters/heatmap → fetch viewport bbox (rapide, dynamique)
        const b = map.getBounds();
        params.set('bbox', `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b.getNorth().toFixed(4)}`);
      }
      if (radioSystemeFilter) params.set('systeme', radioSystemeFilter);
      // Multi-radios filter (dropdown searchable) + exclusions catégories
      if (radioFilterIds.length > 0)         params.set('radio_ids', radioFilterIds.join(','));
      if (radioExcludeCategories.length > 0) params.set('exclude_categories', radioExcludeCategories.join(','));
      const res = await adminFetch(`/api/radio/emetteurs?${params}`, { signal: ctrl.signal });
      if (!res.ok) return;
      const data: GeoJSON.FeatureCollection = await res.json();
      setRadioGeoJSON(data);

      // FitBounds if specific radio selected
      if (radioSelectedId && data.features.length > 0) {
        let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
        for (const f of data.features) {
          if (f.geometry?.type === 'Point') {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        }
        if (minLng < maxLng) {
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, duration: 1000 });
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') console.error('[radio]', e);
    } finally {
      setRadioLoading(false);
    }
  }, [mapReady, radioSystemeFilter, radioSelectedId, radioFilterIds, radioExcludeCategories, radioCoverageMode]);

  // Sync radio GeoJSON → map source + layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const showClusters = radioVisible && !radioHeatmapMode;
    const showHeatmap  = radioVisible && radioHeatmapMode;
    const showPoints   = radioVisible && !radioHeatmapMode;

    // Update source data
    if (radioGeoJSON) {
      const src = map.getSource('radio-emetteurs') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(radioGeoJSON);
    }

    // Toggle layer visibility
    try { map.setLayoutProperty('radio-clusters', 'visibility', showClusters ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('radio-cluster-count', 'visibility', showClusters ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('radio-points', 'visibility', showPoints ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('radio-heatmap', 'visibility', showHeatmap ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('radio-coverage-fill', 'visibility', radioCoverageMode && radioVisible ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('radio-coverage-line', 'visibility', radioCoverageMode && radioVisible ? 'visible' : 'none'); } catch { /* */ }

    // Sync paint properties for controls
    try { map.setPaintProperty('radio-coverage-fill', 'fill-color', radioCoverageColor); } catch { /* */ }
    try { map.setPaintProperty('radio-coverage-fill', 'fill-opacity', radioCoverageOpacity / 100); } catch { /* */ }
    try { map.setPaintProperty('radio-coverage-line', 'line-color', radioCoverageColor); } catch { /* */ }
    try { map.setPaintProperty('radio-coverage-line', 'line-opacity', Math.min(radioCoverageOpacity / 100 + 0.2, 1)); } catch { /* */ }
    try { map.setPaintProperty('radio-coverage-line', 'line-width', radioBorderWidth); } catch { /* */ }

    // Point size + highlight mode
    if (radioSelectedId) {
      try {
        map.setPaintProperty('radio-points', 'circle-color', [
          'case', ['==', ['get', 'radio_id'], radioSelectedId], 'var(--brand-teal)', '#4b5563',
        ] as unknown as maplibregl.ExpressionSpecification);
        map.setPaintProperty('radio-points', 'circle-opacity', [
          'case', ['==', ['get', 'radio_id'], radioSelectedId], 1, 0.35,
        ] as unknown as maplibregl.ExpressionSpecification);
        map.setPaintProperty('radio-points', 'circle-radius', radioPointSize);
      } catch { /* */ }
    } else {
      try {
        map.setPaintProperty('radio-points', 'circle-color', [
          'match', ['get', 'portee'],
          'nationale', '#3b82f6', 'locale', '#22c55e', 'autoroute', '#eab308', '#6b7280',
        ] as unknown as maplibregl.ExpressionSpecification);
        map.setPaintProperty('radio-points', 'circle-opacity', 0.9);
        map.setPaintProperty('radio-points', 'circle-radius', radioPointSize);
      } catch { /* */ }
    }
  }, [radioGeoJSON, radioVisible, radioHeatmapMode, radioCoverageMode, mapReady, radioCoverageColor, radioCoverageOpacity, radioBorderWidth, radioPointSize, radioSelectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load radio data when visible — different strategy for selected radio vs global view
  const lastRadioBboxRef = useRef('');
  useEffect(() => {
    if (!radioVisible || !mapReady) return;
    handleLoadRadio();

    // Une radio précise OU mode couverture global → load once, pas de re-fetch
    // sur moveend (sinon la couverture clignote au zoom).
    if (radioSelectedId || radioCoverageMode) return;

    // Mode clusters/heatmap : reload on moveend avec debounce + check bbox
    const map = mapRef.current;
    if (!map) return;
    let timer: ReturnType<typeof setTimeout>;
    const debouncedMove = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const b = map.getBounds();
        const newBbox = `${b.getWest().toFixed(2)},${b.getSouth().toFixed(2)},${b.getEast().toFixed(2)},${b.getNorth().toFixed(2)}`;
        if (newBbox === lastRadioBboxRef.current) return; // bbox hasn't changed significantly
        lastRadioBboxRef.current = newBbox;
        handleLoadRadio();
      }, 600);
    };
    map.on('moveend', debouncedMove);
    return () => { map.off('moveend', debouncedMove); clearTimeout(timer); };
  }, [radioVisible, mapReady, radioSelectedId, radioCoverageMode, handleLoadRadio]);

  // Generate coverage circles client-side when coverage mode is active
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !radioCoverageMode || !radioGeoJSON) return;
    const src = map.getSource('radio-coverage') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    // Generate circles (limit to 500)
    const features = radioGeoJSON.features.slice(0, 500);
    const circles: GeoJSON.Feature[] = [];
    for (const f of features) {
      if (f.geometry.type !== 'Point') continue;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      const radius = Number((f.properties as Record<string, unknown>)?.rayon_couverture_m ?? 0);
      if (!radius || radius < 100) continue;
      // Simple circle approximation (64 segments)
      const coords: [number, number][] = [];
      for (let i = 0; i <= 64; i++) {
        const angle = (i / 64) * 2 * Math.PI;
        const dlat = (radius / 111320) * Math.cos(angle);
        const dlng = (radius / (111320 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);
        coords.push([lng + dlng, lat + dlat]);
      }
      circles.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { color: 'var(--brand-teal)' },
      });
    }
    src.setData({ type: 'FeatureCollection', features: circles });
  }, [radioGeoJSON, radioCoverageMode, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Tout effacer : vide toutes les couches et zones affichées sur la carte ──
  const handleClearAllLayers = useCallback(() => {
    const map = mapRef.current;

    // Markers de zone (POI + ville)
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Sources GeoJSON → collection vide (idempotent, couvre aussi les effets
    // qui ne nettoient pas la source quand leur donnée repasse à null)
    if (map) {
      const geojsonSources = [
        'pois-heat', 'zone-circle', 'wizard-highlight', 'meteo-source',
        'tmja-source', 'radio-emetteurs', 'radio-coverage', 'digital-cp',
        'voronoi', 'voronoi-pois', 'isochrones', 'battle-rings',
        'battle-borders', 'battle-pois', 'clusters-source', 'test-iso',
        'territory-mask',
      ];
      for (const id of geojsonSources) {
        const src = map.getSource(id);
        if (src && src.type === 'geojson') {
          (src as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
        }
      }

      // Zones custom affichées via l'overlay Zones (sources custom-zone-<id>
      // créées dynamiquement). Le panneau retombe sur ses pieds : « Masquer »
      // puis « Afficher » recréent la couche proprement.
      const style = map.getStyle();
      for (const sourceId of Object.keys(style.sources ?? {})) {
        if (!sourceId.startsWith('custom-zone-')) continue;
        const zoneId = sourceId.slice('custom-zone-'.length);
        for (const layerId of [`custom-zone-fill-${zoneId}`, `custom-zone-line-${zoneId}`]) {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
        }
        map.removeSource(sourceId);
      }
    }

    // Couches tuiles vectorielles (visibilité) et couches copilote
    mapLayers.setVoronoiVisible(false);
    mapLayers.setBattleVisible(false);
    mapLayers.setIsochroneVisible(false);
    mapLayers.setCarreauxVisible(false);
    mapLayers.setIrisVisible(false);

    // États de données de la page
    setZoneData(null);
    setBattleFeatures([]);
    setBattlePois([]);
    setBattleCacheKey(null);
    setClusterGeoJSON(null);
    setClustersVisible(false);
    setWizardHighlightGeoJSON(null);
    setTmjaGeoJSON(null);
    handleMeteoClear();
    setCivicVariableCode(null);
    setCivicHealthLayer(null);
    setCivicProgress(null);
    setRadioVisible(false);
    setRadioHeatmapMode(false);
    setRadioCoverageMode(false);
    setRadioSelectedId(null);
    setRadioSelectedNom(null);
    setDigitalVisible(false);
    setDigitalStats(null);
    setDigitalAnalysisOpen(false);
    setDigitalCampaignId('');
    setCorrelationParams(null);
    setResidualsMeta(null);
    setSelectedIrisCode(null);
    setSelectedIrisData(null);
    setSelectedBillboard(null);
    setActiveResults(null);

    // Périmètre territorial (masque affiché sur la carte)
    setPerimeterScope(null);
    setPerimeterSelectedRegions([]);
    setPerimeterSelectedDepts([]);
    setPerimeterVille('');
    setSelectedPOI([]);

    // Nettoie ?customZone= (et autres params) pour qu'un F5 ne recharge rien
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [mapLayers, handleMeteoClear, mapRef, markersRef]);

  // ── Charger une zone custom via ?customZone=<id> ──────────────────────────
  // Le polygon de la zone alimente le slot battleFeatures pour que Coverage,
  // Corrélation et autres analyses puissent l'exploiter exactement comme une
  // bataille d'isochrones (groupe unique, palier=1). Attend mapReady pour
  // s'assurer que la source MapLibre `battle-rings` est créée.
  const customZoneLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    const zoneId = searchParams.get('customZone');
    if (!zoneId || !mapReady) return;
    if (customZoneLoadedRef.current === zoneId) return;
    customZoneLoadedRef.current = zoneId;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/custom-geo/${zoneId}/geometry`);
        if (!res.ok) {
          console.warn('[map] customZone load failed', res.status);
          return;
        }
        const feature = await res.json() as {
          type: 'Feature';
          geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon;
          properties: { id: string; name: string };
        };
        if (cancelled || !feature?.geometry) return;
        const polys: GeoJSON.Position[][][] = feature.geometry.type === 'MultiPolygon'
          ? feature.geometry.coordinates
          : feature.geometry.type === 'Polygon'
          ? [feature.geometry.coordinates]
          : [];
        const cid = feature.properties.id;
        const nom = feature.properties.name ?? 'Zone personnalisée';
        const bf: GeoJSON.Feature[] = polys.length === 0
          ? [{
              type: 'Feature',
              geometry: feature.geometry,
              properties: { id: cid, cirfa_id: cid, nom, palier: 1 },
            }]
          : polys.map((coords, i) => ({
              type: 'Feature' as const,
              geometry: { type: 'Polygon', coordinates: coords } as GeoJSON.Polygon,
              properties: { id: cid, cirfa_id: cid, nom, palier: 1, _idx: i },
            }));
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        for (const ring of polys) {
          for (const lr of ring) {
            for (const [lng, lat] of lr) {
              if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
              if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
            }
          }
        }
        const hasBbox = Number.isFinite(minLng);
        const center = hasBbox
          ? { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 }
          : { lat: 46.5, lng: 2.5 };
        setBattleFeatures(bf);
        setBattlePois([{ id: cid, nom, categorie: 'custom_geo_zone', ...center }]);
        setBattleCacheKey(`cg__${cid}`);
        mapLayers.applyIsochroneBattle(
          { type: 'FeatureCollection', features: bf },
          null,
          'custom_geo_zone',
          [{ id: cid, nom, ...center }],
        );
        if (hasBbox && mapRef.current) {
          mapRef.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, duration: 1000 });
        }
      } catch (e) {
        console.error('[map] customZone load error', e);
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const hex = (firstCat && poiStyles[firstCat]?.color) ?? zoneData.couleur_overrides?.[firstCat ?? ''] ?? 'var(--brand-teal)';
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
          `<div style="font-size:12px;padding:6px 8px;color:var(--text-secondary)">` +
          (rankVal ? `<span style="color:#f59e0b;font-weight:700;font-size:13px">#${rankVal}</span> ` : '') +
          `<strong style="color:var(--text-primary);font-size:13px">${nom}</strong><br/>` +
          `<span style="color:${color};font-size:11px;font-weight:600;text-transform:uppercase">${esc(p.categorie)}</span>` +
          (p.sous_categorie ? ` <span style="color:var(--text-tertiary);font-size:11px">· ${esc(p.sous_categorie)}</span>` : '') +
          (audienceVal != null ? `<br/><span style="color:var(--success);font-size:12px;font-weight:600">+${Number(audienceVal).toLocaleString('fr-FR')} pers.</span>` : '') +
          (p.adresse ? `<br/><span style="color:var(--text-tertiary);font-size:11px">${esc(p.adresse)}</span>` : '') +
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
    cityEl.style.cssText = 'width:10px;height:10px;background:var(--brand-teal);border:2px solid #fff;border-radius:2px';
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
          filtre_depts:       params.filtre_depts    ?? null,
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
      const rawRings = (battleData!.battleGeoJSON.features as GeoJSON.Feature[])
        .filter((f) => !!f?.geometry)
        .map((f) => {
          const props = (f.properties ?? {}) as Record<string, unknown>;
          return {
            cirfa_id: String(props.cirfa_id ?? props.id ?? ''),
            nom:      String(props.nom ?? ''),
            lat:      Number(props.lat ?? 0),
            lng:      Number(props.lng ?? 0),
            palier:   Number(props.palier ?? 0),
            geojson:  f.geometry as object,
          };
        });
      mapLayers.clearBattlePartialRings();
      mapLayers.addBattlePartialRings(rawRings);
      setBattleFeatures(battleData!.battleGeoJSON.features);
    }
    // poisForMap peut être absent des anciens caches v3 — fallback depuis les ring features
    let poisForMap: { id: string; nom: string; lat: number; lng: number; categorie?: string; adresse?: string; ville?: string }[] = battleData!.poisForMap ?? [];
    if (poisForMap.length === 0 && battleData!.battleGeoJSON?.features?.length > 0) {
      const poisSeen = new Set<string>();
      for (const f of battleData!.battleGeoJSON.features as GeoJSON.Feature[]) {
        const p = (f?.properties ?? {}) as Record<string, unknown>;
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
      const poisAsPOI: POI[] = poisForMap.map(p => ({ ...p, categorie: p.categorie ?? params.category }));
      setBattlePois(poisAsPOI);
      setZoneData({
        coordonnees: { lat: poisForMap[0].lat, lng: poisForMap[0].lng },
        pois: poisAsPOI,
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
    const battleRings = ((battleData!.battleGeoJSON?.features ?? []) as GeoJSON.Feature[])
      .filter((f) => {
        const ft = (f?.properties as Record<string, unknown> | null)?.feature_type;
        return ft === 'ring' && !!f?.geometry;
      })
      .map((f) => {
        const props = (f.properties ?? {}) as Record<string, unknown>;
        return {
          cirfa_id: String(props.cirfa_id ?? props.id ?? ''),
          nom:      String(props.nom ?? ''),
          lat:      Number(props.lat ?? 0),
          lng:      Number(props.lng ?? 0),
          palier:   Number(props.palier ?? 0),
          geojson:  JSON.stringify(f.geometry),
        };
      });
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
          filtre_depts:      params.filtre_depts   ?? null,
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
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          if (evt.type === 'error') throw new Error(String(evt.message ?? 'Erreur inconnue').slice(0, 200));
          if (evt.type === 'partial_rings' && Array.isArray(evt.rings) && evt.rings.length > 0) {
            mapLayers.addBattlePartialRings(evt.rings as Parameters<typeof mapLayers.addBattlePartialRings>[0]);
            onProgress?.(`> ◆ +${(evt.rings as unknown[]).length} isochrones sur la carte`);
          } else if (evt.type === 'pois_loaded') {
            onProgress?.(`> ${evt.total} POIs trouvés — démarrage ORS...`);
          } else if (evt.type === 'progress') {
            if (evt.status === 'bataille_postgis') {
              onProgress?.('> [BATAILLE] ST_Difference en cours (PostGIS)...');
            } else {
              const completed = Number(evt.completed ?? 0);
              const total = Number(evt.total ?? 1);
              const pct    = Math.round((completed / total) * 100);
              const errCount = Number(evt.err ?? 0);
              const errInfo = errCount > 0 ? ` (${errCount} erreurs ORS)` : '';
              onProgress?.(`> ${completed}/${total} POIs traités — ${pct}%${errInfo}`);
            }
          }
          // result: on affiche juste les rings finaux si disponibles (pas de setZoneData)
          const evtData = evt.data as { battleGeoJSON?: { features?: GeoJSON.Feature[] } } | undefined;
          if (evt.type === 'result' && evtData?.battleGeoJSON?.features && evtData.battleGeoJSON.features.length > 0) {
            const rawRings = (evtData.battleGeoJSON.features as GeoJSON.Feature[])
              .filter((f) => !!f?.geometry)
              .map((f) => {
                const props = (f.properties ?? {}) as Record<string, unknown>;
                return {
                  cirfa_id: String(props.cirfa_id ?? props.id ?? ''),
                  nom:      String(props.nom ?? ''),
                  lat:      Number(props.lat ?? 0),
                  lng:      Number(props.lng ?? 0),
                  palier:   Number(props.palier ?? 0),
                  geojson:  f.geometry as object,
                };
              });
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
        let evt: Record<string, unknown>;
        try { evt = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        if (evt.type === 'error') {
          setError(`Bataille — ${evt.message}`);
          throw new Error(String(evt.message ?? 'Erreur inconnue'));
        }
        if (evt.type === 'progress') {
          onProgress?.(String(evt.message ?? ''), PCT[String(evt.step ?? '')] ?? 50);
        }
        if (evt.type === 'result') {
          const battleGeo = evt.battleGeoJSON as { features?: GeoJSON.Feature[] } | undefined;
          console.log('[handleApplyBattle] result received — nb_rings:', evt.nb_rings, '| features:', battleGeo?.features?.length);
          onProgress?.(`${evt.nb_rings} zones, ${evt.nb_borders} bordures`, 95);
          if (battleGeo?.features && battleGeo.features.length > 0) {
            mapLayers.applyIsochroneBattle(battleGeo as { type: string; features: GeoJSON.Feature[] }, (evt.battleBorders as { type: string; features: GeoJSON.Feature[] } | null) ?? null, category, poisForMap);
            setBattleFeatures(battleGeo.features);
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
      type BattleV2Result = {
        error?: string;
        battleGeoJSON?: { type: string; features: GeoJSON.Feature[] };
        poisForMap?: POI[];
      };
      let data: BattleV2Result | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          if (evt.type === 'error') throw new Error(String(evt.message ?? 'Erreur inconnue'));
          if (evt.type === 'result') { data = evt.data as BattleV2Result; continue; }
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
      if (data.battleGeoJSON?.features && data.battleGeoJSON.features.length > 0) {
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

  // ── Disponibilité des résultats d'analyses (badge dans CTA cards de l'overlay Analyses) ──
  const availableResults = useMemo(() => ({
    clustering:  !!clusterGeoJSON,
    coverage:    coverageReady,
    correlation: !!residualsMeta,
    scoring:     !!studyVille,
  }), [clusterGeoJSON, coverageReady, residualsMeta, studyVille]);

  // Chat slot partagé : utilisé par FilterPanel (legacy, tant que monté) et AIOverlay (nouveau)
  const chatSlotContent = (
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
          try { map.setFilter('iris-fill',   null); } catch { /* ok */ }
          try { map.setFilter('iris-border', null); } catch { /* ok */ }
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
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', background: 'var(--bg-primary)',
      paddingLeft: iconBarHidden ? 0 : 48,
      paddingTop: iconBarHidden ? 0 : MAP_TOPBAR_HEIGHT,
      transition: 'padding-left 200ms var(--ease-out), padding-top 200ms var(--ease-out)',
    }}>
      {!iconBarHidden && <MapTopBar />}
      <IconBar
        activeItem={activeOverlay}
        onItemClick={handleOverlayToggle}
        hidden={iconBarHidden}
        studyAvailable={!!studyVille}
      />
      {activeOverlay && (
        <OverlayPanel
          topOffset={iconBarHidden ? 0 : MAP_TOPBAR_HEIGHT}
          category={activeOverlay}
          width={activeOverlay === 'pilotage' ? 820 : undefined}
          expandable={activeOverlay === 'pilotage'}
          title={
            activeOverlay === 'ai' ? 'geo.prompt' :
            activeOverlay === 'perimeter' ? 'Périmètre' :
            activeOverlay === 'terrain' ? 'Données terrain' :
            activeOverlay === 'analyses' ? 'Analyses' :
            activeOverlay === 'campaigns' ? 'Campagnes média' :
            activeOverlay === 'pilotage' ? 'Pilotage ML' :
            activeOverlay === 'zones' ? 'Zones sauvegardées' :
            'Réglages'
          }
          dotColor={
            activeOverlay === 'ai' ? 'var(--brand-teal)' :
            activeOverlay === 'perimeter' ? 'var(--cat-context)' :
            activeOverlay === 'terrain' ? 'var(--cat-terrain)' :
            activeOverlay === 'analyses' ? 'var(--cat-analysis)' :
            activeOverlay === 'campaigns' ? 'var(--cat-media)' :
            activeOverlay === 'pilotage' ? 'var(--brand-teal)' :
            activeOverlay === 'zones' ? 'var(--brand-teal)' :
            'var(--text-tertiary)'
          }
          onClose={() => setActiveOverlay(null)}
        >
          {activeOverlay === 'ai' && <AIOverlay chatSlot={chatSlotContent} />}
          {(activeOverlay === 'perimeter' || activeOverlay === 'terrain' || activeOverlay === 'analyses' || activeOverlay === 'campaigns') && (
            <FilterPanel
              visibleCategory={activeOverlay}
              chatSlot={null}
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
              mainMapRef={mapRef}
              onScoreComputed={(v) => setStudyVille(v)}
              onLoadTransport={handleLoadTransport}
              onLoadTMJA={handleLoadTMJA}
              tmjaVisible={!!tmjaGeoJSON}
              tmjaHideLowTraffic={tmjaHideLowTraffic}
              onToggleTmjaHideLowTraffic={setTmjaHideLowTraffic}
              onOpenMeteo={() => setMeteoPanelOpen(true)}
              onClearMeteo={handleMeteoClear}
              meteoVisible={meteoVisible}
              meteoLabel={meteo.meta ? METEO_LABEL[meteo.meta.variable] : null}
              onClearTMJA={() => setTmjaGeoJSON(null)}
              civicVariableCode={civicVariableCode}
              onCivicVariableChange={setCivicVariableCode}
              selectedIrisCommuneCode={selectedIrisData?.code_commune ?? null}
              selectedIrisCommuneName={selectedIrisData?.nom_commune ?? null}
              civicHealthLayer={civicHealthLayer}
              onCivicHealthLayerChange={layer => {
                // Changer de couche remet la métrique sur l'indice global
                // (les métriques pollen/air ne se recouvrent pas)
                setCivicProgress(null);
                setCivicMetric('global');
                setCivicHealthLayer(layer);
              }}
              civicProgress={civicProgress}
              civicLoading={civicLoading}
              civicScale={civicScale}
              onCivicScaleChange={s => { setCivicProgress(null); setCivicScale(s); }}
              civicMetric={civicMetric}
              onCivicMetricChange={setCivicMetric}
              civicMinLevel={civicMinLevel}
              onCivicMinLevelChange={setCivicMinLevel}
              civicCpStatus={civicCpStatus}
              civicCpDate={civicCpDate}
              onCivicIngested={() => setCivicRefreshKey(k => k + 1)}
              onPondererCivicVariable={(code) => {
                // Ouvre Pilotage ML avec une nouvelle stratégie pré-réglée sur cette variable.
                // Pour l'instant on prend la 1ère campagne DSP éligible (TTD) comme campagne par défaut.
                setActiveOverlay('pilotage');
                setPilotageInitialAction({
                  type: 'new',
                  campaignId: '3e58e130-474d-4052-99b4-665c0a3efa85', // Renault Captur (Demo Pitch) — TTD éligible
                });
                void code;
              }}
              radioVisible={radioVisible}
              onToggleRadio={() => setRadioVisible(v => !v)}
              radioHeatmapMode={radioHeatmapMode}
              onToggleRadioHeatmap={() => setRadioHeatmapMode(v => !v)}
              radioCoverageMode={radioCoverageMode}
              onToggleRadioCoverage={() => setRadioCoverageMode(v => !v)}
              radioLoading={radioLoading}
              radioSystemeFilter={radioSystemeFilter}
              onRadioSystemeChange={v => { setRadioSystemeFilter(v); }}
              onSelectRadio={(id, nom) => { setRadioSelectedId(id); setRadioSelectedNom(nom); setRadioVisible(true); }}
              radioCount={radioGeoJSON?.features.length ?? 0}
              radioSelectedNom={radioSelectedNom}
              onClearRadioSelection={() => { setRadioSelectedId(null); setRadioSelectedNom(null); }}
              radioFilterOptions={radioFilterOptions}
              radioFilterIds={radioFilterIds}
              onRadioFilterIdsChange={setRadioFilterIds}
              radioExcludeCategories={radioExcludeCategories}
              onRadioExcludeCategoriesChange={setRadioExcludeCategories}
              radioCoverageColor={radioCoverageColor}
              onRadioCoverageColorChange={setRadioCoverageColor}
              radioCoverageOpacity={radioCoverageOpacity}
              onRadioCoverageOpacityChange={setRadioCoverageOpacity}
              radioBorderWidth={radioBorderWidth}
              onRadioBorderWidthChange={setRadioBorderWidth}
              radioPointSize={radioPointSize}
              onRadioPointSizeChange={setRadioPointSize}
              onRecenterFrance={() => { mapRef.current?.fitBounds([[-5.5, 41.3], [9.6, 51.1]], { padding: 20, duration: 1000 }); }}
              correlationParams={correlationParams}
              onShowResiduals={handleShowResiduals}
              digitalVisible={digitalVisible}
              digitalLoading={digitalLoading}
              digitalStats={digitalStats}
              digitalPalette={digitalPalette}
              onDigitalPaletteChange={setDigitalPalette}
              digitalInverted={digitalInverted}
              onDigitalInvertChange={setDigitalInverted}
              digitalScale={digitalScale}
              onDigitalScaleChange={setDigitalScale}
              onDigitalShowImpressions={async (campaignId: string) => {
                if (!campaignId) return;
                digitalCampaignIdRef.current = campaignId;
                setDigitalCampaignId(campaignId);
                setDigitalLoading(true);
                mapLayers.setIrisVisible(false);
                try {
                  const map = mapRef.current;
                  if (!map) return;
                  const res = await adminFetch(`/api/digital/${campaignId}/map?bbox=-5.5,41.0,10.0,51.5&scale=${digitalScale}`);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const fc = await res.json() as GeoJSON.FeatureCollection;
                  const src = map.getSource('digital-cp') as maplibregl.GeoJSONSource | undefined;
                  if (src) src.setData(fc);
                  const values = fc.features
                    .map(f => Number(f.properties?.impressions) || 0)
                    .filter(v => v > 0)
                    .sort((a, b) => a - b);
                  if (values.length > 0) {
                    const pct = (p: number) => values[Math.floor(p * (values.length - 1))];
                    digitalPercentilesRef.current = [pct(0.1), pct(0.25), pct(0.5), pct(0.75), pct(0.9), values[values.length - 1]];
                  } else {
                    digitalPercentilesRef.current = [0, 1, 10, 100, 1000, 10000];
                  }
                  const pal = DIGITAL_PALETTES.find(p => p.id === digitalPalette) ?? DIGITAL_PALETTES[0];
                  const stops = digitalInverted ? [...pal.stops].reverse() : [...pal.stops];
                  const pts = digitalPercentilesRef.current;
                  const pairs: (string | number)[] = [];
                  for (let i = 0; i < Math.min(stops.length, pts.length); i++) {
                    pairs.push(pts[i], stops[i]);
                  }
                  map.setPaintProperty('digital-cp-fill', 'fill-color', [
                    'case',
                    ['==', ['to-number', ['get', 'impressions'], 0], 0], 'var(--border-subtle)',
                    ['interpolate', ['linear'], ['to-number', ['get', 'impressions'], 0], ...pairs],
                  ]);
                  map.setPaintProperty('digital-cp-fill', 'fill-opacity', 0.7);
                  const totalImp = values.reduce((a, b) => a + b, 0);
                  const campRes = await adminFetch('/api/digital/campaigns');
                  const camps = campRes.ok ? await campRes.json() : [];
                  const campName = camps.find((c: { id: string; name: string }) => c.id === campaignId)?.name ?? '';
                  setDigitalStats({ total_impressions: totalImp, zones_count: fc.features.length, campaign_name: campName });
                  setDigitalVisible(true);
                } catch (err: unknown) {
                  console.error('[digital]', err);
                } finally {
                  setDigitalLoading(false);
                }
              }}
              onDigitalClear={() => {
                setDigitalVisible(false);
                setDigitalStats(null);
                setDigitalAnalysisOpen(false);
                setDigitalCampaignId('');
                const map = mapRef.current;
                const src = map?.getSource('digital-cp') as maplibregl.GeoJSONSource | undefined;
                src?.setData({ type: 'FeatureCollection', features: [] });
              }}
              onOpenDigitalAnalysis={() => setDigitalAnalysisOpen(true)}
              digitalCompareView={digitalCompareView}
              onDigitalCompareViewChange={setDigitalCompareView}
              digitalPopField={digitalPopField}
              onDigitalPopFieldChange={setDigitalPopField}
              studyVille={studyVille}
              onOpenStudy={handleOpenStudy}
              onOpenAnalysisResults={handleOpenAnalysisResults}
              availableResults={availableResults}
              selectedPOI={selectedPOI}
              onSelectedPOIChange={setSelectedPOI}
              selectedDepts={perimeterSelectedDepts}
              onSelectedDeptsChange={setPerimeterSelectedDepts}
              selectedRegions={perimeterSelectedRegions}
              onSelectedRegionsChange={setPerimeterSelectedRegions}
              ville={perimeterVille}
              onVilleChange={setPerimeterVille}
              scope={perimeterScope}
              onScopeChange={setPerimeterScope}
            />
          )}
          {activeOverlay === 'pilotage' && (
            <PilotageOverlay
              initialAction={pilotageInitialAction}
              onActionConsumed={() => setPilotageInitialAction(null)}
            />
          )}
          {activeOverlay === 'zones' && (
            <ZonesOverlay mapRef={mapRef} />
          )}
          {activeOverlay === 'settings' && (
            <SettingsOverlay
              mapStyles={MAP_STYLES as unknown as { id: string; label: string; url: string }[]}
              currentMapStyleUrl={mapStyleUrl}
              onMapStyleChange={handleMapStyleChange}
              onSaveCurrentView={() => savedMaps.setShowSavePanel(true)}
              saveLoading={savedMaps.saveLoading}
            />
          )}
        </OverlayPanel>
      )}
      {activeResults && (
        <ResultsPanel
          topOffset={iconBarHidden ? 0 : MAP_TOPBAR_HEIGHT}
          type={activeResults}
          title={
            activeResults === 'clustering'  ? 'Résultats — clustering' :
            activeResults === 'coverage'    ? 'Résultats — couverture démographique' :
            activeResults === 'correlation' ? 'Résultats — corrélation IRIS × POI' :
                                              'Résultats — scoring OOH'
          }
          dotColor="var(--cat-analysis)"
          onClose={handleCloseResults}
        >
          {activeResults === 'clustering' && (
            <ClusteringResultsContent
              geojson={clusterGeoJSON ?? null}
              visible={clustersVisible}
              loading={clusterLoading}
              duration={clusterDuration}
              onToggle={handleToggleClusters}
              onLoad={handleToggleClusters}
              onDurationChange={handleClusterDurationChange}
              onFlyTo={handleFlyTo}
              onFitBounds={handleFitBounds}
              onWizardHighlight={handleWizardHighlight}
              onWizardClose={() => setWizardHighlightGeoJSON(null)}
            />
          )}
          {activeResults === 'coverage' && (
            <div style={{ padding: 16 }}>
              <CoverageResultsPanel
                inline
                battleFeatures={battleFeatures}
                pois={battlePois}
                battleCacheKey={battleCacheKey ?? undefined}
                onResultsReady={(s) => setCoverageReady(s.length > 0)}
              />
            </div>
          )}
          {activeResults === 'correlation' && (
            <div style={{ padding: 16 }}>
              <CorrelationPanelDyn
                onFlyTo={handleFlyTo}
                params={correlationParams ?? null}
                onShowResiduals={handleShowResiduals}
              />
            </div>
          )}
          {activeResults === 'scoring' && (
            <div style={{ padding: 16 }}>
              <ScoringPanel
                inline
                mapRef={mapRef}
                mapReady={mapReady}
                onFlyTo={handleFlyTo}
                onScoreComputed={(v) => setStudyVille(v)}
              />
              {studyVille && (
                <button
                  type="button"
                  onClick={handleOpenStudy}
                  style={{
                    width: '100%', marginTop: 12,
                    background: 'transparent',
                    border: '0.5px solid var(--brand-teal)',
                    color: 'var(--brand-teal)',
                    borderRadius: 6, padding: '10px 12px',
                    fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    transition: 'background-color 150ms var(--ease-hover)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  Ouvrir l&apos;étude de ville →
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, opacity: 0.8 }}>{studyVille}</span>
                </button>
              )}
            </div>
          )}
        </ResultsPanel>
      )}
      <CivicIndicatorsLayer mapRef={mapRef} variableCode={civicVariableCode} />
      <CivicHealthMapLayer
        mapRef={mapRef}
        dataset={civicHealthLayer}
        scale={civicScale}
        minLevel={civicMinLevel}
        metric={civicMetric}
        refreshKey={civicRefreshKey}
        onProgress={(done, total) => setCivicProgress({ done, total })}
        onCpDataStatus={(status, date) => { setCivicCpStatus(status); setCivicCpDate(date); }}
        onLoadingChange={setCivicLoading}
      />
      <CaptureLayers
        mapRef={mapRef}
        battleCacheKey={battleCacheKey}
        battleFeatures={battleFeatures}
        battlePois={battlePois}
        clusterGeoJSON={clusterGeoJSON}
        clustersVisible={clustersVisible}
        radioSelectedId={radioSelectedId}
        radioSelectedNom={radioSelectedNom}
        radioCoverageMode={radioCoverageMode}
        selectedIrisCode={selectedIrisCode}
        voronoiVisible={mapLayers.voronoiVisible}
        voronoiCategory={mapLayers.voronoiCategory}
        carreauxVisible={mapLayers.carreauxVisible}
        carreauxIndicateur={mapLayers.carreauxIndicateur}
        carreauxSelectedBucket={mapLayers.carreauxSelectedBucket}
        tmjaGeoJSON={tmjaGeoJSON}
      />
      {/* ── Right panel: map + optional StudyDashboard (tab bar Carte/Étude supprimé) ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>

        {/* Bouton "← Retour à la carte" (visible uniquement en mode Étude)
           Descend sous la MapTopBar quand elle est affichée pour ne pas la chevaucher. */}
        {activeStudy && (
          <button
            type="button"
            onClick={handleCloseStudy}
            style={{
              position: 'fixed',
              top: iconBarHidden ? 12 : MAP_TOPBAR_HEIGHT + 10,
              left: 60, zIndex: 50,
              background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)',
              color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 12px',
              fontSize: 12, fontFamily: "'Inter', system-ui, sans-serif", cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'top 200ms var(--ease-out), background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-level-2)'; e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            ← Retour à la carte
          </button>
        )}

        {/* Map area — masquée quand activeStudy est true */}
        <div style={{ flex: 1, position: 'relative', display: !activeStudy ? 'flex' : 'none' }}>

          {/* Mode immersif : toggle IconBar — z=50 pour rester cliquable au-dessus de l'overlay
             Le bouton descend sous la MapTopBar quand elle est affichée. */}
          <button
            onClick={() => setIconBarHidden(h => !h)}
            title={iconBarHidden ? 'Afficher la barre (Escape)' : 'Masquer la barre (mode immersif)'}
            aria-pressed={iconBarHidden}
            style={{
              position: 'fixed',
              top: iconBarHidden ? 10 : MAP_TOPBAR_HEIGHT + 8,
              right: 10,
              zIndex: 50,
              background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)',
              borderRadius: 6, padding: 8,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-secondary)',
              transition: 'top 200ms var(--ease-out), background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-level-2)'; e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            {iconBarHidden ? <Maximize2 size={16} strokeWidth={1.5} /> : <Minimize2 size={16} strokeWidth={1.5} />}
          </button>

          {/* Tout effacer — vide toutes les couches et zones affichées */}
          <button
            onClick={handleClearAllLayers}
            title="Tout effacer (couches et zones affichées)"
            style={{
              position: 'fixed',
              top: (iconBarHidden ? 10 : MAP_TOPBAR_HEIGHT + 8) + 42,
              right: 10,
              zIndex: 50,
              background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)',
              borderRadius: 6, padding: 8,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-secondary)',
              transition: 'top 200ms var(--ease-out), background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-level-2)'; e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <Eraser size={16} strokeWidth={1.5} />
          </button>

          {/* Script custom bidding DV360 — visible quand une zone custom est affichée
              sur la carte (chargée via « Utiliser dans la carte », battleCacheKey cg__<id>) */}
          {battleCacheKey?.startsWith('cg__') && (
            <button
              onClick={() => { void downloadZoneExport(battleCacheKey.slice(4), 'bidding_script').catch(err => console.error('[map] export bidding', err)); }}
              title={`Générer le fichier custom bidding DV360 pour « ${battlePois[0]?.nom ?? 'zone custom'} »`}
              style={{
                position: 'fixed',
                top: (iconBarHidden ? 10 : MAP_TOPBAR_HEIGHT + 8) + 84,
                right: 10,
                zIndex: 50,
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--bg-surface)', border: '0.5px solid var(--brand-teal)',
                borderRadius: 6, padding: '7px 10px',
                cursor: 'pointer',
                color: 'var(--brand-teal)',
                fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11, fontWeight: 500,
                transition: 'top 200ms var(--ease-out), background-color 150ms var(--ease-hover)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
            >
              <FileDown size={14} strokeWidth={1.5} />
              Script bidding DV360
            </button>
          )}

          {/* Toggle Vue comparée / fusionnée déplacé dans l'overlay Campagnes média (FilterPanel) */}

          {/* Triple map view — visible when Digital active + vue comparée */}
          {digitalVisible && digitalCompareView && digitalCampaignId && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 15 }}>
              <TripleMapView
                campaignId={digitalCampaignId}
                scale={digitalScale}
                popField={digitalPopField}
                metric="impressions"
              />
            </div>
          )}

      {/* Main map — hidden behind TripleMapView when Digital compare view is active */}
      <div style={{
        ...(digitalVisible && digitalCompareView && digitalCampaignId
          ? { position: 'absolute' as const, inset: 0, zIndex: 1, visibility: 'hidden' as const }
          : { display: 'contents' as const }),
      }}>
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
      </div>

          {/* Résidus de corrélation — légende flottante */}
          {residualsMeta && (
            <div style={{
              position: 'absolute', bottom: 44, left: 12, zIndex: 100,
              background: 'var(--card-overlay)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '0.5px solid var(--border-default)',
              borderRadius: 4,
              padding: '10px 12px',
              minWidth: 200,
              fontFamily: "'JetBrains Mono','Fira Mono',monospace",
            }}>
              {/* Titre */}
              <div style={{ fontFamily: "'JetBrains Mono','Fira Mono',monospace", fontSize: 7, letterSpacing: '0.14em', color: 'var(--brand-teal)', marginBottom: 6 }}>
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
                  <span style={{ fontSize: 8.5, color: 'var(--text-tertiary)' }}>{label}</span>
                </div>
              ))}

              {/* Séparateur */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 8, paddingTop: 8 }}>

                {/* Slider opacité */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                  <span style={{ fontFamily: "'JetBrains Mono','Fira Mono',monospace", fontSize: 7, letterSpacing: '0.1em', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                    OPACITÉ
                  </span>
                  <input
                    type="range" min={0.1} max={1} step={0.05}
                    value={residualOpacity}
                    onChange={e => handleResidualOpacity(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--brand-teal)', cursor: 'pointer', height: 4 }}
                  />
                  <span style={{ fontSize: 8, color: 'var(--text-tertiary)', minWidth: 28, textAlign: 'right' }}>
                    {Math.round(residualOpacity * 100)}%
                  </span>
                </div>

                {/* Toggle inversion */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 8.5, color: 'var(--text-tertiary)' }}>Inverser couleurs</span>
                  <button
                    onClick={() => handleResidualInvert(!residualInverted)}
                    style={{
                      position: 'relative',
                      width: 32, height: 16,
                      background: residualInverted ? 'var(--brand-teal)' : 'var(--border-subtle)',
                      border: `1px solid ${residualInverted ? 'var(--brand-teal)' : 'var(--border-default)'}`,
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
                <div style={{ fontSize: 7.5, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                  Rouge = {residualInverted ? 'excédent' : 'déficit'}
                </div>
              </div>

              {/* Stats */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6, fontSize: 8, color: 'var(--text-tertiary)' }}>
                {residualsMeta.n.toLocaleString('fr')} IRIS · r = {residualsMeta.r >= 0 ? '+' : ''}{residualsMeta.r.toFixed(2)}
              </div>

              {/* Masquer */}
              <button
                onClick={() => handleShowResiduals(null)}
                style={{
                  marginTop: 6, width: '100%', padding: '4px 0',
                  background: 'transparent', border: '1px solid var(--border-default)',
                  borderRadius: 2, color: 'var(--text-tertiary)', fontFamily: "'JetBrains Mono','Fira Mono',monospace",
                  fontSize: 7, letterSpacing: '0.1em', cursor: 'pointer',
                }}
              >
                ✕ MASQUER
              </button>
            </div>
          )}

          {/* Scoring OOH panel — déplacé dans l'onglet EXPERT > ANALYSE > accordéon Scoring OOH */}

          {/* WelcomeOverlay retiré : l'utilisateur arrive directement sur la carte */}

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

          {/* Drawer analyse détaillée Digital — slide depuis le bas, exit direct */}
          {digitalAnalysisOpen && digitalCampaignId && (
            <div
              data-state={digitalAnalysisClosing ? 'closing' : 'open'}
              style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50,
                height: digitalAnalysisSize === 'full' ? '100%' : '50%', minHeight: 300,
                background: 'var(--bg-surface)',
                borderTop: '0.5px solid var(--border-default)',
                boxShadow: '0 -4px 18px rgba(0, 0, 0, 0.18)',
                display: 'flex', flexDirection: 'column',
                willChange: 'transform, opacity, height',
                animation: digitalAnalysisClosing
                  ? 'drawerSlideOutBottom var(--duration-exit) var(--ease-exit) both'
                  : 'drawerSlideInBottom var(--duration-enter) var(--ease-spring) both',
                transition: 'height var(--duration-enter) var(--ease-spring)',
              }}>
              <div style={{
                padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: '0.5px solid var(--border-subtle)', flexShrink: 0,
              }}>
                <span style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                  Analyse detaillee
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    onClick={() => setDigitalAnalysisSize(s => s === 'half' ? 'full' : 'half')}
                    title={digitalAnalysisSize === 'full' ? 'Reduire' : 'Plein ecran'}
                    style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px', display: 'flex', borderRadius: 4, transition: 'color var(--duration-hover) var(--ease-hover), background-color var(--duration-hover) var(--ease-hover), transform var(--duration-press) var(--ease-out)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-level-2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
                    onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.94)'; }}
                    onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                  >
                    {digitalAnalysisSize === 'full' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                  <button
                    onClick={closeDigitalAnalysis}
                    aria-label="Fermer"
                    style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 18, padding: '0 6px', lineHeight: 1, borderRadius: 4, transition: 'color var(--duration-hover) var(--ease-hover), background-color var(--duration-hover) var(--ease-hover), transform var(--duration-press) var(--ease-out)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-level-2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
                    onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.94)'; }}
                    onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                  >×</button>
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                <DigitalAnalysisPanel
                  campaignId={digitalCampaignId}
                  scale={digitalScale}
                  popField={digitalPopField}
                  selectedMedia={[]}
                  metric="impressions"
                  open={digitalAnalysisOpen}
                  onToggle={closeDigitalAnalysis}
                />
              </div>
            </div>
          )}
        </div>

        {/* Study dashboard — lazy, affiché quand onglet Étude */}
        {activeStudy && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg-primary)' }}>
            <StudyDashboard
              ville={studyVille}
              onPanneauClick={(lat, lng) => {
                setActiveStudy(false);
                setTimeout(() => handleFlyTo(lat, lng, 17), 80);
              }}
            />
          </div>
        )}
      </div>{/* end right panel */}

      {/* Map popup styles moved to globals.css */}

      {/* Panel modal météo (configuration variable + période) */}
      {meteoPanelOpen && (
        <div
          onClick={() => setMeteoPanelOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <MeteoGeoPanel
              scaleSelectable
              onApply={async (params) => {
                // Panneau maintenu ouvert pendant le fetch (spinner) et en cas
                // d'erreur (le message s'affiche dedans) — fermé sur succès.
                const ok = await handleMeteoApply(params);
                if (ok) setMeteoPanelOpen(false);
              }}
              onClose={() => setMeteoPanelOpen(false)}
              loading={meteo.loading}
              progress={meteo.progress}
              error={meteo.error}
              stats={meteo.meta?.stats ?? null}
            />

          </div>
        </div>
      )}
    </div>
  );
}
