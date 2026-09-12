'use client';
import { logger } from '@/lib/logger';

/**
 * @file app/map/page.tsx — page principale carte MAGELIAN
 * @size ~1090 lignes (2329 avant le refactor du 31/08/2026 : les domaines
 *       autonomes vivent maintenant dans app/map/_hooks/)
 *
 * @sections internes
 *   1. Imports + dynamic loaders
 *   2. State transverse (overlays, périmètre, TMJA, civique, plan média)
 *   3. Appels des hooks de domaine (cf ci-dessous)
 *   4. Deep-links URL (?customZone, ?layer=digital, ?overlay=)
 *   5. Marqueurs POI + effacement global des couches
 *   6. Render JSX (MapTopBar + RailNavigation + OverlayPanel + panneaux latéraux)
 *
 * @hooks de domaine — app/map/_hooks/
 *   - useRadioLayer       : émetteurs FM/DAB+, filtres, clusters/heatmap/couverture
 *   - useMeteoLayer       : choroplèthe Open-Meteo par zones admin
 *   - useIrisDetail       : clic sur iris-fill + fetch du détail IRIS
 *   - useMapDirectActions : POI/OOH directs, isochrones, bataille (état inclus)
 *
 * @maintainers Pour étendre ce fichier :
 *   - NE PAS ajouter de `useState` au top pour un nouveau domaine — créer un
 *     hook dans `app/map/_hooks/`, appelé après `useMapInit`
 *   - Les overlays (entrées du rail) sont déjà isolés dans
 *     `components/map/overlays/`
 *   - Lire docs/known_tech_debt.md avant refactor structurel
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { adminFetch } from '@/lib/admin-fetch';
import { downloadZoneExport } from '@/lib/custom-geo/download-export';
import { MAP_STYLES, MAP_STYLE } from '@/app/copilote/_lib/constants';
import { useMapInit }          from '@/app/copilote/_hooks/useMapInit';
import { useRadioLayer } from './_hooks/useRadioLayer';
import { useMeteoLayer } from './_hooks/useMeteoLayer';
import { useIrisDetail } from './_hooks/useIrisDetail';
import { useMapDirectActions } from './_hooks/useMapDirectActions';
import { useMapMarkers } from './_hooks/useMapMarkers';
import { METEO_LABEL } from '@/lib/meteo/types';
const MeteoGeoPanel = dynamic(
  () => import('@/app/map/analyse/digital/_components/MeteoGeoPanel').then(m => ({ default: m.MeteoGeoPanel })),
  { ssr: false },
);
import { useSavedMaps }        from '@/app/copilote/_hooks/useSavedMaps';
import { useMapLayers }        from '@/app/copilote/_hooks/useMapLayers';
import { useChatControls }     from '@/app/copilote/_hooks/useChatControls';
import { useRateLimitHandler } from '@/app/copilote/_hooks/useRateLimitHandler';
import { useToolProcessor } from '@/app/copilote/_hooks/useToolProcessor';
import { useProviderSelector } from '@/app/copilote/_hooks/useProviderSelector';
import { MapPanel }            from '@/app/copilote/_components/MapPanel';
import { FilterPanel } from '@/app/map/_components/FilterPanel';
import type { DirectPOISearchParams, DirectBattleParams, DirectBattleV2Params, FillIsochroneCacheParams, POIStylesMap, CategorieFiltre } from '@/app/map/_components/FilterPanel';
import { IrisDetailPanel }    from '@/app/map/_components/IrisDetailPanel';
import type { IrisDetailData } from '@/app/map/_components/IrisDetailPanel';
import { CaptureLayers } from '@/app/map/_components/CaptureLayers';
import { CivicIndicatorsLayer, type CivicVariableCode } from '@/app/map/_components/CivicIndicatorsLayer';
import { CivicHealthMapLayer } from '@/app/map/_components/CivicHealthMapLayer';
import { SuiviMapLayer } from '@/app/map/_components/SuiviMapLayer';
import { ZoneMediaPlanPanel, PANEL_WIDTH } from '@/app/map/_components/ZoneMediaPlanPanel';
import dynamic from 'next/dynamic';
import type { ClusterGeoJSON } from '@/app/map/_components/ClusterPanel';
import type { ZoneData, BattleResult } from '@/types/spatial';
import { ChatPanel }       from '@/app/copilote/_components/ChatPanel';
import { RailNavigation } from '@/components/map/RailNavigation';
import { MapTopBar, MAP_TOPBAR_HEIGHT } from '@/components/map/MapTopBar';
import { OverlayPanel } from '@/components/map/OverlayPanel';
import { AIOverlay } from '@/components/map/overlays/AIOverlay';
import { SettingsOverlay } from '@/components/map/overlays/SettingsOverlay';
import { ZonesOverlay } from '@/components/map/overlays/ZonesOverlay';
import { HelpOverlay } from '@/components/map/overlays/HelpOverlay';
import { useMagelianOverlay } from '@/components/magelian/MagelianOverlayContext';
import { LARGEUR_RAIL, type EntreeId } from '@/lib/navigation/config';
import { Maximize2, Minimize2, Eraser, FileDown } from 'lucide-react';
import type { POI } from '@/types/poi';
import type { SelectedBillboard } from '@/types/map';

// ─── Adaptateur transitoire rail → panneaux (Tâche 2) ──────────────────────────
// Le rail (lib/navigation/config.ts) émet cinq thèmes, mais les panneaux
// existants n'existent qu'aux anciennes catégories perimeter/terrain/audience/
// analyses (FilterPanel). Cette table sera retirée aux Tâches 4, 6 et 7 quand
// « Calques », « Filtre » et « Analyse » auront leurs propres panneaux.
const CATEGORIES_FILTER_PANEL_PAR_ENTREE: Partial<Record<EntreeId, CategorieFiltre[]>> = {
  filtre: ['perimeter'],
  calques: ['audience', 'terrain'], // socio-démo d'abord
  analyse: ['analyses'],
};

/** Titre affiché dans l'en-tête de l'OverlayPanel, par entrée du rail. */
const TITRE_PAR_ENTREE: Partial<Record<EntreeId, string>> = {
  assistant: 'geo.prompt',
  filtre: 'Filtre',
  calques: 'Calques',
  analyse: 'Analyse',
  zones: 'Zones sauvegardées',
  reglages: 'Réglages',
  aide: 'Aide',
};

/** Couleur du dot de l'en-tête de l'OverlayPanel, par entrée du rail. */
const DOT_PAR_ENTREE: Partial<Record<EntreeId, string>> = {
  assistant: 'var(--brand-teal)',
  filtre: 'var(--cat-context)',
  calques: 'var(--cat-terrain)',
  analyse: 'var(--cat-analysis)',
  zones: 'var(--brand-teal)',
  reglages: 'var(--text-tertiary)',
  aide: 'var(--text-tertiary)',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MapPage() {
  const [error,    setError]    = useState<string | null>(null);
  const [zoneData, setZoneData] = useState<ZoneData | null>(null);
  const [railMasque, setRailMasque] = useState(false);
  const [entreeActive, setEntreeActive] = useState<EntreeId | null>(null);
  const { openOverlay } = useMagelianOverlay();
  // Adaptateur transitoire (Tâche 2) : « Campagne » n'ouvre pas un panneau du
  // rail mais l'overlay MAGELIAN plein écran, via son propre contexte — elle
  // ne devient donc jamais `entreeActive`.
  const handleEntree = useCallback((id: EntreeId) => {
    if (id === 'campagne') {
      openOverlay();
      return;
    }
    setEntreeActive(prev => prev === id ? null : id);
  }, [openOverlay]);
  // POI sélectionnés : lifted ici pour persistance entre fermeture/réouverture overlay
  // (sinon le state local de FilterPanel se perd → analyses bloquées par le check exactlyOnePOI)
  const [selectedPOI, setSelectedPOI] = useState<string[]>([]);
  // Périmètre territorial : même lift (filtre dept/région doit survivre au cycle
  // mount/unmount des overlays — sinon Bataille V2 ignore le filtre user)
  const [perimeterScope,           setPerimeterScope]           = useState<'metro' | 'all' | null>(null);
  const [perimeterSelectedRegions, setPerimeterSelectedRegions] = useState<string[]>([]);
  const [perimeterSelectedDepts,   setPerimeterSelectedDepts]   = useState<string[]>([]);
  const [perimeterVille,           setPerimeterVille]           = useState('');
  const [selectedBillboard, setSelectedBillboard] = useState<SelectedBillboard | null>(null);
  const [mapStyleUrl, setMapStyleUrl] = useState<string>(MAP_STYLE);
  const [densityMode,         setDensityMode]         = useState<boolean>(false);
  const [poiStyles,           setPoiStyles]           = useState<POIStylesMap>({});
  // TMJA — flux routier (comptages_routiers)
  const [tmjaGeoJSON, setTmjaGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);

  // ── Clustering POI x Filosofi (restaure le 2026-09-12) ────────────────────
  const [clusterGeoJSON,  setClusterGeoJSON]  = useState<ClusterGeoJSON | null>(null);
  const [clustersVisible, setClustersVisible] = useState(false);
  const [clusterLoading,  setClusterLoading]  = useState(false);
  const [clusterDuration, setClusterDuration] = useState(60);
  // Apercu des POI pendant la configuration d'un nouveau calcul : on montre
  // CE QUI SERA clusterise avant de lancer un job qui dure des minutes.
  const [wizardHighlightGeoJSON, setWizardHighlightGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  // Masquer les axes <5 000 véh/j par défaut pour limiter la densité visuelle
  // et alléger le rendu (tier 5-6 = ~80% des tronçons en France).
  const [tmjaHideLowTraffic, setTmjaHideLowTraffic] = useState(true);

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
  // Plan média : zones custom affichées via l'overlay Zones → panneau latéral droit
  const [planZones, setPlanZones] = useState<Array<{ id: string; name: string }>>([]);
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  const prevPlanCountRef = useRef(0);
  const handleLoadedZonesChange = useCallback((zones: Array<{ id: string; name: string }>) => {
    // Auto-ouverture à la première zone affichée ; fermeture quand plus rien
    if (zones.length > 0 && prevPlanCountRef.current === 0) setPlanPanelOpen(true);
    if (zones.length === 0) setPlanPanelOpen(false);
    prevPlanCountRef.current = zones.length;
    setPlanZones(zones);
  }, []);
  const searchParams = useSearchParams();




  // ── Esc : si le rail est masqué, le ré-afficher (priorité basse — OverlayPanel Esc gère en premier) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && railMasque) { setRailMasque(false); e.preventDefault(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [railMasque]);

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


  const { mapContainerRef, mapRef, markersRef, mapReady } = useMapInit(zoneData, setSelectedBillboard, mapStyleUrl);

  // ── Météo : état, effets de synchronisation et actions (cf _hooks/useMeteoLayer) ──
  const {
    meteo,
    meteoVisible,
    meteoPanelOpen, setMeteoPanelOpen,
    handleMeteoApply,
    handleMeteoClear,
  } = useMeteoLayer(mapRef, mapReady);

  // ── Detail IRIS : clic sur la couche + fetch (cf _hooks/useIrisDetail) ────
  const { selectedIrisCode, setSelectedIrisCode, selectedIrisData, setSelectedIrisData, irisDetailLoading } =
    useIrisDetail(mapRef, mapReady);

  // Couche Radio FM/DAB+ : etats, chargement et sync MapLibre (hook dedie).
  const {
    radioVisible, setRadioVisible,
    radioHeatmapMode, setRadioHeatmapMode,
    radioCoverageMode, setRadioCoverageMode,
    radioGeoJSON,
    radioFilterIds, setRadioFilterIds,
    radioExcludeCategories, setRadioExcludeCategories,
    radioFilterOptions,
    radioLoading,
    radioSystemeFilter, setRadioSystemeFilter,
    radioSelectedId, setRadioSelectedId,
    radioSelectedNom, setRadioSelectedNom,
    radioCoverageColor, setRadioCoverageColor,
    radioCoverageOpacity, setRadioCoverageOpacity,
    radioBorderWidth, setRadioBorderWidth,
    radioPointSize, setRadioPointSize,
  } = useRadioLayer(mapRef, mapReady);

  // ── Clustering : synchronisation carte ↔ état ────────────────────────────
  //
  // Trois effets séparés, et c'est voulu : l'aperçu du wizard, les données de
  // clusters et leur visibilité changent à des moments différents. Les fondre
  // en un seul rejouerait un `setData` de plusieurs milliers de points à chaque
  // bascule de visibilité.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('wizard-highlight') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (wizardHighlightGeoJSON) {
      src.setData(wizardHighlightGeoJSON);
      try { map.setLayoutProperty('wizard-highlight-layer', 'visibility', 'visible'); } catch { /* couche absente */ }
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
      try { map.setLayoutProperty('wizard-highlight-layer', 'visibility', 'none'); } catch { /* couche absente */ }
    }
  }, [wizardHighlightGeoJSON, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !clusterGeoJSON) return;
    const src = map.getSource('clusters-source') as maplibregl.GeoJSONSource | undefined;
    src?.setData(clusterGeoJSON as unknown as GeoJSON.FeatureCollection);
  }, [clusterGeoJSON, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try { map.setLayoutProperty('clusters-layer', 'visibility', clustersVisible ? 'visible' : 'none'); } catch { /* couche absente */ }
  }, [clustersVisible, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Cadre la carte sur une emprise — utilisé par le tableau de clusters. */
  const handleFitBounds = (bounds: [[number, number], [number, number]]) => {
    if (mapRef.current && mapReady) {
      mapRef.current.fitBounds(
        new maplibregl.LngLatBounds(bounds[0], bounds[1]),
        { padding: 60, duration: 1000 },
      );
    }
  };

  /** Aperçu des POI qui seront clusterisés, pendant la config du wizard. */
  const handleWizardHighlight = async (poiTypes: string[], metropolitaine: boolean) => {
    try {
      const res = await fetch('/api/map/pois', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poi_types: poiTypes,
          scope:     metropolitaine ? 'metro' : 'all',
          regions:   [], depts: [], ville: '', rayon_poi: null,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;
      const data = await res.json() as { pois?: { id: string; nom: string; lat: number; lng: number }[] };
      if (!data.pois?.length) { setWizardHighlightGeoJSON(null); return; }
      setWizardHighlightGeoJSON({
        type: 'FeatureCollection',
        features: data.pois.map(p => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
          properties: { id: p.id, nom: p.nom },
        })),
      });
    } catch { /* aperçu best-effort : son absence ne bloque pas le calcul */ }
  };

  /** Charge les clusters à la première ouverture, bascule ensuite. */
  const handleToggleClusters = async () => {
    if (!clustersVisible && !clusterGeoJSON) {
      setClusterLoading(true);
      try {
        const res  = await fetch(`/api/poi-clusters?duration=${clusterDuration}`);
        const data = await res.json() as ClusterGeoJSON & { type?: string };
        if (data.type === 'FeatureCollection') {
          setClusterGeoJSON(data);
          setClustersVisible(true);
        }
      } catch { /* rien à afficher, la couche reste éteinte */ } finally { setClusterLoading(false); }
    } else {
      setClustersVisible(v => !v);
    }
  };

  /** Changer la durée d'exposition rejoue la requête : ce sont d'autres clusters. */
  const handleClusterDurationChange = async (d: number) => {
    setClusterDuration(d);
    setClusterLoading(true);
    try {
      const res  = await fetch(`/api/poi-clusters?duration=${d}`);
      const data = await res.json() as ClusterGeoJSON & { type?: string };
      if (data.type === 'FeatureCollection') {
        setClusterGeoJSON(data);
        setClustersVisible(true);
      }
    } catch { /* la durée change, l'affichage reste sur les données précédentes */ } finally { setClusterLoading(false); }
  };

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

  // ── flyTo helper ────────────────────────────────────────────────────────────
  const handleFlyTo = (lat: number, lng: number, zoom = 12) => {
    if (mapRef.current && mapReady) mapRef.current.flyTo({ center: [lng, lat], zoom, duration: 1000 });
  };

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

  const savedMaps = useSavedMaps({ zoneData, setZoneData });
  const mapLayers = useMapLayers({
    mapRef, mapReady,
    isochroneDataForSaveRef:  savedMaps.isochroneDataForSaveRef,
    carreauxConfigForSaveRef: savedMaps.carreauxConfigForSaveRef,
    voronoiDataForSaveRef:    savedMaps.voronoiDataForSaveRef,
    setSaveName:              savedMaps.setSaveName,
  });

  // ── Actions directes POI / OOH / isochrones + état de bataille
  //    (cf _hooks/useMapDirectActions) ─────────────────────────────────────
  const {
    battleFeatures, setBattleFeatures,
    battlePois, setBattlePois,
    battleCacheKey, setBattleCacheKey,
    pendingBattleRef,
    handleDirectOOH,
    handleDirectSearch,
    handleDirectBattle,
    handleFillIsochroneCache,
    handleApplyBattle,
    handleDirectBattleV2,
  } = useMapDirectActions(mapRef, mapLayers, setZoneData, setError);

  // ── Marqueurs POI + cadrage (cf _hooks/useMapMarkers) ─────────────────────
  useMapMarkers(mapRef, markersRef, mapReady, zoneData, densityMode, poiStyles, setSelectedBillboard);
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
        'pois-heat', 'zone-circle', 'meteo-source',
        'tmja-source', 'radio-emetteurs', 'radio-coverage',
        'voronoi', 'voronoi-pois', 'isochrones', 'battle-rings',
        'battle-borders', 'battle-pois', 'test-iso',
        'clusters-source', 'wizard-highlight',
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
    setClusterGeoJSON(null);
    setClustersVisible(false);
    setWizardHighlightGeoJSON(null);

    // États de données de la page
    setZoneData(null);
    setBattleFeatures([]);
    setBattlePois([]);
    setBattleCacheKey(null);
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
    setSelectedIrisCode(null);
    setSelectedIrisData(null);
    setSelectedBillboard(null);

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
  }, [mapLayers, handleMeteoClear, mapRef, markersRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Charger une zone custom via ?customZone=<id> ──────────────────────────
  // Le polygon de la zone alimente le slot battleFeatures pour que Corrélation
  // et autres analyses puissent l'exploiter exactement comme une
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



  const activeCats = zoneData?.categories ? Object.keys(zoneData.categories).sort() : [];

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
      paddingLeft: railMasque ? 0 : LARGEUR_RAIL,
      paddingTop: railMasque ? 0 : MAP_TOPBAR_HEIGHT,
      transition: 'padding-left 200ms var(--ease-out), padding-top 200ms var(--ease-out)',
    }}>
      {!railMasque && <MapTopBar />}
      <RailNavigation
        entreeActive={entreeActive}
        onEntree={handleEntree}
        masque={railMasque}
        badgeAlertes={0 /* source du compte d'alertes : viendra avec l'onglet Suivi */}
      />
      {entreeActive && (
        <OverlayPanel
          topOffset={railMasque ? 0 : MAP_TOPBAR_HEIGHT}
          category={entreeActive}
          title={TITRE_PAR_ENTREE[entreeActive] ?? ''}
          dotColor={DOT_PAR_ENTREE[entreeActive] ?? 'var(--text-tertiary)'}
          onClose={() => setEntreeActive(null)}
        >
          {entreeActive === 'assistant' && <AIOverlay chatSlot={chatSlotContent} />}
          {CATEGORIES_FILTER_PANEL_PAR_ENTREE[entreeActive] && (
            <FilterPanel
              visibleCategory={CATEGORIES_FILTER_PANEL_PAR_ENTREE[entreeActive]}
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
              densityMode={densityMode}
              onDensityModeChange={(v) => { setDensityMode(v); localStorage.setItem('genesis_density_mode', String(v)); }}
              onPOIStylesChange={setPoiStyles}
              onFlyTo={handleFlyTo}
              carreauxVisible={mapLayers.carreauxVisible}
              carreauxLoaded={mapLayers.carreauxLoaded}
              carreauxIndicateur={mapLayers.carreauxIndicateur}
              carreauxPalette={mapLayers.carreauxPalette}
              carreauxOpacity={mapLayers.carreauxOpacity}
              carreaux3D={mapLayers.carreaux3D}
              setCarreaux3D={mapLayers.setCarreaux3D}
              carreauxHauteur={mapLayers.carreauxHauteur}
              setCarreauxHauteur={mapLayers.setCarreauxHauteur}
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
              iris3D={mapLayers.iris3D}
              setIris3D={mapLayers.setIris3D}
              irisHauteur={mapLayers.irisHauteur}
              setIrisHauteur={mapLayers.setIrisHauteur}
              irisBornes={mapLayers.irisBornes}
              irisTrueOnly={mapLayers.irisTrueOnly}
              zoomCourant={mapLayers.zoomCourant}
              irisZoomPlancher={mapLayers.irisZoomPlancher}
              clusterGeoJSON={clusterGeoJSON}
              clustersVisible={clustersVisible}
              clusterLoading={clusterLoading}
              clusterDuration={clusterDuration}
              onToggleClusters={handleToggleClusters}
              onLoadClusters={handleToggleClusters}
              onClusterDurationChange={handleClusterDurationChange}
              onFitBounds={handleFitBounds}
              onWizardHighlight={handleWizardHighlight}
              onWizardClose={() => setWizardHighlightGeoJSON(null)}
              setIrisVisible={mapLayers.setIrisVisible}
              setIrisIndicateur={mapLayers.setIrisIndicateur}
              setIrisPalette={mapLayers.setIrisPalette}
              setIrisOpacity={mapLayers.setIrisOpacity}
              setIrisTrueOnly={mapLayers.setIrisTrueOnly}
              mainMapRef={mapRef}
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
          {entreeActive === 'zones' && (
            <ZonesOverlay mapRef={mapRef} onLoadedZonesChange={handleLoadedZonesChange} />
          )}
          {entreeActive === 'reglages' && (
            <SettingsOverlay
              mapStyles={MAP_STYLES as unknown as { id: string; label: string; url: string }[]}
              currentMapStyleUrl={mapStyleUrl}
              onMapStyleChange={handleMapStyleChange}
              onSaveCurrentView={() => savedMaps.setShowSavePanel(true)}
              saveLoading={savedMaps.saveLoading}
            />
          )}
          {entreeActive === 'aide' && <HelpOverlay />}
        </OverlayPanel>
      )}
      <CivicIndicatorsLayer mapRef={mapRef} variableCode={civicVariableCode} />
      {/* Plan média sur les zones custom affichées (budget / CPM / cible) */}
      {planZones.length > 0 && planPanelOpen && (
        <ZoneMediaPlanPanel
          zones={planZones}
          topOffset={railMasque ? 0 : MAP_TOPBAR_HEIGHT}
          onClose={() => setPlanPanelOpen(false)}
        />
      )}
      {planZones.length > 0 && !planPanelOpen && (
        <button
          onClick={() => setPlanPanelOpen(true)}
          title="Rouvrir le plan média des zones affichées"
          style={{
            position: 'fixed',
            top: (railMasque ? 10 : MAP_TOPBAR_HEIGHT + 8) + 126,
            right: planPanelOpen && planZones.length ? PANEL_WIDTH + 10 : 10,
            zIndex: 50,
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--bg-surface)', border: '0.5px solid var(--brand-teal)',
            borderRadius: 6, padding: '7px 10px', cursor: 'pointer',
            color: 'var(--brand-teal)',
            fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11, fontWeight: 500,
            transition: 'top 200ms var(--ease-out), background-color 150ms var(--ease-hover)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
        >
          Plan média ({planZones.length})
        </button>
      )}
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
      <SuiviMapLayer mapRef={mapRef} />
      <CaptureLayers
        clusterGeoJSON={clusterGeoJSON}
        clustersVisible={clustersVisible}
        mapRef={mapRef}
        battleCacheKey={battleCacheKey}
        battleFeatures={battleFeatures}
        battlePois={battlePois}
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
      {/* ── Right panel: map ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>

        {/* Map area */}
        <div style={{ flex: 1, position: 'relative', display: 'flex' }}>

          {/* Mode immersif : toggle du rail — z=50 pour rester cliquable au-dessus de l'overlay
             Le bouton descend sous la MapTopBar quand elle est affichée. */}
          <button
            onClick={() => setRailMasque(h => !h)}
            title={railMasque ? 'Afficher la barre (Escape)' : 'Masquer la barre (mode immersif)'}
            aria-pressed={railMasque}
            style={{
              position: 'fixed',
              top: railMasque ? 10 : MAP_TOPBAR_HEIGHT + 8,
              right: planPanelOpen && planZones.length ? PANEL_WIDTH + 10 : 10,
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
            {railMasque ? <Maximize2 size={16} strokeWidth={1.5} /> : <Minimize2 size={16} strokeWidth={1.5} />}
          </button>

          {/* Tout effacer — vide toutes les couches et zones affichées */}
          <button
            onClick={handleClearAllLayers}
            title="Tout effacer (couches et zones affichées)"
            style={{
              position: 'fixed',
              top: (railMasque ? 10 : MAP_TOPBAR_HEIGHT + 8) + 42,
              right: planPanelOpen && planZones.length ? PANEL_WIDTH + 10 : 10,
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
                top: (railMasque ? 10 : MAP_TOPBAR_HEIGHT + 8) + 84,
                right: planPanelOpen && planZones.length ? PANEL_WIDTH + 10 : 10,
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

        </div>
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
