'use client';
import { logger } from '@/lib/logger';

/**
 * @file FilterPanel.tsx — composant central de filtrage MAGELIAN (carte /map)
 *
 * Rendu par /map dans l'overlay du rail, avec `visibleCategory` qui sélectionne
 * un des 4 blocs de sections (perimeter / terrain / audience / analyses).
 *
 * @sections internes
 *   1. Imports + types + props           (≈ 1-250)
 *   2. State management (useState/useRef) (≈ 250-600)
 *   3. Custom geo capture hooks          (≈ 600-750)
 *   4. POI handlers + isochrones         (≈ 750-1200)
 *   5. Bataille handlers (battle V1/V2)  (≈ 1200-1450)
 *   6. Render JSX, 4 blocs par catégorie (≈ 1450-fin)
 *
 * @see ./filter-panel/ — sous-composants et tokens extraits (2026-09-03)
 *
 * @maintainers Pour étendre ce fichier sans le faire grossir :
 *   - NE PAS ajouter de nouveau gros bloc — extraire vers ./filter-panel/
 *   - Préférer un nouveau composant plutôt qu'un n-ième handler ici
 *   - Lire docs/known_tech_debt.md avant tout refactor structurel
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Search, X, ChevronDown, HelpCircle } from 'lucide-react';
import { CategoryGroup } from '@/components/ui/CategoryGroup';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { ZoneData } from '@/types/spatial';
import { HealthIndicatorCard } from '@/components/donnees-terrain/HealthIndicatorCard';
import { ATMO_LEVEL_LABELS, POLLEN_LEVEL_LABELS } from '@/lib/civic-health/levels';
import { CARREAUX_INDICATEURS, CARREAUX_PALETTES } from '@/components/CarreauxPMTilesLayer';
import { IRIS_PALETTES, type IrisStats } from '@/app/copilote/_hooks/useMapLayers';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';
import { adminFetch } from '@/lib/admin-fetch';
import { useCustomGeoLayer } from '@/lib/custom-geo/useCustomGeoLayer';
import { useCustomGeoCaptureContext, type AdminScope } from '@/lib/custom-geo/CustomGeoCaptureContext';
import type { ContributedGeometry } from '@/types/custom-geo';
import { C, fInter, fMono } from './filter-panel/tokens';
import { hexToRgb, inputFocusHandlers, inputStyle, labelStyle, pill, primaryBtn } from './filter-panel/styles';
import { PerimeterSections } from './filter-panel/PerimeterSections';
import { PoiSection } from './filter-panel/PoiSection';
import { OohSection } from './filter-panel/OohSection';
import { TransportSection } from './filter-panel/TransportSection';
import { TmjaSection } from './filter-panel/TmjaSection';
import { RadioSection } from './filter-panel/RadioSection';
import { CarreauxSection } from './filter-panel/CarreauxSection';
import { IrisSection } from './filter-panel/IrisSection';
import { CivicIndicatorsSection } from './filter-panel/CivicIndicatorsSection';
import { CivicHealthSection } from './filter-panel/CivicHealthSection';
import { MeteoSection } from './filter-panel/MeteoSection';
import { SpatialAnalysisEmptyState, SpatialAnalysisTooManyPoi } from './filter-panel/SpatialAnalysisIntro';
import { VoronoiTool } from './filter-panel/VoronoiTool';
import { BattleV2Tool } from './filter-panel/BattleV2Tool';
import { IsochronesTool } from './filter-panel/IsochronesTool';
import { FilterSectionHeader } from './filter-panel/FilterSectionHeader';
import { MultiDropdown } from './filter-panel/MultiDropdown';
import { RadioSearchInput } from './filter-panel/RadioSearchInput';
// ─── Equity indicator types ──────────────────────────────────────────────────

// ─── Données géographiques ─────────────────────────────────────────────────────
// REGIONS et ALL_DEPTS sont maintenant fetch dynamiquement depuis ref_regions
// / ref_departements via useRefGeo() → les codes envoyés à Supabase sont les
// vrais codes INSEE ('53' Bretagne, '84' ARA, etc.) et non plus des ids
// alphabétiques applicatifs ('bre', 'ara') qui ne matchaient aucune RPC.
import { ISO_MODES, ISO_DURATIONS } from '@/lib/geo/france-admin';
import { useRefGeo } from '@/lib/geo/use-ref-geo';

type Tab = 'geoprompt' | 'expert';
// ExpertSubTab supprimé — panel unique scrollable (Sprint 1)

// ─── POI Style ────────────────────────────────────────────────────────────────
// Types déplacés dans ./filter-panel/poi-style.ts — réexportés ici pour ne pas
// casser les importateurs existants (map/page.tsx, useMapMarkers, useMapDirectActions).
export type { POIStyle, POIStylesMap } from './filter-panel/poi-style';
import type { POIStylesMap } from './filter-panel/poi-style';

// ─── Props ────────────────────────────────────────────────────────────────────
export interface DirectPOISearchParams {
  poi_types: string[];
  scope: 'metro' | 'all' | null;
  regions: string[];
  depts: string[];
  ville: string;
  rayon_poi: string | null;
  poi_natures?: Record<string, string[]>;
}

export interface DirectBattleParams {
  category: string;
  mode: string;
  max_minutes: number;
  durations: number[];
  filtre_ville?: string;
  filtre_regions?: string[];
  filtre_depts?: string[];
  metropolitaine: boolean;
  force_recalculate?: boolean;
}

export interface DirectBattleV2Params {
  category: string;
  mode: string;
  filtre_ville?: string;
  filtre_regions?: string[];
  filtre_depts?: string[];
  metropolitaine: boolean;
  paliers: number[];
  force_battle?: boolean;
}

export interface FillIsochroneCacheParams {
  category: string;
  mode: string;
  max_minutes: number;
  durations: number[];
  filtre_ville?: string;
  filtre_regions?: string[];
  filtre_depts?: string[];
  metropolitaine: boolean;
}

export interface FilterPanelProps {
  chatSlot?: React.ReactNode;
  sendMessage: (text: string) => void;
  onDirectOOH: (regies?: string[]) => Promise<void>;
  onDirectSearch:   (params: DirectPOISearchParams) => Promise<void>;
  onDirectBattle:       (params: DirectBattleParams, onProgress?: (msg: string, pct?: number) => void) => Promise<{ geometry: string; nb_pois: number; poiGroups: { id: string; nom: string; geometries: string[] }[]; battleRings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: string }[] }>;
  onDirectBattleV2:     (params: DirectBattleV2Params, onProgress?: (msg: string) => void) => Promise<void>;
  onFillIsochroneCache: (params: FillIsochroneCacheParams, onProgress?: (msg: string) => void) => Promise<void>;
  onApplyBattle:    (rings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: string }[], category?: string, poisForMap?: { id: string; nom: string; lat: number; lng: number; adresse?: string; ville?: string }[], onProgress?: (msg: string, pct: number) => void) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  zoneData: ZoneData | null;
  voronoiVisible: boolean;
  setVoronoiVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  battleVisible: boolean;
  setBattleVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  battleOuterFillVisible: boolean;
  setBattleOuterFillVisible: (v: boolean) => void;
  isochroneVisible: boolean;
  setIsochroneVisible: (v: boolean) => void;
  setShowSavePanel: (v: boolean | ((p: boolean) => boolean)) => void;
  densityMode?: boolean;
  onDensityModeChange?: (v: boolean) => void;
  onPOIStylesChange?: (styles: POIStylesMap) => void;
  onFlyTo?:                 (lat: number, lng: number, zoom?: number) => void;
  // Carreaux
  carreauxVisible?:         boolean;
  carreauxLoaded?:          boolean;
  carreauxIndicateur?:      string;
  carreauxPalette?:         string;
  carreauxOpacity?:         number;
  carreauxRange?:           { p5: number; p95: number } | null;
  carreauxSelectedBucket?:  number | null;
  setCarreauxVisible?:      (v: boolean | ((p: boolean) => boolean)) => void;
  setCarreauxIndicateur?:   (v: string) => void;
  setCarreauxPalette?:      (v: string) => void;
  setCarreauxOpacity?:      (v: number) => void;
  setCarreauxSelectedBucket?: (v: number | null) => void;
  // IRIS
  irisVisible?:         boolean;
  irisIndicateur?:      string;
  irisPalette?:         string;
  irisOpacity?:         number;
  irisStats?:           IrisStats | null;
  irisTrueOnly?:        boolean;
  setIrisVisible?:      (v: boolean | ((p: boolean) => boolean)) => void;
  setIrisIndicateur?:   (v: string) => void;
  setIrisPalette?:      (v: string) => void;
  setIrisOpacity?:      (v: number) => void;
  setIrisTrueOnly?:     (v: boolean) => void;
  // Reference vers la carte principale (pour territory mask layer)
  mainMapRef?:          React.MutableRefObject<MaplibreMap | null>;
  // Transport & TMJA
  onLoadTransport?:     (types: string[]) => Promise<void>;
  onLoadTMJA?:          () => Promise<void>;
  tmjaVisible?:         boolean;
  onClearTMJA?:         () => void;
  /** Masque les axes < 5 000 véh/j (default true côté parent). */
  tmjaHideLowTraffic?:  boolean;
  onToggleTmjaHideLowTraffic?: (next: boolean) => void;
  // Météo
  onOpenMeteo?:         () => void;
  onClearMeteo?:        () => void;
  meteoVisible?:        boolean;
  meteoLabel?:          string | null;
  // Indicateurs civiques (layer choroplèthe par CP)
  civicVariableCode?:   'abstention_pres_2022' | null;
  onCivicVariableChange?: (code: 'abstention_pres_2022' | null) => void;
  /** Callback ouvre le wizard Pilotage ML pré-réglé sur cette variable INSEE. */
  onPondererCivicVariable?: (code: 'abstention_pres_2022') => void;
  // Santé environnementale (carte ATMO + pollen pour la commune de l'IRIS sélectionné)
  /** Code INSEE 5 chars de la commune dont relève l'IRIS sélectionné. */
  selectedIrisCommuneCode?: string | null;
  /** Nom de la commune (optionnel, affiché en en-tête de la carte). */
  selectedIrisCommuneName?: string | null;
  // Couches santé environnementale (allergènes + qualité de l'air, Atmo France)
  /** Couche active : pollen, qualité de l'air, ou null (masquée). */
  civicHealthLayer?:    'pollen' | 'atmo' | null;
  onCivicHealthLayerChange?: (layer: 'pollen' | 'atmo' | null) => void;
  /** Progression du stream département (départements traités / total). */
  civicProgress?:       { done: number; total: number } | null;
  /** true pendant le chargement de la couche (zones + valeurs). */
  civicLoading?:        boolean;
  /** Échelle : département (échantillonné) ou code postal (ingestion bulk). */
  civicScale?:          'departement' | 'cp';
  onCivicScaleChange?:  (s: 'departement' | 'cp') => void;
  /** Métrique filtrée/peinte : 'global' ou une espèce (pollen) / un polluant (air). */
  civicMetric?:         string;
  onCivicMetricChange?: (m: string) => void;
  /** Seuil minimum affiché (0 = tous les niveaux). */
  civicMinLevel?:       number;
  onCivicMinLevelChange?: (n: number) => void;
  /** Statut de la donnée CP ('no_data' = ingestion jamais lancée) + sa date. */
  civicCpStatus?:       'ok' | 'no_data' | null;
  civicCpDate?:         string | null;
  /** Appelé après une ingestion admin réussie (le parent recharge le layer). */
  onCivicIngested?:     () => void;
  // Radio
  radioVisible?:          boolean;
  onToggleRadio?:         () => void;
  radioHeatmapMode?:      boolean;
  onToggleRadioHeatmap?:  () => void;
  radioCoverageMode?:     boolean;
  onToggleRadioCoverage?: () => void;
  radioLoading?:          boolean;
  radioSystemeFilter?:    string;
  onRadioSystemeChange?:  (v: string) => void;
  onSelectRadio?:         (radioId: string, radioNom: string) => void;
  radioCount?:            number;
  radioSelectedNom?:      string | null;
  onClearRadioSelection?: () => void;
  radioFilterIds?:        string[];
  onRadioFilterIdsChange?: (ids: string[]) => void;
  radioExcludeCategories?: string[];
  onRadioExcludeCategoriesChange?: (cats: string[]) => void;
  radioFilterOptions?:    { radios: Array<{ id: string; nom: string; cat: string | null }>; categories: Array<{ value: string; label: string }> } | null;
  radioCoverageColor?:    string;
  onRadioCoverageColorChange?: (c: string) => void;
  radioCoverageOpacity?:  number;
  onRadioCoverageOpacityChange?: (v: number) => void;
  radioBorderWidth?:      number;
  onRadioBorderWidthChange?: (v: number) => void;
  radioPointSize?:        number;
  onRadioPointSizeChange?: (v: number) => void;
  onRecenterFrance?:      () => void;

  /** Mode overlay : rend uniquement la CategoryGroup correspondante sans tabs/HOME/search.
   *  Quand set, le FilterPanel sert de contenu à un OverlayPanel externe. */
  visibleCategory?: 'perimeter' | 'terrain' | 'audience' | 'analyses';
  /** POI sélectionnés (controlled). Si fourni avec onSelectedPOIChange, l'état persiste
   *  au-delà du cycle mount/unmount du FilterPanel (overlay close → reopen). */
  selectedPOI?: string[];
  onSelectedPOIChange?: (poi: string[]) => void;
  /** Périmètre territorial (controlled, même pattern que selectedPOI).
   *  Persistent entre fermeture/réouverture des overlays. */
  selectedDepts?: string[];
  onSelectedDeptsChange?: (depts: string[]) => void;
  selectedRegions?: string[];
  onSelectedRegionsChange?: (regions: string[]) => void;
  ville?: string;
  onVilleChange?: (ville: string) => void;
  scope?: 'metro' | 'all' | null;
  onScopeChange?: (scope: 'metro' | 'all' | null) => void;
}

// ─── Main component ───────────────────────────────────────────────────────────
export function FilterPanel({
  chatSlot,
  sendMessage, onDirectOOH, onDirectSearch, onDirectBattle, onDirectBattleV2, onFillIsochroneCache, onApplyBattle, isLoading, error, zoneData,
  densityMode, onDensityModeChange,
  voronoiVisible, setVoronoiVisible,
  battleVisible, setBattleVisible,
  battleOuterFillVisible, setBattleOuterFillVisible,
  isochroneVisible, setIsochroneVisible,
  setShowSavePanel,
  onPOIStylesChange,
  onFlyTo,
  carreauxVisible, carreauxLoaded, carreauxIndicateur, carreauxPalette,
  carreauxOpacity, carreauxRange, carreauxSelectedBucket,
  setCarreauxVisible, setCarreauxIndicateur, setCarreauxPalette, setCarreauxOpacity, setCarreauxSelectedBucket,
  irisVisible, irisIndicateur, irisPalette, irisOpacity, irisStats, irisTrueOnly,
  setIrisVisible, setIrisIndicateur, setIrisPalette, setIrisOpacity, setIrisTrueOnly,
  mainMapRef,
  onLoadTransport, onLoadTMJA, tmjaVisible, onClearTMJA,
  tmjaHideLowTraffic = true, onToggleTmjaHideLowTraffic,
  onOpenMeteo, onClearMeteo, meteoVisible, meteoLabel,
  civicVariableCode, onCivicVariableChange, onPondererCivicVariable,
  selectedIrisCommuneCode, selectedIrisCommuneName,
  civicHealthLayer = null, onCivicHealthLayerChange,
  civicProgress, civicLoading,
  civicScale = 'departement', onCivicScaleChange,
  civicMetric = 'global', onCivicMetricChange,
  civicMinLevel = 0, onCivicMinLevelChange,
  civicCpStatus, civicCpDate, onCivicIngested,
  radioVisible, onToggleRadio, radioHeatmapMode, onToggleRadioHeatmap,
  radioCoverageMode, onToggleRadioCoverage, radioLoading,
  radioSystemeFilter, onRadioSystemeChange, onSelectRadio,
  radioCount, radioSelectedNom, onClearRadioSelection,
  radioFilterIds, onRadioFilterIdsChange,
  radioExcludeCategories, onRadioExcludeCategoriesChange,
  radioFilterOptions,
  radioCoverageColor, onRadioCoverageColorChange,
  radioCoverageOpacity, onRadioCoverageOpacityChange,
  radioBorderWidth, onRadioBorderWidthChange,
  radioPointSize, onRadioPointSizeChange,
  onRecenterFrance,
  visibleCategory,
  selectedPOI: selectedPOIProp, onSelectedPOIChange,
  selectedDepts:   selectedDeptsProp,   onSelectedDeptsChange,
  selectedRegions: selectedRegionsProp, onSelectedRegionsChange,
  ville:           villeProp,           onVilleChange,
  scope:           scopeProp,           onScopeChange,
}: FilterPanelProps) {
  const isOverlayMode = !!visibleCategory;

  // ── UX: Search filter ──────────────────────────────────────────────────────
  const [filterSearch, setFilterSearch] = useState('');

  // ── UX: Collapsible sections with localStorage memory ─────────────────────
  const SECTION_KEYS = ['perimetre', 'regions', 'departements', 'recherche', 'poi', 'ooh', 'transport', 'tmja', 'meteo', 'radio', 'civicHealth'] as const;
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>(() => {
    // Sections fermées par défaut : santé environnementale (zone-spécifique,
    // s'ouvre automatiquement au premier IRIS sélectionné).
    const DEFAULT_CLOSED = new Set(['civicHealth']);
    // En mode overlay, sections territoriales (périmètre / régions / départements)
    // ouvertes par défaut — le user doit pouvoir filtrer la zone AVANT d'afficher
    // les POI, sinon la carte charge toute la France. Autres sections fermées.
    if (isOverlayMode) {
      const TERRITORY_OPEN = new Set(['perimetre', 'regions', 'departements']);
      return Object.fromEntries(SECTION_KEYS.map(k => [k, TERRITORY_OPEN.has(k)]));
    }
    const allOpen = (): Record<string, boolean> =>
      Object.fromEntries(SECTION_KEYS.map(k => [k, !DEFAULT_CLOSED.has(k)]));
    if (typeof window === 'undefined') return allOpen();
    try {
      const saved = localStorage.getItem('magelian-filter-sections');
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        // Garantit que les nouvelles sections ajoutées plus tard ont une valeur cohérente.
        for (const k of SECTION_KEYS) {
          if (!(k in parsed)) parsed[k] = !DEFAULT_CLOSED.has(k);
        }
        return parsed;
      }
    } catch { /* ignore */ }
    return allOpen();
  });

  // Auto-déploiement de la section "Santé environnementale" au premier IRIS
  // sélectionné de la session. Si l'utilisateur la referme après, on respecte
  // son choix : le ref bloque les ouvertures suivantes.
  const civicHealthAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (selectedIrisCommuneCode && !civicHealthAutoOpenedRef.current) {
      civicHealthAutoOpenedRef.current = true;
      setSectionsOpen(prev => (prev.civicHealth ? prev : { ...prev, civicHealth: true }));
    }
  }, [selectedIrisCommuneCode]);

  // Ingestion santé environnementale (admin) — POST NDJSON streaming,
  // progression affichée dans le bloc. La route enforce requireAdmin (403 → message).
  const [civicIngestState, setCivicIngestState] = useState<{
    running: boolean; message: string | null; error: string | null;
  }>({ running: false, message: null, error: null });

  const runCivicIngestStream = useCallback(async () => {
    setCivicIngestState({ running: true, message: 'Démarrage…', error: null });
    try {
      const res = await adminFetch('/api/admin/civic-ingest', { method: 'POST' });
      if (res.status === 403) throw new Error('Réservé aux administrateurs.');
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          if (!raw.trim()) continue;
          try {
            const line = JSON.parse(raw) as {
              type: string;
              message?: string;
              summary?: {
                pollen: { cps_written?: number; date?: string; error?: string };
                atmo: { cps_written?: number; date?: string; error?: string };
              };
            };
            if (line.type === 'progress' && line.message) {
              setCivicIngestState({ running: true, message: line.message, error: null });
            } else if (line.type === 'done') {
              const parts: string[] = [];
              if (line.summary?.pollen?.cps_written != null) parts.push(`pollen ${line.summary.pollen.cps_written} CP`);
              if (line.summary?.atmo?.cps_written != null) parts.push(`air ${line.summary.atmo.cps_written} CP`);
              setCivicIngestState({
                running: false,
                message: `Terminé : ${parts.join(' · ') || 'aucune donnée'}`,
                error: null,
              });
              onCivicIngested?.();
            } else if (line.type === 'error') {
              throw new Error(line.message ?? 'Erreur inconnue');
            }
          } catch (err) {
            if (err instanceof SyntaxError) continue; // ligne NDJSON partielle
            throw err;
          }
        }
      }
    } catch (err) {
      setCivicIngestState({
        running: false, message: null,
        error: err instanceof Error ? err.message : 'Erreur inconnue',
      });
    }
  }, [onCivicIngested]);
  const toggleSection = (key: string) => {
    setSectionsOpen(prev => {
      const next = { ...prev, [key]: !prev[key] };
      // Pas de persistance en mode overlay pour ne pas polluer l'état full-panel
      if (!isOverlayMode) {
        try { localStorage.setItem('magelian-filter-sections', JSON.stringify(next)); } catch { /* ignore */ }
      }
      return next;
    });
  };
  const collapseAll = () => {
    const next = Object.fromEntries(SECTION_KEYS.map(k => [k, false]));
    setSectionsOpen(next);
    try { localStorage.setItem('magelian-filter-sections', JSON.stringify(next)); } catch { /* ignore */ }
  };
  const expandAll = () => {
    const next = Object.fromEntries(SECTION_KEYS.map(k => [k, true]));
    setSectionsOpen(next);
    try { localStorage.setItem('magelian-filter-sections', JSON.stringify(next)); } catch { /* ignore */ }
  };

  // ── Panel resize ──────────────────────────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState(320);
  const isResizingRef   = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWRef = useRef(0);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    isResizingRef.current   = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWRef.current = panelWidth;
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newW = Math.max(260, Math.min(720, resizeStartWRef.current + ev.clientX - resizeStartXRef.current));
      setPanelWidth(newW);
    };
    const onMouseUp = () => {
      isResizingRef.current          = false;
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  }, [panelWidth]);

  // ── POI types dynamiques (chargés depuis la DB) ───────────────────────────
  const [poiTypes, setPoiTypes] = useState<{ id: string; label: string }[]>([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState<string | null>(null);

  // ── POI natures (metadata->>'libelle_nature' par categorie) ───────────────
  const [poiNatures, setPoiNatures] = useState<Record<string, string[]>>({});
  const [selectedPoiNatures, setSelectedPoiNatures] = useState<Record<string, string[]>>({});
  const fetchedNaturesRef = useRef<Set<string>>(new Set());

  const fetchPoiNatures = async (poiType: string) => {
    if (fetchedNaturesRef.current.has(poiType)) return;
    fetchedNaturesRef.current.add(poiType);
    try {
      const res = await fetch(`/api/map/poi-natures?categorie=${encodeURIComponent(poiType)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.natures) && data.natures.length > 0) {
        setPoiNatures(prev => ({ ...prev, [poiType]: data.natures }));
      }
    } catch { /* ignore */ }
  };
  // Fetch catégories avec retry auto (1 retry après 800ms) — couvre le cas
  // HMR/restart dev où le 1er appel arrive avant que le serveur soit prêt.
  // cache: 'no-store' évite que Next.js dev serve une réponse cachée stale.
  const fetchCategories = (forceRefresh = false, isRetry = false) => {
    setCatsLoading(true);
    setCatsError(null);
    fetch(
      forceRefresh ? '/api/map/categories?refresh=1' : '/api/map/categories',
      { cache: 'no-store' },
    )
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (Array.isArray(data.categories)) {
          setPoiTypes(data.categories.map((c: { id: string; label: string } | string) =>
            typeof c === 'string'
              ? { id: c, label: c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ') }
              : c
          ));
          setCatsError(null);
        } else {
          setCatsError(data.error ?? 'Réponse inattendue');
        }
      })
      .catch((err: Error) => {
        // Retry automatique 1 fois après 800ms si pas déjà un retry
        if (!isRetry) {
          setTimeout(() => fetchCategories(forceRefresh, true), 800);
          return;
        }
        setCatsError(err.message);
      })
      .finally(() => setCatsLoading(false));
  };
  // Chargement unique au montage. NE PAS ajouter `fetchCategories` en
  // dependance : la fonction est recreee a chaque render, l'effet
  // rejouerait donc un fetch a chaque render — budget I/O Supabase Nano.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- voir ci-dessus
  useEffect(() => { fetchCategories(); }, []);

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('geoprompt');
  // activeExpertTab supprimé — panel unique scrollable (Sprint 1)

  // ── OOH / DOOH state ──────────────────────────────────────────────────────
  // Régies disponibles dans panneaux_affichage (source: Brest Métropole)
  const OOH_REGIES = [
    { id: 'DECAUX',       label: 'JCDecaux' },
    { id: 'Clear Chanel', label: 'Clear Channel' },
    { id: 'SIGNALI',      label: 'Signali' },
    { id: 'PUBLI ESPACE', label: 'Publi Espace' },
    { id: 'AFFIOUEST',    label: 'Affiouest' },
    { id: 'PUB OCEANNE',  label: 'Pub Océanne' },
    { id: 'PROMOVIL',     label: 'Promovil' },
    { id: 'RDPP',         label: 'RDPP' },
  ];
  const [selectedOOH, setSelectedOOH] = useState<string[]>([]);

  // ── Transport en commun ───────────────────────────────────────────────────
  const TRANSPORT_TYPES = [
    { id: 'bus',   label: 'Bus' },
    { id: 'train', label: 'Train' },
    { id: 'tram',  label: 'Tramway' },
    { id: 'metro', label: 'Métro' },
  ];
  const [selectedTransportTypes, setSelectedTransportTypes] = useState<string[]>([]);
  const [transportLoading, setTransportLoading]             = useState(false);

  // ── TMJA ──────────────────────────────────────────────────────────────────
  const [tmjaLoading, setTmjaLoading] = useState(false);

  // ── Analyse accordions ────────────────────────────────────────────────────
  const [analyseOpen, setAnalyseOpen] = useState<Record<string, boolean>>({
    spatiale: false, iris: false, carreaux: false,
  });
  const toggleAnalyse = (key: string) =>
    setAnalyseOpen(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Territoire state ──────────────────────────────────────────────────────
  // Controlled si props fournies (lift à page.tsx pour persistance entre
  // fermeture/réouverture des overlays — les analyses doivent voir les
  // filtres territoriaux courants), sinon fallback uncontrolled.
  const [internalScope,           setInternalScope]           = useState<'metro' | 'all' | null>(null);
  const [internalSelectedRegions, setInternalSelectedRegions] = useState<string[]>([]);
  const [internalSelectedDepts,   setInternalSelectedDepts]   = useState<string[]>([]);
  const [internalVille,           setInternalVille]           = useState('');

  const scope           = scopeProp           !== undefined ? scopeProp           : internalScope;
  const selectedRegions = selectedRegionsProp !== undefined ? selectedRegionsProp : internalSelectedRegions;
  const selectedDepts   = selectedDeptsProp   !== undefined ? selectedDeptsProp   : internalSelectedDepts;
  const ville           = villeProp           !== undefined ? villeProp           : internalVille;

  const setScope = useCallback((next: 'metro' | 'all' | null | ((prev: 'metro' | 'all' | null) => 'metro' | 'all' | null)) => {
    const value = typeof next === 'function' ? (next as (p: 'metro' | 'all' | null) => 'metro' | 'all' | null)(scope) : next;
    if (onScopeChange) onScopeChange(value);
    else setInternalScope(value);
  }, [scope, onScopeChange]);

  const setSelectedRegions = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    const value = typeof next === 'function' ? (next as (p: string[]) => string[])(selectedRegions) : next;
    if (onSelectedRegionsChange) onSelectedRegionsChange(value);
    else setInternalSelectedRegions(value);
  }, [selectedRegions, onSelectedRegionsChange]);

  const setSelectedDepts = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    const value = typeof next === 'function' ? (next as (p: string[]) => string[])(selectedDepts) : next;
    if (onSelectedDeptsChange) onSelectedDeptsChange(value);
    else setInternalSelectedDepts(value);
  }, [selectedDepts, onSelectedDeptsChange]);

  const setVille = useCallback((next: string | ((prev: string) => string)) => {
    const value = typeof next === 'function' ? (next as (p: string) => string)(ville) : next;
    if (onVilleChange) onVilleChange(value);
    else setInternalVille(value);
  }, [ville, onVilleChange]);
  const [codePostal,      setCodePostal]      = useState('');

  // ── Données géographiques DB (ref_regions / ref_departements) ─────────────
  // Source unique de vérité : codes INSEE ('53' Bretagne, '84' ARA, etc.).
  // Pendant le 1er mount (fetch en cours), les listes sont vides — loading
  // propre, la MultiDropdown affiche "Aucun résultat" jusqu'au cache hit.
  const { data: refGeo, allDepts: REF_ALL_DEPTS } = useRefGeo();
  const REF_REGIONS = useMemo(() => refGeo?.regions ?? [], [refGeo]);

  // ── Custom geo capture : branchement filtre admin actif ───────────────────
  // Priorite : depts (plus precis) > regions. 1 seul scale a la fois.
  // Les valeurs dans selectedRegions / selectedDepts sont les VRAIS codes
  // INSEE (ref_regions.code_region / ref_departements.code_dept) — on les
  // envoie tels quels aux RPCs territory-mask / capture.
  const adminScale: 'region' | 'departement' | null =
    selectedDepts.length > 0 ? 'departement' :
    selectedRegions.length > 0 ? 'region' : null;
  // useMemo indispensable : sans lui, la branche `[]` fabrique un tableau neuf
  // à chaque render, ce qui invalide `getAdminGeom` et fait rejouer l'effet du
  // masque territoire (démontage/remontage des couches MapLibre) en continu.
  const adminCodes = useMemo(
    () => (adminScale === 'departement' ? selectedDepts : adminScale === 'region' ? selectedRegions : []),
    [adminScale, selectedDepts, selectedRegions],
  );
  const getAdminGeom = useCallback(async (): Promise<ContributedGeometry> => {
    if (!adminScale || adminCodes.length === 0) return null;
    const res = await adminFetch('/api/custom-geo/source/admin', {
      method: 'POST',
      body: JSON.stringify({ scale: adminScale, codes: adminCodes }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data?.geometry ?? null) as ContributedGeometry;
  }, [adminScale, adminCodes]);

  useCustomGeoLayer({
    id: 'map-admin-filter',
    sourceType: 'admin_filter',
    label: adminScale === 'departement'
      ? `Departements (${adminCodes.join(', ')})`
      : adminScale === 'region'
      ? `Regions (${adminCodes.length})`
      : 'Filtre territorial',
    enabled: adminScale !== null && adminCodes.length > 0,
    getGeometry: getAdminGeom,
    metadata: { scale: adminScale, codes: adminCodes },
  });

  // Scope global : declare le filtre territorial comme scope actif pour les
  // autres modules spatiaux (Carreaux/TMJA/Voronoi). Si l'user a un filtre
  // dept ou region, leur capture sera prioritairement scopee dessus.
  const { setActiveScope } = useCustomGeoCaptureContext();
  useEffect(() => {
    if (adminScale && adminCodes.length > 0) {
      const scope: AdminScope = { scale: adminScale, codes: adminCodes };
      setActiveScope(scope);
    } else {
      setActiveScope(null);
    }
  }, [adminScale, adminCodes, setActiveScope]);

  // ── Mode "Afficher uniquement le territoire filtre" ─────────────────────
  // Toggle qui ajoute un layer mask sur la carte : assombrit tout sauf le
  // territoire selectionne. L'user voit exactement ce qui sera capture.
  const [territoryMaskEnabled, setTerritoryMaskEnabled] = useState(false);
  const territoryMaskCacheRef = useRef<{ key: string; geom: GeoJSON.MultiPolygon | null } | null>(null);

  useEffect(() => {
    const map = mainMapRef?.current;
    if (!map) return;

    const cleanup = () => {
      try {
        if (map.getLayer('territory-mask-fill')) map.removeLayer('territory-mask-fill');
        if (map.getLayer('territory-mask-border')) map.removeLayer('territory-mask-border');
        if (map.getSource('territory-mask')) map.removeSource('territory-mask');
      } catch { /* noop */ }
    };

    if (!territoryMaskEnabled || !adminScale || adminCodes.length === 0) {
      cleanup();
      return;
    }

    const cacheKey = `${adminScale}::${adminCodes.slice().sort().join(',')}`;
    let cancelled = false;

    // Reorder : place le mask juste sous le premier layer de type symbol (labels).
    // Resultat : mask au-dessus des data layers (carreaux/POI/voronoi/IRIS) →
    // ils sont clippes visuellement par le mask hors-territoire. Mais reste sous
    // les labels villes/pays → labels lisibles.
    const reorderMask = () => {
      try {
        const layers = map.getStyle()?.layers ?? [];
        const firstSymbol = layers.find(l =>
          l.type === 'symbol' && l.id !== 'territory-mask-fill' && l.id !== 'territory-mask-border'
        );
        const beforeId = firstSymbol?.id;
        if (map.getLayer('territory-mask-fill')) {
          map.moveLayer('territory-mask-fill', beforeId);
        }
        if (map.getLayer('territory-mask-border')) {
          map.moveLayer('territory-mask-border', beforeId);
        }
      } catch { /* race condition pendant style swap, ignorer */ }
    };

    const applyMask = (territoryGeom: GeoJSON.MultiPolygon) => {
      if (cancelled) return;
      cleanup();
      // Ring monde : sens antihoraire (CCW) lat 84.999 pour eviter artefacts Mercator.
      const worldRing: number[][] = [
        [-180, 84.999], [180, 84.999], [180, -84.999], [-180, -84.999], [-180, 84.999],
      ];
      const holes: number[][][] = territoryGeom.coordinates.map(polygon => polygon[0]);
      const maskFeature: GeoJSON.Feature<GeoJSON.Polygon> = {
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [worldRing, ...holes] },
      };
      const territoryFeature: GeoJSON.Feature<GeoJSON.MultiPolygon> = {
        type: 'Feature', properties: {}, geometry: territoryGeom,
      };
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection', features: [maskFeature, territoryFeature],
      };
      try {
        map.addSource('territory-mask', { type: 'geojson', data: fc });
        map.addLayer({
          id: 'territory-mask-fill',
          type: 'fill',
          source: 'territory-mask',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': '#000000', 'fill-opacity': 0.75 },
        });
        map.addLayer({
          id: 'territory-mask-border',
          type: 'line',
          source: 'territory-mask',
          filter: ['==', ['geometry-type'], 'MultiPolygon'],
          paint: { 'line-color': '#4ecdc4', 'line-width': 3 },
        });
        reorderMask();
      } catch (err) {
        console.warn('[territory-mask] add layer failed', err);
      }
    };

    // Re-reorder a chaque ajout de layer (carreaux, IRIS, etc.) qui passerait
    // automatiquement au-dessus du mask sinon. styledata = trigger MapLibre
    // pour tout changement structurel du style. sourcedata = trigger pour
    // chaque tuile MVT chargee tardivement dans une source existante.
    map.on('styledata',  reorderMask);
    map.on('sourcedata', reorderMask);

    // Cache hit : re-applique direct
    if (territoryMaskCacheRef.current && territoryMaskCacheRef.current.key === cacheKey) {
      const cached = territoryMaskCacheRef.current.geom;
      if (cached) applyMask(cached);
      return () => {
        cancelled = true;
        try { map.off('styledata',  reorderMask); } catch { /* noop */ }
        try { map.off('sourcedata', reorderMask); } catch { /* noop */ }
        cleanup();
      };
    }

    // Sinon fetch
    adminFetch('/api/map/territory-mask', {
      method: 'POST',
      body: JSON.stringify({ scale: adminScale, codes: adminCodes }),
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: { geometry: GeoJSON.MultiPolygon | null } | null) => {
        if (cancelled) return;
        const geom = data?.geometry ?? null;
        territoryMaskCacheRef.current = { key: cacheKey, geom };
        if (geom) applyMask(geom);
      })
      .catch(() => { /* silent */ });

    return () => {
      cancelled = true;
      try { map.off('styledata',  reorderMask); } catch { /* noop */ }
      try { map.off('sourcedata', reorderMask); } catch { /* noop */ }
      cleanup();
    };
  }, [territoryMaskEnabled, adminScale, adminCodes, mainMapRef]);

  // ── Audience state ────────────────────────────────────────────────────────

  // ── Analyses state ────────────────────────────────────────────────────────
  // POI sélection : controlled si props fournies (lift à page.tsx pour persistance
  // overlay close→reopen), sinon fallback uncontrolled.
  const [internalSelectedPOI, setInternalSelectedPOI] = useState<string[]>([]);
  const selectedPOI = selectedPOIProp ?? internalSelectedPOI;
  const setSelectedPOI = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    const value = typeof next === 'function'
      ? (next as (prev: string[]) => string[])(selectedPOI)
      : next;
    if (onSelectedPOIChange) onSelectedPOIChange(value);
    else setInternalSelectedPOI(value);
  }, [selectedPOI, onSelectedPOIChange]);

  useEffect(() => {
    for (const poi of selectedPOI) fetchPoiNatures(poi);
  }, [selectedPOI]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── POI pin styles ─────────────────────────────────────────────────────────
  const PIN_SIZES = ['Petite', 'Standard', 'Grosse', 'Large'] as const;
  const PIN_COLORS: { label: string; hex: string }[] = [
    { label: 'Noir',    hex: 'var(--bg-level-2)' },
    { label: 'Blanc',   hex: '#eeeeee' },
    { label: 'Gris',    hex: '#888888' },
    { label: 'Violet',  hex: '#a855f7' },
    { label: 'Vert',    hex: '#3dffa0' },
    { label: 'Cyan',    hex: '#00d4ff' },
    { label: 'Rouge',   hex: '#ff4444' },
    { label: 'Orange',  hex: '#ff8c00' },
    { label: 'Jaune',   hex: '#ffd700' },
    { label: 'Bleu',    hex: '#3b82f6' },
  ];
  const [poiStyles, setPoiStyles] = useState<Record<string, { size: string; color: string }>>({});
  const getPOIStyle = (poi: string) => poiStyles[poi] ?? { size: 'Standard', color: '#a0a0a0' };
  const setPOIStyle = (poi: string, patch: Partial<{ size: string; color: string }>) =>
    setPoiStyles(prev => ({ ...prev, [poi]: { ...getPOIStyle(poi), ...patch } }));
  useEffect(() => { onPOIStylesChange?.(poiStyles); }, [poiStyles, onPOIStylesChange]);
  const [poisRayon,     setPoisRayon]     = useState<string | null>(null);
  const [showVoronoi,      setShowVoronoi]      = useState(false);
  const [showBattle,       setShowBattle]       = useState(false);
  const [showBattleV2,     setShowBattleV2]     = useState(false);
  const [transportMode,    setTransportMode]    = useState('drive');
  const [isoDurations,     setIsoDurations]     = useState<number[]>([10, 30]);
  const [battleV2Paliers,  setBattleV2Paliers]  = useState<number[]>([10, 20, 30, 40, 50, 60, 90]);
  const [battleV2Loading,  setBattleV2Loading]  = useState(false);
  const [battleV2Log,      setBattleV2Log]      = useState<string[]>([]);

  // ── Cache check state ──────────────────────────────────────────────────────
  type CacheStatus = { total_pois: number; total_combos: number; cached_combos: number; missing_combos: number; missing_pois: number; cached_pois: number } | null;
  const [v2CacheStatus,   setV2CacheStatus]   = useState<CacheStatus>(null);
  const [v2Checking,      setV2Checking]      = useState(false);
  const [v2Filling,       setV2Filling]       = useState(false);
  const [v2FillTotal,     setV2FillTotal]     = useState(0);
  const [v2FillCompleted, setV2FillCompleted] = useState(0);
  const [v2FillPct,       setV2FillPct]       = useState(0);
  const [v2FillRings,     setV2FillRings]     = useState(0);
  const [orsCacheStatus,  setOrsCacheStatus]  = useState<CacheStatus>(null);
  const [orsChecking,     setOrsChecking]     = useState(false);

  // ── Geographic cascade ────────────────────────────────────────────────────
  // Cascade : si des régions sont sélectionnées, on limite les départements
  // aux depts de ces régions. Sinon tous les départements (attention : tant
  // que refGeo n'est pas chargé, REF_ALL_DEPTS est [] → la liste apparaît
  // vide le temps du 1er fetch, puis se remplit au cache hit).
  const availableDepts = useMemo(() =>
    selectedRegions.length === 0 ? REF_ALL_DEPTS
      : REF_REGIONS.filter(r => selectedRegions.includes(r.code_region)).flatMap(r => r.depts),
    [selectedRegions, REF_ALL_DEPTS, REF_REGIONS],
  );
  useEffect(() => {
    // Ne jamais purger la sélection si la cascade n'est pas encore chargée
    // (sinon on perd la sélection user pendant le 1er fetch).
    if (availableDepts.length === 0 && REF_ALL_DEPTS.length === 0) return;
    const codes = availableDepts.map(d => d.code_dept);
    // Bail-out référentiel : renvoyer prev tel quel si rien n'est purgé,
    // sinon setState reçoit un nouveau tableau à chaque passage → boucle infinie.
    setSelectedDepts(prev => {
      const next = prev.filter(d => codes.includes(d));
      return next.length === prev.length ? prev : next;
    });
  }, [availableDepts, REF_ALL_DEPTS]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectScope = (s: 'metro' | 'all') => {
    setScope(prev => prev === s ? null : s);
    setSelectedRegions([]); setSelectedDepts([]); setVille(''); setCodePostal('');
  };

  // ── Territoire helpers ────────────────────────────────────────────────────
  const buildTerritoire = (): string => {
    if (ville.trim()) return `à ${ville.trim()}${codePostal ? ` (${codePostal})` : ''}`;
    if (selectedDepts.length === 1) {
      const d = REF_ALL_DEPTS.find(x => x.code_dept === selectedDepts[0]);
      return `dans le département ${selectedDepts[0]}${d ? ` — ${d.nom_dept}` : ''}`;
    }
    if (selectedDepts.length > 1) return `dans les départements ${selectedDepts.join(', ')}`;
    if (selectedRegions.length === 1) {
      const r = REF_REGIONS.find(x => x.code_region === selectedRegions[0]);
      return `en ${r?.nom_region ?? selectedRegions[0]}`;
    }
    if (selectedRegions.length > 1) {
      const names = selectedRegions.map(code => REF_REGIONS.find(r => r.code_region === code)?.nom_region ?? code);
      return `en ${names.join(' et ')}`;
    }
    if (scope === 'metro') return 'de France métropolitaine';
    if (scope === 'all')   return 'de France entière';
    return 'de France';
  };

  const territoire    = buildTerritoire();
  const hasTerritoire = scope !== null || selectedRegions.length > 0 || selectedDepts.length > 0 || ville.trim().length > 0;

  // ── Analyses logic ────────────────────────────────────────────────────────
  const exactlyOnePOI = selectedPOI.length === 1;
  const hasAnyPOI     = selectedPOI.length > 0;

  const toggleDuration = (d: number) => {
    setOrsCacheStatus(null);
    setIsoDurations(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b));
  };


  // ── Actions ───────────────────────────────────────────────────────────────
  const send = (text: string) => { if (!isLoading) sendMessage(text); };


  const [searchLoading,    setSearchLoading]    = useState(false);
  const [battleLoading,    setBattleLoading]    = useState(false);
  const [battleLog,        setBattleLog]        = useState<string[]>([]);
  const [battleGeometry,   setBattleGeometry]   = useState<string>('');
  const [battleMeta,       setBattleMeta]       = useState<{ categorie: string; mode: string } | null>(null);
  const [battlePoiGroups,    setBattlePoiGroups]    = useState<{ id: string; nom: string; geometries: string[] }[]>([]);
  const [battleRings,        setBattleRings]        = useState<{ cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: string }[]>([]);
  const [battleApplyLoading, setBattleApplyLoading] = useState(false);
  const [battleApplyPct,     setBattleApplyPct]     = useState(0);
  const [battleProgress,     setBattleProgress]     = useState(0);
  const [battleTotal,        setBattleTotal]        = useState(0);
  const [battleCompleted,    setBattleCompleted]    = useState(0);
  const battleTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const battleStartRef   = useRef<number>(0);

  const handleSearchPOI = async () => {
    if (!hasAnyPOI || searchLoading) return;
    setSearchLoading(true);
    try {
      await onDirectSearch({
        poi_types: selectedPOI,
        scope,
        regions: selectedRegions,
        depts: selectedDepts,
        ville,
        rayon_poi: poisRayon,
        poi_natures: Object.fromEntries(
          Object.entries(selectedPoiNatures).filter(([, v]) => v.length > 0)
        ),
      });
    } finally {
      setSearchLoading(false);
    }
  };

  const handleVoronoi = () => {
    if (!exactlyOnePOI) return;
    const msg = `Fais le Voronoi des ${selectedPOI[0]} ${territoire}`;
    logger.debug('FilterPanel', `handleVoronoi → ${msg} | isLoading: ${isLoading}`);
    send(msg);
  };

  // ── Vérification cache — partagée ORS + V2 ────────────────────────────────
  const buildCheckParams = (paliers: number[]) => ({
    category:       selectedPOI[0],
    mode:           transportMode,
    paliers,
    metropolitaine: !selectedRegions.includes('dom'),
    filtre_ville:   ville || undefined,
    filtre_regions: (selectedRegions.length > 0 && (REF_REGIONS.length === 0 || selectedRegions.length < REF_REGIONS.length))
                      ? selectedRegions : undefined,
    filtre_depts:   selectedDepts.length > 0 ? selectedDepts : undefined,
  });

  const handleCheckV2 = async () => {
    if (!exactlyOnePOI || battleV2Paliers.length === 0) return;
    setV2Checking(true);
    setV2CacheStatus(null);
    try {
      const res  = await fetch('/api/isochrone-cache-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildCheckParams(battleV2Paliers)) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setV2CacheStatus(data);
    } catch (e: unknown) {
      setBattleV2Log(prev => [...prev, `> ✕ Erreur vérif. cache : ${e instanceof Error ? e.message : 'Erreur inconnue'}`]);
    } finally {
      setV2Checking(false);
    }
  };

  const handleCheckORS = async () => {
    if (!exactlyOnePOI || isoDurations.length === 0) return;
    setOrsChecking(true);
    setOrsCacheStatus(null);
    try {
      const res  = await fetch('/api/isochrone-cache-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildCheckParams(isoDurations)) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setOrsCacheStatus(data);
    } catch (e: unknown) {
      setBattleLog(prev => [...prev, `> ✕ Erreur vérif. cache : ${e instanceof Error ? e.message : 'Erreur inconnue'}`]);
    } finally {
      setOrsChecking(false);
    }
  };

  // Remplir le cache manquant via ORS (pour V2) — streaming carte + progress détaillée
  const handleFillMissingV2 = async () => {
    if (!exactlyOnePOI || battleV2Paliers.length === 0 || v2Filling) return;
    setV2Filling(true);
    setV2CacheStatus(null);
    setV2FillTotal(0);
    setV2FillCompleted(0);
    setV2FillPct(0);
    setV2FillRings(0);
    setBattleV2Log([
      `> [ORS] Calcul des isochrones manquants...`,
      `> catégorie : ${selectedPOI[0]} | mode : ${transportMode}`,
      `> paliers : ${battleV2Paliers.join(', ')} min`,
    ]);
    try {
      await onFillIsochroneCache(
        {
          category:       selectedPOI[0],
          mode:           transportMode,
          durations:      [...battleV2Paliers].sort((a, b) => a - b),
          max_minutes:    Math.max(...battleV2Paliers),
          filtre_ville:   ville || undefined,
          filtre_regions: (selectedRegions.length > 0 && (REF_REGIONS.length === 0 || selectedRegions.length < REF_REGIONS.length)) ? selectedRegions : undefined,
          filtre_depts:   selectedDepts.length > 0 ? selectedDepts : undefined,
          metropolitaine: !selectedRegions.includes('dom'),
        },
        (msg: string) => {
          // Parser "N POIs trouvés" → total
          const mTotal = msg.match(/(\d+) POIs trouv/);
          if (mTotal) { setV2FillTotal(Number(mTotal[1])); setBattleV2Log(prev => [...prev, `> ${msg}`]); return; }

          // Parser "X/Y POIs traités — Z%" → progress
          const mProgress = msg.match(/(\d+)\/(\d+) POIs traités.*?(\d+)%/);
          if (mProgress) {
            const [, done, total, pct] = mProgress.map(Number);
            setV2FillCompleted(done);
            setV2FillTotal(total);
            setV2FillPct(pct);
            // Mise à jour in-place de la ligne de progress dans le log
            setBattleV2Log(prev => {
              const line = `> ORS — ${done}/${total} POIs — ${pct}%`;
              const lastIdx = prev.map((l, i) => l.startsWith('> ORS —') ? i : -1).filter(i => i >= 0).pop();
              if (lastIdx !== undefined) { const next = [...prev]; next[lastIdx] = line; return next; }
              return [...prev, line];
            });
            return;
          }

          // Parser "+N isochrones sur la carte" → compteur anneaux
          const mRings = msg.match(/\+(\d+) isochrones/);
          if (mRings) {
            setV2FillRings(prev => prev + Number(mRings[1]));
            setBattleV2Log(prev => {
              const line = `> ◆ ${msg.replace('> ', '')}`;
              // Mise à jour in-place si c'est une ligne ◆
              const lastIdx = prev.map((l, i) => l.startsWith('> ◆') ? i : -1).filter(i => i >= 0).pop();
              if (lastIdx !== undefined) { const next = [...prev]; next[lastIdx] = line; return next; }
              return [...prev, line];
            });
            return;
          }

          // Autres messages → append direct
          if (msg.trim()) setBattleV2Log(prev => [...prev, `> ${msg.replace(/^> /, '')}`]);
        },
      );
      setV2FillPct(100);
      setBattleV2Log(prev => [...prev, `> ✓ Cache rempli (${v2FillRings || '?'} isochrones) — lancement Bataille V2...`]);
      // Re-vérifier le statut cache
      const checkRes = await fetch('/api/isochrone-cache-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildCheckParams(battleV2Paliers)),
      });
      if (checkRes.ok) setV2CacheStatus(await checkRes.json());
      // Auto-lancer Bataille V2 maintenant que le cache est complet
      setV2Filling(false);
      await handleBattleV2(false);
      return;
    } catch (e: unknown) {
      if (!(e instanceof Error && e.name === 'AbortError')) setBattleV2Log(prev => [...prev, `> ✕ ${e instanceof Error ? e.message : 'Erreur inconnue'}`]);
    } finally {
      setV2Filling(false);
    }
  };

  const handleBattle = async (force = false) => {
    if (!exactlyOnePOI || isoDurations.length === 0 || battleLoading) return;
    setOrsCacheStatus(null);
    const maxMin = Math.max(...isoDurations);
    const params: DirectBattleParams = {
      category:          selectedPOI[0],
      mode:              transportMode,
      max_minutes:       maxMin,
      durations:         [...isoDurations].sort((a, b) => a - b),
      filtre_ville:      ville || undefined,
      // Quand toutes les régions sont sélectionnées = pas de filtre (évite les mismatches DB)
      filtre_regions:    (selectedRegions.length > 0 && (REF_REGIONS.length === 0 || selectedRegions.length < REF_REGIONS.length))
                           ? selectedRegions : undefined,
      filtre_depts:      selectedDepts.length > 0 ? selectedDepts : undefined,
      metropolitaine:    !selectedRegions.includes('dom'),
      force_recalculate: force,
    };
    logger.debug('FilterPanel', `handleBattle → direct API ${params}`);
    const territoireLabel = params.filtre_ville
      ?? (selectedDepts.length > 0 ? `${selectedDepts.length} dept(s)` : null)
      ?? (selectedRegions.length > 0 ? selectedRegions.map(code => REF_REGIONS.find(r => r.code_region === code)?.nom_region ?? code).join(' + ') : null)
      ?? 'France métropolitaine';
    setBattleProgress(0);
    setBattleTotal(0);
    setBattleCompleted(0);
    setBattleLog([
      `> catégorie : ${params.category}`,
      `> mode : ${params.mode} | max : ${maxMin} min`,
      `> territoire : ${territoireLabel}`,
      `> [1/3] vérification cache isochrones...`,
    ]);
    setBattleLoading(true);
    battleStartRef.current = Date.now();
    // ticker — affiche le temps écoulé et des étapes simulées
    let tick = 0;
    battleTimerRef.current = setInterval(() => {
      tick++;
      const elapsed = ((Date.now() - battleStartRef.current) / 1000).toFixed(1);
      setBattleLog(prev => {
        const msgs = [...prev];
        if (tick === 3)  msgs.push('> [2/3] appel ORS (peut prendre 30-120s)...');
        if (tick === 10) msgs.push('> ! premier batch ORS en cours...');
        if (tick === 20) msgs.push('> ! batches suivants en cours...');
        if (tick === 35) msgs.push('> ! appels ORS — encore en cours...');
        // Update last line with elapsed
        const lastLine = msgs[msgs.length - 1];
        if (/\d+\.\ds$/.test(lastLine)) {
          msgs[msgs.length - 1] = lastLine.replace(/\d+\.\ds$/, `${elapsed}s`);
        } else {
          msgs.push(`> elapsed : ${elapsed}s`);
        }
        return msgs;
      });
    }, 1000);
    try {
      const { geometry: mergedGeometry, nb_pois, poiGroups, battleRings: rings } = await onDirectBattle(params, (msg: string, pct?: number) => {
        if (pct !== undefined) setBattleProgress(pct);
        // Extraire completed/total depuis le message "X/Y POIs"
        const m = msg.match(/(\d+)\/(\d+) POIs/);
        if (m) { setBattleCompleted(Number(m[1])); setBattleTotal(Number(m[2])); }
        else if (msg.includes('POIs trouvés')) { const t = msg.match(/(\d+) POIs/); if (t) setBattleTotal(Number(t[1])); }
        setBattleLog(prev => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].includes('POIs traités') || prev[i].includes('POIs trouvés')) {
              return [...prev.slice(0, i), msg, ...prev.slice(i + 1)];
            }
          }
          return [...prev, msg];
        });
      });
      const elapsed = ((Date.now() - battleStartRef.current) / 1000).toFixed(1);
      setBattleProgress(100);
      setBattleLog(prev => [...prev, `> ✓ ${nb_pois} POIs — isochrones affichés (${elapsed}s)`]);
      setBattleGeometry(mergedGeometry);
      setBattleMeta({ categorie: params.category, mode: params.mode });
      setBattlePoiGroups(poiGroups);
      setBattleRings(rings);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'erreur inconnue';
      setBattleLog(prev => [...prev, `> ✕ ${msg}`]);
    } finally {
      if (battleTimerRef.current) { clearInterval(battleTimerRef.current); battleTimerRef.current = null; }
      setBattleLoading(false);
    }
  };

  const handleBattleV2 = async (force = false) => {
    if (!exactlyOnePOI || battleV2Paliers.length === 0 || battleV2Loading) return;
    setBattleV2Loading(true);
    setBattleV2Log([
      `> catégorie : ${selectedPOI[0]}`,
      `> mode : ${transportMode} | paliers : ${battleV2Paliers.join(', ')} min`,
      `> lecture cache isochrones...`,
    ]);
    try {
      await onDirectBattleV2(
        {
          category:        selectedPOI[0],
          mode:            transportMode,
          filtre_ville:    ville || undefined,
          filtre_regions:  (selectedRegions.length > 0 && (REF_REGIONS.length === 0 || selectedRegions.length < REF_REGIONS.length))
                             ? selectedRegions : undefined,
          filtre_depts:    selectedDepts.length > 0 ? selectedDepts : undefined,
          metropolitaine:  !selectedRegions.includes('dom'),
          paliers:         [...battleV2Paliers].sort((a, b) => a - b),
          force_battle:    force,
        },
        (msg: string) => setBattleV2Log(prev => [...prev, msg]),
      );
      setBattleV2Log(prev => [...prev, '> ✓ Bataille v2 affichée sur la carte']);
    } catch (e: unknown) {
      setBattleV2Log(prev => [...prev, `> ✕ ${e instanceof Error ? e.message : 'Erreur inconnue'}`]);
    } finally {
      setBattleV2Loading(false);
    }
  };

  // ── Tab config ────────────────────────────────────────────────────────────
  const EXPERT_BADGE = (hasTerritoire ? 1 : 0) + (selectedPOI.length > 0 ? 1 : 0) + (selectedOOH.length > 0 ? 1 : 0);

  return (
    <div style={isOverlayMode ? {
      width: '100%', height: '100%',
      background: 'transparent',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      position: 'relative',
    } : {
      width: panelWidth, minWidth: 260, height: '100%',
      background: C.bgPanel, borderRight: `0.5px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      position: 'relative', flexShrink: 0,
    }}>
      {/* ── Resize handle with dots indicator (masqué en mode overlay) ── */}
      {!isOverlayMode && (
      <div
        onMouseDown={onResizeMouseDown}
        onDoubleClick={() => setPanelWidth(prev => prev > 400 ? 320 : 560)}
        style={{
          position: 'absolute', top: 0, right: 0, width: 8, height: '100%',
          cursor: 'col-resize', zIndex: 50, background: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background-color 150ms var(--ease-hover)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: 0.3 }}>
          <div style={{ width: 2, height: 2, borderRadius: '50%', background: 'var(--text-tertiary)' }} />
          <div style={{ width: 2, height: 2, borderRadius: '50%', background: 'var(--text-tertiary)' }} />
          <div style={{ width: 2, height: 2, borderRadius: '50%', background: 'var(--text-tertiary)' }} />
        </div>
      </div>
      )}


      {/* ── Error / loading bar ───────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '6px 14px', background: 'rgba(248,113,113,0.07)', borderBottom: `1px solid rgba(248,113,113,0.2)`, fontFamily: fMono, fontSize: 10, color: C.red, flexShrink: 0, animation: 'fpErrorIn 200ms var(--ease-out)' }}>
          ! {error}
        </div>
      )}
      {(isLoading || battleLoading) && (
        <div style={{ height: 2, flexShrink: 0, background: C.border, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: '40%',
            background: battleLoading ? C.red : C.green,
            animation: 'fpSlide 1.2s linear infinite',
          }} />
        </div>
      )}

      {/* ── Bouton HOME (masqué en mode overlay) ──────────────────────────── */}
      {!isOverlayMode && (
      <a href="/dashboard" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 14px', flexShrink: 0,
        background: 'none', borderBottom: `0.5px solid ${C.border}`,
        color: C.textDim, textDecoration: 'none',
        fontFamily: fInter, fontSize: 12,
        transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = C.text; (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-level-2)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = C.textDim; (e.currentTarget as HTMLAnchorElement).style.background = 'none'; }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        Home
      </a>
      )}

      {/* ── Tab navigation (masquée en mode overlay) ─────────────────────── */}
      {!isOverlayMode && (
      <div style={{ display: 'flex', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0, background: C.bgPanel, position: 'relative' }}>
        {/* GEO.PROMPT */}
        {(() => {
          const active = activeTab === 'geoprompt';
          return (
            <button onClick={() => setActiveTab('geoprompt')} className="fp-tab" style={{
              flex: 1, padding: '12px 6px 10px', position: 'relative',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer', transition: 'color 180ms var(--ease-out)',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <div style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: active ? 'var(--text-primary)' : C.textDim, transition: 'color 180ms var(--ease-out)' }}>
                Geo.Prompt
              </div>
              {/* Sliding underline */}
              <span style={{
                position: 'absolute', bottom: 0, left: '50%',
                width: active ? '100%' : '0%',
                height: 2, background: 'var(--brand-teal)',
                transform: 'translateX(-50%)',
                transition: 'width 250ms var(--ease-out)',
              }} />
            </button>
          );
        })()}
        {/* EXPERT */}
        {(() => {
          const active = activeTab === 'expert';
          return (
            <button onClick={() => setActiveTab('expert')} className="fp-tab" style={{
              flex: 1, padding: '12px 6px 10px', position: 'relative',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer', transition: 'color 180ms var(--ease-out)',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <div style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: active ? 'var(--text-primary)' : C.textDim, transition: 'color 180ms var(--ease-out)' }}>
                Expert
              </div>
              {EXPERT_BADGE > 0 && (
                <div style={{ position: 'absolute', top: 7, right: 10, width: 5, height: 5, borderRadius: '50%', background: 'var(--brand-teal)', transition: 'opacity 200ms var(--ease-out)' }} />
              )}
              <span style={{
                position: 'absolute', bottom: 0, left: '50%',
                width: active ? '100%' : '0%',
                height: 2, background: 'var(--brand-teal)',
                transform: 'translateX(-50%)',
                transition: 'width 250ms var(--ease-out)',
              }} />
            </button>
          );
        })()}
      </div>
      )}

      {/* Sous-onglets Expert supprimés — tout en panel unique scrollable */}

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* ════════════════════════════════════════
            ONGLET MAÎTRE 1 — GEO.PROMPT (chat IA)
        ════════════════════════════════════════ */}
        {activeTab === 'geoprompt' && !isOverlayMode && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            {chatSlot}
          </div>
        )}

        {/* ════════════════════════════════════════
            ONGLET MAÎTRE 2 — EXPERT (sous-onglets)
        ════════════════════════════════════════ */}
        {/* ── Search + Quick actions (Expert tab only — masqué en mode overlay) ── */}
        {activeTab === 'expert' && !isOverlayMode && (
          <div style={{ padding: '8px 12px', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Search input */}
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
              <input
                type="text"
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
                placeholder="Rechercher un filtre..."
                style={{
                  width: '100%', background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6,
                  padding: '6px 28px 6px 30px', fontSize: 12, color: 'var(--text-primary)',
                  fontFamily: fInter, outline: 'none', transition: 'border-color 150ms var(--ease-hover)',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
              />
              {filterSearch && (
                <button
                  onClick={() => setFilterSearch('')}
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)',
                    padding: 2, display: 'flex', alignItems: 'center',
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {/* Quick actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={collapseAll} style={{
                background: 'none', border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '3px 8px',
                fontSize: 10, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: fInter,
                transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover)',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = 'var(--bg-level-2)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'none'; }}
              >
                Tout réduire
              </button>
              <button onClick={expandAll} style={{
                background: 'none', border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '3px 8px',
                fontSize: 10, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: fInter,
                transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover)',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = 'var(--bg-level-2)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'none'; }}
              >
                Tout déployer
              </button>
            </div>
          </div>
        )}

        {/* ── Scrollable wrapper pour territoire + poi + analyse ── */}
        {(activeTab === 'expert' || isOverlayMode) && (
        <div className="filter-panel-scroll" style={{ flex: 1, overflowY: isOverlayMode ? 'visible' : 'auto', minHeight: 0 }}>

        {/* ════════════════════════════════════════
            CATÉGORIE — CONTEXTE (ex-Territoire)
        ════════════════════════════════════════ */}
        {(!visibleCategory || visibleCategory === 'perimeter') && (
          <PerimeterSections
            isOverlayMode={isOverlayMode}
            filterSearch={filterSearch}
            sectionsOpen={sectionsOpen}
            toggleSection={toggleSection}
            scope={scope}
            selectScope={selectScope}
            setScope={setScope}
            selectedRegions={selectedRegions}
            setSelectedRegions={setSelectedRegions}
            refRegions={REF_REGIONS}
            selectedDepts={selectedDepts}
            setSelectedDepts={setSelectedDepts}
            availableDepts={availableDepts}
            ville={ville}
            setVille={setVille}
            codePostal={codePostal}
            setCodePostal={setCodePostal}
            territoire={territoire}
            hasTerritoire={hasTerritoire}
            adminScale={adminScale}
            adminCodes={adminCodes}
            territoryMaskEnabled={territoryMaskEnabled}
            setTerritoryMaskEnabled={setTerritoryMaskEnabled}
          />
        )}

        {/* ════════════════════════════════════════
            CATÉGORIE — DONNÉES TERRAIN (ex-POI)
        ════════════════════════════════════════ */}
        {(!visibleCategory || visibleCategory === 'terrain') && (
        <CategoryGroup title="Données terrain" color="var(--cat-terrain)" colorRgb="78,205,196" defaultOpen={true} collapsible={!isOverlayMode} hideHeader={isOverlayMode}>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            <PoiSection
              filterSearch={filterSearch}
              sectionsOpen={sectionsOpen}
              toggleSection={toggleSection}
              selectedPOI={selectedPOI}
              setSelectedPOI={setSelectedPOI}
              poiTypes={poiTypes}
              catsLoading={catsLoading}
              catsError={catsError}
              fetchCategories={fetchCategories}
              getPOIStyle={getPOIStyle}
              setPOIStyle={setPOIStyle}
              setPoiStyles={setPoiStyles}
              poiNatures={poiNatures}
              selectedPoiNatures={selectedPoiNatures}
              setSelectedPoiNatures={setSelectedPoiNatures}
              hasAnyPOI={hasAnyPOI}
              searchLoading={searchLoading}
              handleSearchPOI={handleSearchPOI}
              densityMode={densityMode}
              onDensityModeChange={onDensityModeChange}
            />

            <OohSection
              filterSearch={filterSearch}
              sectionsOpen={sectionsOpen}
              toggleSection={toggleSection}
              selectedOOH={selectedOOH}
              setSelectedOOH={setSelectedOOH}
              onDirectOOH={onDirectOOH}
            />

            <TransportSection
              filterSearch={filterSearch}
              sectionsOpen={sectionsOpen}
              toggleSection={toggleSection}
              selectedTransportTypes={selectedTransportTypes}
              setSelectedTransportTypes={setSelectedTransportTypes}
              transportLoading={transportLoading}
              setTransportLoading={setTransportLoading}
              onLoadTransport={onLoadTransport}
            />

            <TmjaSection
              filterSearch={filterSearch}
              sectionsOpen={sectionsOpen}
              toggleSection={toggleSection}
              tmjaVisible={!!tmjaVisible}
              tmjaHideLowTraffic={!!tmjaHideLowTraffic}
              onToggleTmjaHideLowTraffic={onToggleTmjaHideLowTraffic}
              tmjaLoading={tmjaLoading}
              setTmjaLoading={setTmjaLoading}
              onLoadTMJA={onLoadTMJA}
              onClearTMJA={onClearTMJA}
            />

            <RadioSection
              filterSearch={filterSearch}
              sectionsOpen={sectionsOpen}
              toggleSection={toggleSection}
              radioCount={radioCount}
              radioVisible={radioVisible}
              onToggleRadio={onToggleRadio}
              radioSelectedNom={radioSelectedNom}
              onClearRadioSelection={onClearRadioSelection}
              onSelectRadio={onSelectRadio}
              radioFilterOptions={radioFilterOptions}
              radioFilterIds={radioFilterIds}
              onRadioFilterIdsChange={onRadioFilterIdsChange}
              radioExcludeCategories={radioExcludeCategories}
              onRadioExcludeCategoriesChange={onRadioExcludeCategoriesChange}
              radioSystemeFilter={radioSystemeFilter}
              onRadioSystemeChange={onRadioSystemeChange}
              radioCoverageMode={radioCoverageMode}
              onToggleRadioCoverage={onToggleRadioCoverage}
              radioCoverageColor={radioCoverageColor}
              onRadioCoverageColorChange={onRadioCoverageColorChange}
              radioCoverageOpacity={radioCoverageOpacity}
              onRadioCoverageOpacityChange={onRadioCoverageOpacityChange}
              radioBorderWidth={radioBorderWidth}
              onRadioBorderWidthChange={onRadioBorderWidthChange}
              radioHeatmapMode={radioHeatmapMode}
              onToggleRadioHeatmap={onToggleRadioHeatmap}
              radioPointSize={radioPointSize}
              onRadioPointSizeChange={onRadioPointSizeChange}
              onRecenterFrance={onRecenterFrance}
            />

          </div>
        </CategoryGroup>
        )}


        {/* ════════════════════════════════════════
            CATÉGORIE — AUDIENCE (socio-démo & contexte)
            Règle de tri : Terrain = le physique · Audience = les gens et
            leur environnement · Analyses = ce qui se calcule.
        ════════════════════════════════════════ */}
        {(!visibleCategory || visibleCategory === 'audience') && (
        <CategoryGroup title="Audience" color="var(--cat-socio)" colorRgb="91,155,213" defaultOpen={isOverlayMode ? true : false} collapsible={!isOverlayMode} hideHeader={isOverlayMode}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>

            <CarreauxSection
              analyseOpen={analyseOpen}
              toggleAnalyse={toggleAnalyse}
              carreauxVisible={carreauxVisible}
              carreauxLoaded={carreauxLoaded}
              carreauxIndicateur={carreauxIndicateur}
              carreauxPalette={carreauxPalette}
              carreauxOpacity={carreauxOpacity}
              carreauxRange={carreauxRange}
              carreauxSelectedBucket={carreauxSelectedBucket}
              setCarreauxVisible={setCarreauxVisible}
              setCarreauxIndicateur={setCarreauxIndicateur}
              setCarreauxPalette={setCarreauxPalette}
              setCarreauxOpacity={setCarreauxOpacity}
              setCarreauxSelectedBucket={setCarreauxSelectedBucket}
            />

            <IrisSection
              analyseOpen={analyseOpen}
              toggleAnalyse={toggleAnalyse}
              irisVisible={irisVisible}
              irisIndicateur={irisIndicateur}
              irisPalette={irisPalette}
              irisOpacity={irisOpacity}
              irisStats={irisStats}
              irisTrueOnly={irisTrueOnly}
              setIrisVisible={setIrisVisible}
              setIrisIndicateur={setIrisIndicateur}
              setIrisPalette={setIrisPalette}
              setIrisOpacity={setIrisOpacity}
              setIrisTrueOnly={setIrisTrueOnly}
            />

            {/* Sections contexte — blocs déplacés depuis Données terrain */}
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

            <CivicIndicatorsSection
              filterSearch={filterSearch}
              sectionsOpen={sectionsOpen}
              toggleSection={toggleSection}
              civicVariableCode={civicVariableCode}
              onCivicVariableChange={onCivicVariableChange}
            />

            <CivicHealthSection
              filterSearch={filterSearch}
              sectionsOpen={sectionsOpen}
              toggleSection={toggleSection}
              selectedIrisCommuneCode={selectedIrisCommuneCode}
              selectedIrisCommuneName={selectedIrisCommuneName}
              civicHealthLayer={civicHealthLayer}
              onCivicHealthLayerChange={onCivicHealthLayerChange}
              civicScale={civicScale}
              onCivicScaleChange={onCivicScaleChange}
              civicMetric={civicMetric}
              onCivicMetricChange={onCivicMetricChange}
              civicMinLevel={civicMinLevel}
              onCivicMinLevelChange={onCivicMinLevelChange}
              civicProgress={civicProgress}
              civicLoading={civicLoading}
              civicCpStatus={civicCpStatus}
              civicCpDate={civicCpDate}
              runCivicIngestStream={runCivicIngestStream}
              civicIngestState={civicIngestState}
            />

            {onOpenMeteo && (
              <MeteoSection
                filterSearch={filterSearch}
                sectionsOpen={sectionsOpen}
                toggleSection={toggleSection}
                meteoVisible={meteoVisible}
                meteoLabel={meteoLabel}
                onOpenMeteo={onOpenMeteo}
                onClearMeteo={onClearMeteo}
              />
            )}

            </div>
          </div>
        </CategoryGroup>
        )}

        {/* ════════════════════════════════════════
            CATÉGORIE — ANALYSES (ex-Analyse)
        ════════════════════════════════════════ */}
        {(!visibleCategory || visibleCategory === 'analyses') && (
        <CategoryGroup title="Analyses" color="var(--cat-analysis)" colorRgb="232,132,92" defaultOpen={isOverlayMode ? true : false} collapsible={!isOverlayMode} hideHeader={isOverlayMode}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>

            {/* ── Accordéon : ANALYSE SPATIALE ────────────────────────────── */}
            <button
              onClick={() => toggleAnalyse('spatiale')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'var(--bg-level-2)',
                border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background-color 180ms var(--ease-out)',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
                Analyse spatiale
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.spatiale ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.spatiale && (
            <div style={{ padding: '16px', borderBottom: `0.5px solid ${C.border}` }}>
            <div style={{ paddingBottom: 4 }}>

              {!hasAnyPOI && <SpatialAnalysisEmptyState />}

              {selectedPOI.length > 1 && <SpatialAnalysisTooManyPoi selectedCount={selectedPOI.length} />}

              {/* Outils — visibles uniquement si exactement 1 POI */}
              {exactlyOnePOI && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>

                  {/* Mode de transport — visible globalement */}
                  <div>
                    <div style={labelStyle}>Mode de transport</div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {ISO_MODES.map(m => (
                        <button key={m.id} style={{ ...pill(transportMode === m.id, 'var(--text-primary)'), flex: 1, textAlign: 'center' }} onClick={() => setTransportMode(m.id)}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <VoronoiTool
                    showVoronoi={showVoronoi}
                    setShowVoronoi={setShowVoronoi}
                    setShowBattle={setShowBattle}
                    setShowBattleV2={setShowBattleV2}
                    isLoading={isLoading}
                    voronoiVisible={voronoiVisible}
                    setVoronoiVisible={setVoronoiVisible}
                    handleVoronoi={handleVoronoi}
                  />

                  <BattleV2Tool
                    showBattleV2={showBattleV2}
                    setShowBattleV2={setShowBattleV2}
                    setShowBattle={setShowBattle}
                    setShowVoronoi={setShowVoronoi}
                    battleVisible={battleVisible}
                    setBattleVisible={setBattleVisible}
                    battleV2Paliers={battleV2Paliers}
                    setBattleV2Paliers={setBattleV2Paliers}
                    battleV2Loading={battleV2Loading}
                    battleV2Log={battleV2Log}
                    setBattleV2Log={setBattleV2Log}
                    v2CacheStatus={v2CacheStatus}
                    setV2CacheStatus={setV2CacheStatus}
                    v2Checking={v2Checking}
                    v2Filling={v2Filling}
                    v2FillTotal={v2FillTotal}
                    v2FillCompleted={v2FillCompleted}
                    v2FillPct={v2FillPct}
                    v2FillRings={v2FillRings}
                    handleCheckV2={handleCheckV2}
                    handleFillMissingV2={handleFillMissingV2}
                    handleBattleV2={handleBattleV2}
                  />

                  <IsochronesTool
                    showBattle={showBattle}
                    setShowBattle={setShowBattle}
                    setShowVoronoi={setShowVoronoi}
                    setShowBattleV2={setShowBattleV2}
                    battleVisible={battleVisible}
                    setBattleVisible={setBattleVisible}
                    battleOuterFillVisible={battleOuterFillVisible}
                    setBattleOuterFillVisible={setBattleOuterFillVisible}
                    isoDurations={isoDurations}
                    toggleDuration={toggleDuration}
                    orsCacheStatus={orsCacheStatus}
                    orsChecking={orsChecking}
                    handleCheckORS={handleCheckORS}
                    battleLoading={battleLoading}
                    battleLog={battleLog}
                    setBattleLog={setBattleLog}
                    battleTotal={battleTotal}
                    battleCompleted={battleCompleted}
                    battleProgress={battleProgress}
                    handleBattle={handleBattle}
                    battleRings={battleRings}
                    battleMeta={battleMeta}
                    battleApplyLoading={battleApplyLoading}
                    setBattleApplyLoading={setBattleApplyLoading}
                    battleApplyPct={battleApplyPct}
                    setBattleApplyPct={setBattleApplyPct}
                    onApplyBattle={onApplyBattle}
                  />

                </div>
              )}

            </div>{/* fin section analyse spatiale */}
            </div>
            )}

          </div>
        </CategoryGroup>
        )}

        </div>
        )}

      </div>

      {/* ── Footer actions (masqué en mode overlay) ──────────────────────── */}
      {activeTab !== 'geoprompt' && !isOverlayMode && (
      <div style={{ borderTop: `0.5px solid ${C.border}`, padding: '10px 14px', display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => setShowSavePanel(true)}
          style={{
            flex: 1, padding: '8px', fontFamily: fInter, fontSize: 13,
            background: 'none', border: `0.5px solid ${C.border}`, borderRadius: 4,
            color: C.textDim, cursor: 'pointer', transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textDim; }}
        >
          Sauvegarder la vue
        </button>
      </div>
      )}

      <style>{`
        @keyframes fpSlide {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(350%); }
          100% { transform: translateX(350%); }
        }
        @keyframes fpBlink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes fpScan {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        @keyframes fpDropIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fpErrorIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fp-tab { overflow: visible !important; }
        /* Reduced-motion handled globally in globals.css — keeps opacity/color, strips transforms */
      `}</style>
    </div>
  );
}
