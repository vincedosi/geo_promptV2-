'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { ZoneData } from '@/types/spatial';
import { CoverageResultsPanel, type CoverageSummaryEntry } from '@/components/CoverageResultsPanel';
import { ClusterPanel } from './ClusterPanel';
import type { ClusterGeoJSON } from './ClusterPanel';
import { CARREAUX_INDICATEURS, CARREAUX_PALETTES } from '@/components/CarreauxPMTilesLayer';
import { IRIS_PALETTES, type IrisStats } from '@/app/copilote/_hooks/useMapLayers';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';
import { ScoringPanel } from './ScoringPanel';
import { CorrelationPanel, type CorrelationParams, type ResidualsMeta } from './CorrelationPanel';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:        '#050505',
  bgPanel:   '#08080f',
  bgInput:   '#0a0a14',
  border:    '#261a35',
  accent:    '#a855f7',
  accentDim: 'rgba(168,85,247,0.12)',
  green:     '#3dffa0',
  greenDim:  'rgba(61,255,160,0.10)',
  amber:     '#f59e0b',
  amberDim:  'rgba(245,158,11,0.10)',
  red:       '#f87171',
  redDim:    'rgba(248,113,113,0.08)',
  redBorder: 'rgba(248,113,113,0.25)',
  violet:    '#c4b5fd',
  muted:     '#8888aa',
  textDim:   '#6b7280',
  text:      '#e2e8f0',
};
const fMono     = "'JetBrains Mono','Fira Mono',monospace";
const fMichroma = "'Michroma','Orbitron',sans-serif";
const fOrbitron = "'Orbitron',sans-serif";

// ─── Données géographiques ─────────────────────────────────────────────────────
import {
  REGIONS_ADMIN as REGIONS, ALL_DEPTS,
  ISO_MODES, ISO_DURATIONS,
} from '@/lib/geo/france-admin';

type Tab = 'geoprompt' | 'expert';
type ExpertSubTab = 'territoire' | 'poi' | 'analyse';

// ─── POI Style ────────────────────────────────────────────────────────────────
export interface POIStyle { size: string; color: string; }
export type POIStylesMap = Record<string, POIStyle>;

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
  metropolitaine: boolean;
  force_recalculate?: boolean;
}

export interface DirectBattleV2Params {
  category: string;
  mode: string;
  filtre_ville?: string;
  filtre_regions?: string[];
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
  battleFeatures?: GeoJSON.Feature[];
  battlePois?:     Array<{ id: string; nom: string; lat: number; lng: number; ville?: string; adresse?: string }>;
  battleCacheKey?: string | null;
  densityMode?: boolean;
  onDensityModeChange?: (v: boolean) => void;
  onPOIStylesChange?: (styles: POIStylesMap) => void;
  // Clusters
  clusterGeoJSON?:          ClusterGeoJSON | null;
  clustersVisible?:         boolean;
  clusterLoading?:          boolean;
  clusterDuration?:         number;
  onToggleClusters?:        () => void;
  onLoadClusters?:          () => void;
  onClusterDurationChange?: (d: number) => void;
  onFlyTo?:                 (lat: number, lng: number, zoom?: number) => void;
  onFitBounds?:             (bounds: [[number, number], [number, number]]) => void;
  onWizardHighlight?:       (poiTypes: string[], metropolitaine: boolean) => void;
  onWizardClose?:           () => void;
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
  setIrisVisible?:      (v: boolean | ((p: boolean) => boolean)) => void;
  setIrisIndicateur?:   (v: string) => void;
  setIrisPalette?:      (v: string) => void;
  setIrisOpacity?:      (v: number) => void;
  // Scoring OOH
  scoringMapRef?:       React.MutableRefObject<MaplibreMap | null>;
  scoringMapReady?:     boolean;
  onScoreComputed?:     (ville: string) => void;
  // Transport & TMJA
  onLoadTransport?:     (types: string[]) => Promise<void>;
  onLoadTMJA?:          () => Promise<void>;
  tmjaVisible?:         boolean;
  onClearTMJA?:         () => void;
  // Corrélation IRIS × POI
  correlationParams?:   CorrelationParams | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onShowResiduals?:     (geojson: any, meta?: ResidualsMeta) => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MultiDropdown({
  label, items, selected, onChange, searchable = false,
}: {
  label: string;
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  searchable?: boolean;
}) {
  const [open, setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = searchable && search
    ? items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()) || i.id.toLowerCase().includes(search.toLowerCase()))
    : items;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const displayLabel = selected.length === 0
    ? label
    : selected.length === 1
      ? (items.find(i => i.id === selected[0])?.label ?? selected[0])
      : `${selected.length} selectionnes`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 11px', background: C.bgInput,
          border: `1px solid ${open ? C.accent : C.border}`, borderRadius: 2,
          cursor: 'pointer', fontFamily: fMono, fontSize: 11, color: selected.length > 0 ? C.text : C.textDim,
          transition: 'border-color 0.15s',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
        <span style={{ color: C.accent, fontSize: 8, marginLeft: 8, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
          background: '#0d0d1f', border: `1px solid ${C.accent}44`, borderTop: 'none',
          borderRadius: '0 0 2px 2px', maxHeight: 200, display: 'flex', flexDirection: 'column',
        }}>
          {searchable && (
            <div style={{ padding: '5px 8px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher..." style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontFamily: fMono, fontSize: 11, color: C.text }} />
            </div>
          )}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '8px 11px', fontFamily: fMono, fontSize: 11, color: C.textDim }}>Aucun résultat</div>
            )}
            {filtered.map(item => {
              const active = selected.includes(item.id);
              return (
                <button key={item.id} onClick={() => toggle(item.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 11px', background: active ? C.accentDim : 'none',
                    border: 'none', borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = active ? C.accentDim : 'none'; }}
                >
                  <div style={{
                    width: 11, height: 11, borderRadius: 1, border: `1px solid ${active ? C.accent : C.muted}`,
                    background: active ? C.accent : 'transparent', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {active && <span style={{ fontSize: 7, color: '#fff', fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontFamily: fMono, fontSize: 11, color: active ? C.text : C.textDim }}>{item.label}</span>
                </button>
              );
            })}
          </div>
          {selected.length > 0 && (
            <button onClick={() => { onChange([]); setOpen(false); }}
              style={{ padding: '5px', background: 'none', border: 'none', borderTop: `1px solid ${C.border}`, cursor: 'pointer', fontFamily: fMichroma, fontSize: 7, color: C.red, letterSpacing: '0.1em' }}>
              TOUT DESELECTIONNER
            </button>
          )}
        </div>
      )}
    </div>
  );
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
  battleFeatures: battleFeaturesProp = [],
  battlePois: battlePoisProp = [],
  battleCacheKey,
  onPOIStylesChange,
  clusterGeoJSON, clustersVisible, clusterLoading, clusterDuration,
  onToggleClusters, onLoadClusters, onClusterDurationChange, onFlyTo, onFitBounds,
  onWizardHighlight, onWizardClose,
  carreauxVisible, carreauxLoaded, carreauxIndicateur, carreauxPalette,
  carreauxOpacity, carreauxRange, carreauxSelectedBucket,
  setCarreauxVisible, setCarreauxIndicateur, setCarreauxPalette, setCarreauxOpacity, setCarreauxSelectedBucket,
  irisVisible, irisIndicateur, irisPalette, irisOpacity, irisStats,
  setIrisVisible, setIrisIndicateur, setIrisPalette, setIrisOpacity,
  scoringMapRef, scoringMapReady, onScoreComputed,
  onLoadTransport, onLoadTMJA, tmjaVisible, onClearTMJA,
  correlationParams, onShowResiduals,
}: FilterPanelProps) {

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
  const fetchCategories = (forceRefresh = false) => {
    setCatsLoading(true);
    fetch(forceRefresh ? '/api/map/categories?refresh=1' : '/api/map/categories')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.categories)) {
          setPoiTypes(data.categories.map((c: string) => ({
            id: c,
            label: c.charAt(0).toUpperCase() + c.slice(1),
          })));
        }
      })
      .catch(() => {})
      .finally(() => setCatsLoading(false));
  };
  useEffect(() => { fetchCategories(); }, []);

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('geoprompt');
  const [activeExpertTab, setActiveExpertTab] = useState<ExpertSubTab>('territoire');

  // ── OOH / DOOH state ──────────────────────────────────────────────────────
  // Régies disponibles dans global_ooh (source: Brest Métropole)
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

  // ── Coverage summary (managed internally, fed by CoverageResultsPanel) ──
  const [coverageSummary, setCoverageSummary] = useState<CoverageSummaryEntry[]>([]);

  // ── Analyse accordions ────────────────────────────────────────────────────
  const [analyseOpen, setAnalyseOpen] = useState<Record<string, boolean>>({
    spatiale: false, clustering: false, iris: false, carreaux: false, couverture: false, scoring: false,
  });
  const toggleAnalyse = (key: string) =>
    setAnalyseOpen(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Territoire state ──────────────────────────────────────────────────────
  const [scope,           setScope]           = useState<'metro' | 'all' | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDepts,   setSelectedDepts]   = useState<string[]>([]);
  const [ville,           setVille]           = useState('');
  const [codePostal,      setCodePostal]      = useState('');

  // ── Audience state ────────────────────────────────────────────────────────

  // ── Analyses state ────────────────────────────────────────────────────────
  const [selectedPOI,   setSelectedPOI]   = useState<string[]>([]);

  useEffect(() => {
    for (const poi of selectedPOI) fetchPoiNatures(poi);
  }, [selectedPOI]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── POI pin styles ─────────────────────────────────────────────────────────
  const PIN_SIZES = ['Petite', 'Standard', 'Grosse', 'Large'] as const;
  const PIN_COLORS: { label: string; hex: string }[] = [
    { label: 'Noir',    hex: '#111111' },
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
  const getPOIStyle = (poi: string) => poiStyles[poi] ?? { size: 'Standard', color: '#a855f7' };
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
  const availableDepts = useMemo(() =>
    selectedRegions.length === 0 ? ALL_DEPTS
      : REGIONS.filter(r => selectedRegions.includes(r.id)).flatMap(r => r.depts),
    [selectedRegions],
  );
  useEffect(() => {
    const ids = availableDepts.map(d => d.code);
    setSelectedDepts(prev => prev.filter(d => ids.includes(d)));
  }, [availableDepts]);

  const selectScope = (s: 'metro' | 'all') => {
    setScope(prev => prev === s ? null : s);
    setSelectedRegions([]); setSelectedDepts([]); setVille(''); setCodePostal('');
  };

  // ── Territoire helpers ────────────────────────────────────────────────────
  const buildTerritoire = (): string => {
    if (ville.trim()) return `à ${ville.trim()}${codePostal ? ` (${codePostal})` : ''}`;
    if (selectedDepts.length === 1) {
      const d = ALL_DEPTS.find(x => x.code === selectedDepts[0]);
      return `dans le département ${selectedDepts[0]}${d ? ` — ${d.nom}` : ''}`;
    }
    if (selectedDepts.length > 1) return `dans les départements ${selectedDepts.join(', ')}`;
    if (selectedRegions.length === 1) {
      const r = REGIONS.find(x => x.id === selectedRegions[0]);
      return `en ${r?.nom ?? selectedRegions[0]}`;
    }
    if (selectedRegions.length > 1) {
      const names = selectedRegions.map(id => REGIONS.find(r => r.id === id)?.nom ?? id);
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

  const modeLabel = (id: string) => ISO_MODES.find(m => m.id === id)?.label ?? id;

  // Auto-ouvrir l'accordéon COUVERTURE quand des données arrivent
  useEffect(() => {
    if (coverageSummary && coverageSummary.length > 0) {
      setAnalyseOpen(prev => ({ ...prev, couverture: true }));
    }
  }, [coverageSummary]);

  // Auto-ouvrir l'accordéon CORRÉLATION + onglet ANALYSE quand des params arrivent depuis le chat
  useEffect(() => {
    if (!correlationParams) return;
    setActiveTab('expert');
    setActiveExpertTab('analyse');
    setAnalyseOpen(prev => ({ ...prev, correlation: true }));
  }, [correlationParams]);

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
    console.log('[FilterPanel] handleVoronoi →', msg, '| isLoading:', isLoading);
    send(msg);
  };

  // ── Vérification cache — partagée ORS + V2 ────────────────────────────────
  const buildCheckParams = (paliers: number[]) => ({
    category:       selectedPOI[0],
    mode:           transportMode,
    paliers,
    metropolitaine: !selectedRegions.includes('dom'),
    filtre_ville:   ville || undefined,
    filtre_regions: (selectedRegions.length > 0 && selectedRegions.length < REGIONS.length)
                      ? selectedRegions : undefined,
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
          filtre_regions: (selectedRegions.length > 0 && selectedRegions.length < REGIONS.length) ? selectedRegions : undefined,
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
      filtre_regions:    (selectedRegions.length > 0 && selectedRegions.length < REGIONS.length)
                           ? selectedRegions : undefined,
      metropolitaine:    !selectedRegions.includes('dom'),
      force_recalculate: force,
    };
    console.log('[FilterPanel] handleBattle → direct API', params);
    const territoireLabel = params.filtre_ville
      ?? (selectedDepts.length > 0 ? `${selectedDepts.length} dept(s)` : null)
      ?? (selectedRegions.length > 0 ? selectedRegions.map(id => REGIONS.find(r => r.id === id)?.nom ?? id).join(' + ') : null)
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
          filtre_regions:  (selectedRegions.length > 0 && selectedRegions.length < REGIONS.length)
                             ? selectedRegions : undefined,
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

  // ── Style helpers ─────────────────────────────────────────────────────────
  const hexToRgb = (hex: string): string => {
    if (!hex.startsWith('#') || hex.length < 7) return '168,85,247';
    return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`;
  };

  const pill = (active: boolean, color: string) => ({
    fontFamily: fMono, fontSize: 10, padding: '5px 9px',
    background: active ? `rgba(${hexToRgb(color)},0.15)` : C.bgInput,
    border: `1px solid ${active ? color : C.border}`, borderRadius: 2,
    color: active ? color : C.textDim, cursor: 'pointer', transition: 'all 0.12s', flexShrink: 0 as const,
  });

  const primaryBtn = (color: string, disabled = false) => ({
    fontFamily: fMichroma, fontSize: 9, letterSpacing: '0.12em',
    padding: '10px 14px', width: '100%',
    background: disabled ? 'rgba(255,255,255,0.03)' : `rgba(${hexToRgb(color)},0.12)`,
    border: `1px solid ${disabled ? C.border : color}`, borderRadius: 2,
    color: disabled ? C.muted : color, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1, transition: 'all 0.15s',
  });

  const labelStyle = {
    fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.16em',
    color: '#9898b8', marginBottom: 6, textTransform: 'uppercase' as const,
  };

  const inputStyle = {
    fontFamily: fMono, fontSize: 11, background: C.bgInput,
    border: `1px solid ${C.border}`, borderRadius: 2,
    color: C.text, padding: '7px 10px', outline: 'none', width: '100%',
  };

  // ── Tab config ────────────────────────────────────────────────────────────
  const EXPERT_BADGE = (hasTerritoire ? 1 : 0) + (selectedPOI.length > 0 ? 1 : 0) + (selectedOOH.length > 0 ? 1 : 0) + (clusterGeoJSON ? 1 : 0);
  const EXPERT_SUBTABS: { id: ExpertSubTab; label: string; color: string; badge?: number }[] = [
    { id: 'territoire', label: 'TERRITOIRE', color: C.green,   badge: hasTerritoire ? 1 : 0 },
    { id: 'poi',        label: 'POI',        color: C.accent,  badge: selectedPOI.length + selectedOOH.length },
    { id: 'analyse',    label: 'ANALYSE',    color: '#76b7b2', badge: clusterGeoJSON ? 1 : 0 },
  ];

  return (
    <div style={{
      width: panelWidth, minWidth: 260, height: '100%',
      background: C.bgPanel, borderRight: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      position: 'relative', flexShrink: 0,
    }}>
      {/* ── Resize handle ── */}
      <div
        onMouseDown={onResizeMouseDown}
        style={{
          position: 'absolute', top: 0, right: 0, width: 4, height: '100%',
          cursor: 'col-resize', zIndex: 50, background: 'transparent',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(168,85,247,0.35)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      />


      {/* ── Error / loading bar ───────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '6px 14px', background: 'rgba(248,113,113,0.07)', borderBottom: `1px solid rgba(248,113,113,0.2)`, fontFamily: fMono, fontSize: 10, color: C.red, flexShrink: 0 }}>
          ! {error}
        </div>
      )}
      {(isLoading || battleLoading) && (
        <div style={{ height: 2, flexShrink: 0, background: C.border, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: '40%',
            background: battleLoading ? C.red : C.accent,
            animation: 'fpSlide 1.2s ease-in-out infinite',
          }} />
        </div>
      )}

      {/* ── Bouton HOME ───────────────────────────────────────────────────── */}
      <a href="/dashboard" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 14px', flexShrink: 0,
        background: 'none', borderBottom: `1px solid ${C.border}`,
        color: '#6b7280', textDecoration: 'none',
        fontFamily: "'Michroma', sans-serif", fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
        transition: 'all 0.15s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = '#a855f7'; (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(168,85,247,0.06)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = '#6b7280'; (e.currentTarget as HTMLAnchorElement).style.background = 'none'; }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        Home
      </a>

      {/* ── Tab navigation (2 onglets maîtres) ──────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: '#060612' }}>
        {/* GEO.PROMPT */}
        {(() => {
          const active = activeTab === 'geoprompt';
          return (
            <button onClick={() => setActiveTab('geoprompt')} style={{
              flex: 1, padding: '11px 6px 10px',
              background: active ? `rgba(168,85,247,0.07)` : 'none',
              border: 'none', borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
              <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.12em' }}>
                <span style={{ color: active ? '#3dffa0' : '#8888aa' }}>GEO</span>
                <span style={{ color: active ? C.accent : '#8888aa' }}>.</span>
                <span style={{ color: active ? C.text : '#8888aa' }}>PROMPT</span>
              </div>
            </button>
          );
        })()}
        {/* EXPERT */}
        {(() => {
          const active = activeTab === 'expert';
          return (
            <button onClick={() => setActiveTab('expert')} style={{
              flex: 1, padding: '11px 6px 10px', position: 'relative',
              background: active ? 'rgba(61,255,160,0.05)' : 'none',
              border: 'none', borderBottom: active ? `2px solid ${C.green}` : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
              <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.12em', color: active ? C.green : '#8888aa', transition: 'color 0.15s' }}>
                EXPERT
              </div>
              {EXPERT_BADGE > 0 && (
                <div style={{ position: 'absolute', top: 6, right: 8, width: 5, height: 5, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
              )}
            </button>
          );
        })()}
      </div>

      {/* ── Sous-onglets EXPERT ───────────────────────────────────────────── */}
      {activeTab === 'expert' && (
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: '#070710' }}>
          {EXPERT_SUBTABS.map(sub => {
            const active = activeExpertTab === sub.id;
            return (
              <button key={sub.id} onClick={() => setActiveExpertTab(sub.id)} style={{
                flex: 1, padding: '8px 4px 7px', position: 'relative',
                background: active ? `rgba(${hexToRgb(sub.color)},0.07)` : 'none',
                border: 'none', borderBottom: active ? `1px solid ${sub.color}` : '1px solid transparent',
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
                <div style={{ fontFamily: fMichroma, fontSize: 6, letterSpacing: '0.1em', color: active ? sub.color : '#666688', transition: 'color 0.15s' }}>
                  {sub.label}
                </div>
                {(sub.badge ?? 0) > 0 && (
                  <div style={{ position: 'absolute', top: 5, right: 6, width: 4, height: 4, borderRadius: '50%', background: sub.color, boxShadow: `0 0 4px ${sub.color}` }} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* ════════════════════════════════════════
            ONGLET MAÎTRE 1 — GEO.PROMPT (chat IA)
        ════════════════════════════════════════ */}
        {activeTab === 'geoprompt' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            {chatSlot}
          </div>
        )}

        {/* ════════════════════════════════════════
            ONGLET MAÎTRE 2 — EXPERT (sous-onglets)
        ════════════════════════════════════════ */}
        {/* ── Scrollable wrapper pour territoire + poi + analyse ── */}
        {activeTab === 'expert' && (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ════════════════════════════════════════
            ONGLET 2 — TERRITOIRE
        ════════════════════════════════════════ */}
        {activeExpertTab === 'territoire' && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Scope global */}
            <div>
              <div style={labelStyle}>PERIMETRE GLOBAL</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ ...pill(scope === 'metro', C.green), flex: 1, textAlign: 'center' }} onClick={() => selectScope('metro')}>
                  France Metro
                </button>
                <button style={{ ...pill(scope === 'all', C.green), flex: 1, textAlign: 'center' }} onClick={() => selectScope('all')}>
                  France + DROM
                </button>
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: C.border }} />

            {/* Régions */}
            <div>
              <div style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>REGION {selectedRegions.length > 0 && <span style={{ color: C.green }}>({selectedRegions.length})</span>}</span>
                <button
                  onClick={() => {
                    const allIds = REGIONS.map(r => r.id);
                    const allSelected = selectedRegions.length === REGIONS.length;
                    setSelectedRegions(allSelected ? [] : allIds);
                    setScope(null);
                  }}
                  style={{ fontFamily: fMichroma, fontSize: 7, color: selectedRegions.length === REGIONS.length ? C.red : C.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.08em' }}
                >
                  {selectedRegions.length === REGIONS.length ? 'TOUT DÉSÉLECTIONNER' : 'TOUT SÉLECTIONNER'}
                </button>
              </div>
              <MultiDropdown
                label="Toutes les régions"
                items={REGIONS.map(r => ({ id: r.id, label: r.nom }))}
                selected={selectedRegions}
                onChange={ids => { setSelectedRegions(ids); if (ids.length > 0) setScope(null); }}
              />
            </div>

            {/* Départements */}
            <div>
              <div style={labelStyle}>
                DEPARTEMENT
                {selectedRegions.length > 0 && <span style={{ color: C.textDim }}> — {availableDepts.length} dispo</span>}
                {selectedDepts.length > 0 && <span style={{ color: C.green }}> ({selectedDepts.length})</span>}
              </div>
              <MultiDropdown
                label="Tous les départements"
                items={availableDepts.map(d => ({ id: d.code, label: `${d.code} — ${d.nom}` }))}
                selected={selectedDepts}
                onChange={ids => { setSelectedDepts(ids); if (ids.length > 0) setScope(null); }}
                searchable
              />
              {selectedRegions.length === 0 && (
                <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, marginTop: 4, fontStyle: 'italic' }}>
                  Filtrer d'abord par région
                </div>
              )}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: C.border }} />

            {/* Recherche locale */}
            <div>
              <div style={labelStyle}>RECHERCHE LOCALE</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>VILLE</div>
                  <input style={inputStyle} placeholder="ex: Brest" value={ville}
                    onChange={e => { setVille(e.target.value); if (e.target.value) setScope(null); }} />
                </div>
                <div style={{ width: 80 }}>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>CODE POSTAL</div>
                  <input style={inputStyle} placeholder="29200" value={codePostal}
                    onChange={e => setCodePostal(e.target.value)} maxLength={5} />
                </div>
              </div>
            </div>

            {/* Territoire summary */}
            {hasTerritoire && (
              <div style={{ padding: '10px 12px', background: C.greenDim, border: `1px solid rgba(61,255,160,0.2)`, borderRadius: 2 }}>
                <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.green, letterSpacing: '0.1em', marginBottom: 4 }}>
                  TERRITOIRE SELECTIONNE
                </div>
                <div style={{ fontFamily: fMono, fontSize: 11, color: C.text, lineHeight: 1.4 }}>{territoire}</div>
                <button
                  onClick={() => { setScope(null); setSelectedRegions([]); setSelectedDepts([]); setVille(''); setCodePostal(''); }}
                  style={{ marginTop: 8, fontFamily: fMichroma, fontSize: 7, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.1em' }}
                >
                  ✕ REINITIALISER
                </button>
              </div>
            )}

          </div>
        )}

        {/* ════════════════════════════════════════
            ONGLET POI — Points d'intérêt
        ════════════════════════════════════════ */}
        {activeExpertTab === 'poi' && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* ── Section : Points d'intérêt ─────────────────────────────── */}
            <div style={{ paddingBottom: 4 }}>
              <div style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: C.accent, marginBottom: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                POINTS D'INTÉRÊT (POI)
              </div>
            <div>
              <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  TYPES DE POI
                  {selectedPOI.length > 0 && <span style={{ color: C.accent }}> — {selectedPOI.length} selectionne{selectedPOI.length > 1 ? 's' : ''}</span>}
                </span>
                <button
                  onClick={() => fetchCategories(true)}
                  title="Rafraîchir la liste"
                  style={{ background: 'none', border: 'none', color: catsLoading ? C.muted : C.textDim, cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1 }}
                >{catsLoading ? '…' : '↻'}</button>
              </div>
              <MultiDropdown
                label="Aucun type selectionne"
                items={poiTypes}
                selected={selectedPOI}
                onChange={setSelectedPOI}
              />
              {/* Cartes POI sélectionnés */}
              {selectedPOI.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {selectedPOI.map(poi => {
                    const style = getPOIStyle(poi);
                    // Style commun pour les selects : avec flèche ▾ custom
                    const selectBase: React.CSSProperties = {
                      fontFamily: fMono, fontSize: 10,
                      background: '#0a0a14',
                      border: `1px solid ${C.border}`, borderRadius: 2,
                      color: C.text, padding: '4px 22px 4px 6px',
                      outline: 'none', cursor: 'pointer', flex: 1, width: '100%',
                      appearance: 'none' as const,
                    };
                    const selectWrap: React.CSSProperties = {
                      position: 'relative', flex: 1, display: 'flex', alignItems: 'center',
                    };
                    const selectArrow: React.CSSProperties = {
                      position: 'absolute', right: 7, pointerEvents: 'none',
                      fontFamily: fMono, fontSize: 8, color: C.muted, lineHeight: 1,
                    };
                    return (
                      <div key={poi} style={{
                        background: 'rgba(168,85,247,0.06)',
                        border: `1px solid ${C.border}`,
                        borderRadius: 2, padding: '8px 10px',
                        display: 'flex', flexDirection: 'column', gap: 7,
                      }}>
                        {/* Header : nom + bouton X */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontFamily: fMichroma, fontSize: 9, letterSpacing: '0.14em', color: C.accent }}>
                            {poi.toUpperCase()}
                          </span>
                          <button
                            onClick={() => {
                              setSelectedPOI(prev => prev.filter(p => p !== poi));
                              setPoiStyles(prev => { const n = { ...prev }; delete n[poi]; return n; });
                            }}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: C.muted, fontSize: 11, lineHeight: 1, padding: '0 2px',
                              fontFamily: fMono,
                            }}
                            title="Retirer ce POI"
                          >✕</button>
                        </div>

                        {/* Épingle (taille) */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.12em', color: C.muted, whiteSpace: 'nowrap', width: 50 }}>
                            EPINGLE
                          </span>
                          <div style={selectWrap}>
                            <select
                              value={style.size}
                              onChange={e => setPOIStyle(poi, { size: e.target.value })}
                              style={selectBase}
                            >
                              {PIN_SIZES.map(s => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                            <span style={selectArrow}>▾</span>
                          </div>
                        </div>

                        {/* Couleur */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.12em', color: C.muted, whiteSpace: 'nowrap', width: 50 }}>
                            COULEUR
                          </span>
                          <div style={{ ...selectWrap }}>
                            <div style={{
                              width: 10, height: 10, borderRadius: '50%',
                              background: style.color,
                              border: `1px solid rgba(255,255,255,0.15)`,
                              position: 'absolute', left: 7, pointerEvents: 'none', zIndex: 1,
                              flexShrink: 0,
                            }} />
                            <select
                              value={style.color}
                              onChange={e => setPOIStyle(poi, { color: e.target.value })}
                              style={{ ...selectBase, paddingLeft: 24 }}
                            >
                              {PIN_COLORS.map(c => (
                                <option key={c.hex} value={c.hex}>{c.label}</option>
                              ))}
                            </select>
                            <span style={selectArrow}>▾</span>
                          </div>
                        </div>

                        {/* Nature (metadata->>'libelle_nature') */}
                        {poiNatures[poi]?.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.12em', color: C.muted }}>
                              NATURE
                              {(selectedPoiNatures[poi]?.length ?? 0) > 0 && (
                                <span style={{ color: C.accent }}>
                                  {' '}— {selectedPoiNatures[poi].length} selectionnee{selectedPoiNatures[poi].length > 1 ? 's' : ''}
                                </span>
                              )}
                            </span>
                            <MultiDropdown
                              label="Toutes les natures"
                              items={poiNatures[poi].map(n => ({ id: n, label: n }))}
                              selected={selectedPoiNatures[poi] ?? []}
                              onChange={sel => setSelectedPoiNatures(prev => ({ ...prev, [poi]: sel }))}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* AFFICHER button + densité toggle */}
            {hasAnyPOI && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ ...primaryBtn(C.green, searchLoading), flex: 1 }} disabled={searchLoading} onClick={handleSearchPOI}>
                  {searchLoading ? 'CHARGEMENT...' : 'AFFICHER LES POI SUR LA CARTE'}
                </button>
                <button
                  title={densityMode ? 'Mode densité activé — cliquer pour repasser en marqueurs' : 'Passer en carte de densité'}
                  onClick={() => onDensityModeChange?.(!densityMode)}
                  style={{
                    flexShrink: 0, padding: '0 10px',
                    background: densityMode ? 'rgba(168,85,247,0.18)' : C.bgInput,
                    border: `1px solid ${densityMode ? C.accent : C.border}`,
                    borderRadius: 2, cursor: 'pointer',
                    fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.1em',
                    color: densityMode ? C.accent : C.muted,
                    whiteSpace: 'nowrap', transition: 'all 0.15s',
                  }}
                >
                  {densityMode ? '◉ DENSITÉ' : '◎ DENSITÉ'}
                </button>
              </div>
            )}

            </div>{/* fin section POI */}

            {/* ── Divider ─────────────────────────────────────────────────── */}
            <div style={{ height: 1, background: C.border }} />

            {/* ── Section : Panneaux OOH & DOOH ───────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: '#76b7b2', borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                PANNEAUX OOH &amp; DOOH
              </div>

              {/* Info stock */}
              <div style={{ fontFamily: fMono, fontSize: 9, color: C.textDim, lineHeight: 1.5 }}>
                <span style={{ color: '#76b7b2' }}>1 434</span> panneaux · Brest Métropole
                <span style={{ color: C.muted }}> · DECAUX, Clear Channel…</span>
              </div>

              {/* Filtre par régie (optionnel) */}
              <div>
                <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.12em', color: C.muted, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    FILTRER PAR RÉGIE (optionnel)
                    {selectedOOH.length > 0 && <span style={{ color: C.accent }}> — {selectedOOH.length} sélectionnée{selectedOOH.length > 1 ? 's' : ''}</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button
                      title="Tout sélectionner"
                      onClick={() => setSelectedOOH(OOH_REGIES.map(r => r.id))}
                      style={{ background: 'none', border: `1px solid ${C.border}`, color: C.textDim, cursor: 'pointer', fontSize: 8, padding: '1px 5px', letterSpacing: '0.08em', fontFamily: fMichroma }}
                    >ALL</button>
                    <button
                      title="Tout désélectionner"
                      onClick={() => setSelectedOOH([])}
                      style={{ background: 'none', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', fontSize: 10, padding: '1px 5px', lineHeight: 1 }}
                    >✕</button>
                  </span>
                </div>
                <MultiDropdown
                  label="Toutes les régies"
                  items={OOH_REGIES}
                  selected={selectedOOH}
                  onChange={setSelectedOOH}
                />
              </div>

              {/* Bouton toujours visible */}
              <button
                style={{ ...primaryBtn('#76b7b2', false) }}
                onClick={() => onDirectOOH(selectedOOH.length > 0 ? selectedOOH : undefined)}
              >
                {selectedOOH.length > 0
                  ? `AFFICHER — ${selectedOOH.length} RÉGIE${selectedOOH.length > 1 ? 'S' : ''}`
                  : 'AFFICHER TOUS LES PANNEAUX'}
              </button>
            </div>

            {/* ── Divider ─────────────────────────────────────────────────── */}
            <div style={{ height: 1, background: C.border }} />

            {/* ── Section : Arrêts de transport en commun ─────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: '#38bdf8', borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                ARRÊTS DE TRANSPORT EN COMMUN
              </div>

              {/* Sélection du type */}
              <div>
                <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    TYPE DE TRANSPORT
                    {selectedTransportTypes.length > 0 && (
                      <span style={{ color: '#38bdf8' }}> — {selectedTransportTypes.join(', ')}</span>
                    )}
                  </span>
                  {selectedTransportTypes.length > 0 && (
                    <button
                      onClick={() => setSelectedTransportTypes([])}
                      style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 10, padding: '0 2px', fontFamily: fMono }}
                      title="Tout désélectionner"
                    >✕</button>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {TRANSPORT_TYPES.map(t => (
                    <button
                      key={t.id}
                      style={pill(selectedTransportTypes.includes(t.id), '#38bdf8')}
                      onClick={() => setSelectedTransportTypes(prev =>
                        prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id]
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, marginTop: 5, fontStyle: 'italic' }}>
                  {selectedTransportTypes.length === 0 ? 'Tous les types' : ''} · Chargé pour la zone visible
                </div>
              </div>

              <button
                style={primaryBtn('#38bdf8', transportLoading || !onLoadTransport)}
                disabled={transportLoading || !onLoadTransport}
                onClick={async () => {
                  setTransportLoading(true);
                  try { await onLoadTransport?.(selectedTransportTypes); }
                  finally { setTransportLoading(false); }
                }}
              >
                {transportLoading ? 'CHARGEMENT…' : 'AFFICHER ARRÊTS'}
              </button>
            </div>

            {/* ── Divider ─────────────────────────────────────────────────── */}
            <div style={{ height: 1, background: C.border }} />

            {/* ── Section : Flux routier TMJA ──────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: '#f97316', borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                FLUX ROUTIER (TMJA)
              </div>

              {/* Légende couleurs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.12em', color: C.muted, marginBottom: 2 }}>
                  LÉGENDE — TRAFIC MOYEN JOURNALIER
                </div>
                {[
                  { color: '#4292C6', label: '< 5 000 véh/j' },
                  { color: '#f6d543', label: '5 000 – 15 000 véh/j' },
                  { color: '#f97316', label: '15 000 – 40 000 véh/j' },
                  { color: '#ef4444', label: '> 40 000 véh/j' },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 24, height: 3, background: color, borderRadius: 2, flexShrink: 0 }} />
                    <span style={{ fontFamily: fMono, fontSize: 9, color: C.muted }}>{label}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  style={{ ...primaryBtn('#f97316', tmjaLoading || !onLoadTMJA), flex: 1 }}
                  disabled={tmjaLoading || !onLoadTMJA}
                  onClick={async () => {
                    setTmjaLoading(true);
                    try { await onLoadTMJA?.(); }
                    finally { setTmjaLoading(false); }
                  }}
                >
                  {tmjaLoading ? 'CHARGEMENT…' : tmjaVisible ? '↻ ACTUALISER' : 'AFFICHER TMJA'}
                </button>
                {tmjaVisible && (
                  <button
                    style={pill(false, C.muted)}
                    onClick={onClearTMJA}
                    title="Masquer le flux routier"
                  >MASQUER</button>
                )}
              </div>
              <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, fontStyle: 'italic' }}>
                Source : CEREMA — tronçons pour la zone visible
              </div>
            </div>

          </div>
        )}

        {/* ════════════════════════════════════════
            ONGLET ANALYSE — accordéons
        ════════════════════════════════════════ */}
        {activeExpertTab === 'analyse' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>

            {/* ── Accordéon : ANALYSE SPATIALE ────────────────────────────── */}
            <button
              onClick={() => toggleAnalyse('spatiale')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 16px', background: analyseOpen.spatiale ? 'rgba(168,85,247,0.07)' : 'transparent',
                border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: C.accent }}>
                ANALYSE SPATIALE
              </span>
              <span style={{ color: C.accent, fontSize: 9 }}>{analyseOpen.spatiale ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.spatiale && (
            <div style={{ padding: '16px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ paddingBottom: 4 }}>

              {/* Info encart — 0 POI sélectionné */}
              {!hasAnyPOI && (
                <div style={{
                  padding: '14px', borderRadius: 2,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${C.border}`,
                }}>
                  <div style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.12em', color: C.muted, marginBottom: 8 }}>
                    ANALYSES SPATIALES DISPONIBLES
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { icon: '⬡', label: 'Voronoi Geometrique', desc: 'Zones à vol d\'oiseau' },
                      { icon: '◎', label: 'Isochrones Routiers',  desc: 'Temps de trajet réel ORS' },
                    ].map(tool => (
                      <div key={tool.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 2, border: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 14, color: C.muted, flexShrink: 0, fontFamily: fMono }}>{tool.icon}</span>
                        <div>
                          <div style={{ fontFamily: fMichroma, fontSize: 8, color: C.muted, letterSpacing: '0.1em' }}>{tool.label}</div>
                          <div style={{ fontFamily: fMono, fontSize: 9, color: C.textDim, marginTop: 1 }}>{tool.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: '9px 11px', background: C.accentDim, border: `1px solid rgba(168,85,247,0.25)`, borderRadius: 2 }}>
                    <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.accent, letterSpacing: '0.12em', marginBottom: 4 }}>
                      SELECTIONNEZ 1 SEUL TYPE DE POI
                    </div>
                    <div style={{ fontFamily: fMono, fontSize: 10, color: C.violet, lineHeight: 1.5 }}>
                      Isolez un réseau (ex: CIRFA) pour débloquer le calcul de zone de chalandise.
                    </div>
                  </div>
                </div>
              )}

              {/* Info encart — plusieurs POI sélectionnés */}
              {selectedPOI.length > 1 && (
                <div style={{ padding: '10px 12px', background: C.redDim, border: `1px solid ${C.redBorder}`, borderRadius: 2, marginTop: 4 }}>
                  <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.red, letterSpacing: '0.1em', marginBottom: 4 }}>! TROP DE TYPES SELECTIONNES</div>
                  <div style={{ fontFamily: fMono, fontSize: 10, color: '#fca5a5', lineHeight: 1.5 }}>
                    Les analyses spatiales nécessitent exactement 1 type de POI. Retirez {selectedPOI.length - 1} type{selectedPOI.length > 2 ? 's' : ''}.
                  </div>
                </div>
              )}

              {/* Boutons analyses — visibles uniquement si exactement 1 POI */}
              {exactlyOnePOI && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>

                  {/* Mode de transport — visible globalement */}
                  <div>
                    <div style={labelStyle}>MODE DE TRANSPORT</div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {ISO_MODES.map(m => (
                        <button key={m.id} style={{ ...pill(transportMode === m.id, C.accent), flex: 1, textAlign: 'center' }} onClick={() => setTransportMode(m.id)}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Voronoï Géométrique ── */}
                  <div style={{ border: `1px solid ${showVoronoi ? 'rgba(167,139,250,0.4)' : C.border}`, borderRadius: 2, overflow: 'hidden' }}>
                    <button
                      disabled={isLoading}
                      onClick={() => { setShowVoronoi(s => !s); setShowBattle(false); setShowBattleV2(false); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 12px', background: showVoronoi ? 'rgba(167,139,250,0.1)' : 'rgba(167,139,250,0.04)',
                        border: 'none', cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.12em', color: voronoiVisible ? '#a78bfa' : '#c4b5fd' }}>
                        {voronoiVisible ? '✓ ' : ''}VORONOI GEOMETRIQUE
                      </span>
                      <span style={{ color: '#a78bfa', fontSize: 9 }}>{showVoronoi ? '▲' : '▼'}</span>
                    </button>
                    {showVoronoi && (
                      <div style={{ padding: '12px', background: 'rgba(167,139,250,0.04)', borderTop: `1px solid rgba(167,139,250,0.15)`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontFamily: fMono, fontSize: 10, color: C.violet, lineHeight: 1.5 }}>
                          Zones au POI le plus proche à vol d'oiseau. Instantané, sans API.
                        </div>
                        <button style={primaryBtn('#a78bfa', isLoading)} disabled={isLoading} onClick={handleVoronoi}>
                          LANCER LE CALCUL
                        </button>
                        {voronoiVisible && (
                          <button style={pill(false, '#a78bfa')} onClick={() => setVoronoiVisible(false)}>
                            Masquer le Voronoi
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Bataille V2 — cache only ── */}
                  <div style={{ border: `1px solid ${showBattleV2 ? 'rgba(34,211,238,0.4)' : C.border}`, borderRadius: 2, overflow: 'hidden' }}>
                    <button
                      disabled={battleV2Loading}
                      onClick={() => { setShowBattleV2(s => !s); setShowBattle(false); setShowVoronoi(false); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 12px', background: showBattleV2 ? 'rgba(34,211,238,0.07)' : 'rgba(34,211,238,0.03)',
                        border: 'none', cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.12em', color: battleVisible ? '#22d3ee' : '#67e8f9' }}>
                        {battleVisible ? '✓ ' : ''}BATAILLE V2 (MULTI-PALIERS)
                      </span>
                      <span style={{ color: '#22d3ee', fontSize: 9 }}>{showBattleV2 ? '▲' : '▼'}</span>
                    </button>
                  {showBattleV2 && (
                    <div style={{ padding: '13px', background: 'rgba(34,211,238,0.03)', borderTop: '1px solid rgba(34,211,238,0.15)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ fontFamily: fMono, fontSize: 10, color: '#67e8f9', lineHeight: 1.5 }}>
                        Lit le cache existant — <span style={{ color: '#fff' }}>aucun appel ORS</span>. Paliers manquants skippés.
                        Lance d'abord les isochrones v1 pour remplir le cache.
                      </div>

                      {/* Sélection des paliers */}
                      <div>
                        <div style={{ ...labelStyle, color: '#22d3ee' }}>
                          PALIERS — {battleV2Paliers.join(', ')} min
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {[10, 20, 30, 40, 50, 60, 90].map(p => (
                            <button
                              key={p}
                              style={pill(battleV2Paliers.includes(p), '#22d3ee')}
                              onClick={() => {
                                setV2CacheStatus(null);
                                setBattleV2Paliers(prev =>
                                  prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p].sort((a, b) => a - b)
                                );
                              }}
                            >
                              {p} min
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* ── Statut cache V2 ── */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {/* Barre de statut */}
                        {v2CacheStatus && (
                          <div style={{
                            background: v2CacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.06)' : 'rgba(251,191,36,0.06)',
                            border: `1px solid ${v2CacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.3)' : 'rgba(251,191,36,0.35)'}`,
                            borderRadius: 2, padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 4,
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontFamily: fMono, fontSize: 9, color: '#94a3b8' }}>
                                {v2CacheStatus.total_pois} POIs · {v2CacheStatus.total_combos} isochrones
                              </span>
                              <span style={{ fontFamily: fMono, fontSize: 9, color: v2CacheStatus.missing_combos === 0 ? '#3dffa0' : C.amber, fontWeight: 700 }}>
                                {v2CacheStatus.missing_combos === 0
                                  ? '✓ 100% en cache'
                                  : `✕ ${v2CacheStatus.missing_pois} POI${v2CacheStatus.missing_pois > 1 ? 's' : ''} manquants`}
                              </span>
                            </div>
                            {/* Barre de progression cache */}
                            <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', borderRadius: 2,
                                width: `${Math.round((v2CacheStatus.cached_combos / Math.max(v2CacheStatus.total_combos, 1)) * 100)}%`,
                                background: v2CacheStatus.missing_combos === 0 ? '#3dffa0' : '#22d3ee',
                                transition: 'width 0.4s ease',
                              }} />
                            </div>
                            <div style={{ fontFamily: fMono, fontSize: 8, color: '#6b7280' }}>
                              {v2CacheStatus.cached_combos}/{v2CacheStatus.total_combos} en cache
                              {v2CacheStatus.missing_combos > 0 && ` · ${v2CacheStatus.missing_combos} à calculer`}
                            </div>
                          </div>
                        )}

                        {/* Bouton calculer manquants (si POIs sans cache) */}
                        {v2CacheStatus && v2CacheStatus.missing_pois > 0 && (
                          <button
                            style={primaryBtn(C.amber, v2Filling || battleV2Loading)}
                            disabled={v2Filling || battleV2Loading}
                            onClick={handleFillMissingV2}
                          >
                            {v2Filling
                              ? 'ORS EN COURS...'
                              : `CALCULER ${v2CacheStatus.missing_pois} POI${v2CacheStatus.missing_pois > 1 ? 'S' : ''} MANQUANTS (ORS)`}
                          </button>
                        )}

                        {/* Boutons lancer */}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            style={primaryBtn('#6b7280', battleV2Paliers.length === 0 || v2Checking || v2Filling || battleV2Loading)}
                            disabled={battleV2Paliers.length === 0 || v2Checking || v2Filling || battleV2Loading}
                            onClick={handleCheckV2}
                          >
                            {v2Checking ? 'VÉRIF...' : 'VÉRIFIER CACHE'}
                          </button>
                          <button
                            style={primaryBtn('#22d3ee', battleV2Paliers.length === 0 || battleV2Loading || v2Filling)}
                            disabled={battleV2Paliers.length === 0 || battleV2Loading || v2Filling}
                            onClick={() => { setV2CacheStatus(null); handleBattleV2(false); }}
                          >
                            {battleV2Loading ? 'CALCUL...' : 'LANCER'}
                          </button>
                          <button
                            style={primaryBtn(C.amber, battleV2Paliers.length === 0 || battleV2Loading || v2Filling)}
                            disabled={battleV2Paliers.length === 0 || battleV2Loading || v2Filling}
                            onClick={() => { setV2CacheStatus(null); handleBattleV2(true); }}
                          >
                            FORCER
                          </button>
                        </div>
                      </div>

                      {/* ── Barre de progression ORS fill ── */}
                      {v2Filling && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {/* Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono, fontSize: 9, color: C.muted }}>
                            <span style={{ color: C.amber }}>
                              {v2FillTotal > 0 ? `ORS — ${v2FillCompleted}/${v2FillTotal} POIs` : 'ORS — initialisation...'}
                            </span>
                            <span style={{ color: v2FillPct > 0 ? C.green : C.muted }}>{v2FillPct}%</span>
                          </div>
                          {/* Barre principale */}
                          <div style={{ height: 4, background: '#1a1025', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 2,
                              width: `${v2FillPct}%`,
                              background: v2FillPct === 100 ? C.green : C.amber,
                              transition: 'width 0.4s ease',
                            }} />
                          </div>
                          {/* Sous-stats */}
                          <div style={{ display: 'flex', gap: 10, fontFamily: fMono, fontSize: 8, color: '#6b7280' }}>
                            {v2FillTotal > 0 && (
                              <>
                                <span style={{ color: '#22d3ee' }}>↗ {v2FillRings} isochrones reçus</span>
                                <span>·</span>
                                <span>{v2FillTotal - v2FillCompleted} POIs restants</span>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ── Barre de progression Bataille V2 ── */}
                      {battleV2Loading && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono, fontSize: 9, color: C.muted }}>
                            <span style={{ color: '#22d3ee', animation: 'fpBlink 1s ease-in-out infinite' }}>
                              BATAILLE V2 — PostGIS ST_Difference...
                            </span>
                          </div>
                          {/* Barre indéterminée */}
                          <div style={{ height: 4, background: '#1a1025', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                            <div style={{
                              position: 'absolute', height: '100%', width: '40%',
                              background: 'linear-gradient(90deg, transparent, #22d3ee, transparent)',
                              animation: 'fpScan 1.8s linear infinite',
                              borderRadius: 2,
                            }} />
                          </div>
                        </div>
                      )}

                      {/* ── Log terminal ── */}
                      {battleV2Log.length > 0 && (
                        <div style={{
                          background: '#020205', border: '1px solid rgba(34,211,238,0.2)',
                          borderRadius: 2, padding: '8px 10px', fontFamily: fMono, fontSize: 9,
                          color: '#9ca3af', lineHeight: 1.7, maxHeight: 140, overflowY: 'auto',
                          display: 'flex', flexDirection: 'column', gap: 1,
                        }}>
                          {battleV2Log.map((line, i) => (
                            <div key={i} style={{
                              color: line.startsWith('> ✓') ? '#22d3ee'
                                   : line.startsWith('> ✕') ? C.red
                                   : line.startsWith('> !') ? C.amber
                                   : line.startsWith('> ◆') ? '#a78bfa'
                                   : line.startsWith('> ORS') ? C.amber
                                   : '#9ca3af',
                            }}>{line}</div>
                          ))}
                          {(battleV2Loading || v2Filling) && <div style={{ color: '#22d3ee', animation: 'fpBlink 1s ease-in-out infinite' }}>▌</div>}
                        </div>
                      )}

                      {battleVisible && (
                        <button style={pill(false, '#22d3ee')} onClick={() => { setBattleVisible(false); setBattleV2Log([]); }}>
                          Masquer
                        </button>
                      )}
                    </div>
                  )}
                  </div>

                  {/* ── Isochrones Routiers (ORS) ── */}
                  <div style={{ border: `1px solid ${showBattle ? 'rgba(248,113,113,0.4)' : C.border}`, borderRadius: 2, overflow: 'hidden' }}>
                    <button
                      disabled={battleLoading}
                      onClick={() => { setShowBattle(s => !s); setShowVoronoi(false); setShowBattleV2(false); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 12px', background: showBattle ? 'rgba(248,113,113,0.08)' : 'rgba(248,113,113,0.03)',
                        border: 'none', cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.12em', color: battleVisible ? C.red : '#fca5a5' }}>
                        {battleVisible ? '✓ ' : ''}ISOCHRONES ROUTIERS (ORS)
                      </span>
                      <span style={{ color: C.red, fontSize: 9 }}>{showBattle ? '▲' : '▼'}</span>
                    </button>
                    {showBattle && (
                    <div style={{ padding: '13px', background: 'rgba(248,113,113,0.03)', borderTop: `1px solid rgba(248,113,113,0.15)`, display: 'flex', flexDirection: 'column', gap: 13 }}>

                      {/* Durées */}
                      <div>
                        <div style={labelStyle}>
                          TEMPS DE TRAJET
                          {isoDurations.length > 0 && <span style={{ color: C.red }}> — {isoDurations.join(', ')} min</span>}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {ISO_DURATIONS.map(d => (
                            <button key={d} style={pill(isoDurations.includes(d), C.red)} onClick={() => toggleDuration(d)}>
                              {d} min
                            </button>
                          ))}
                        </div>
                        <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, marginTop: 5, fontStyle: 'italic' }}>
                          Anneaux concentriques — calculé via ORS directement, sans IA
                        </div>
                      </div>

                      {/* ── Statut cache ORS ── */}
                      {orsCacheStatus && (
                        <div style={{
                          background: orsCacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.06)' : 'rgba(251,191,36,0.06)',
                          border: `1px solid ${orsCacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.3)' : 'rgba(251,191,36,0.35)'}`,
                          borderRadius: 2, padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 4,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: fMono, fontSize: 9, color: '#94a3b8' }}>
                              {orsCacheStatus.total_pois} POIs · {orsCacheStatus.total_combos} isochrones
                            </span>
                            <span style={{ fontFamily: fMono, fontSize: 9, color: orsCacheStatus.missing_combos === 0 ? '#3dffa0' : C.amber, fontWeight: 700 }}>
                              {orsCacheStatus.missing_combos === 0
                                ? '✓ 100% en cache'
                                : `${orsCacheStatus.missing_pois} POI${orsCacheStatus.missing_pois > 1 ? 's' : ''} à calculer`}
                            </span>
                          </div>
                          <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 2,
                              width: `${Math.round((orsCacheStatus.cached_combos / Math.max(orsCacheStatus.total_combos, 1)) * 100)}%`,
                              background: orsCacheStatus.missing_combos === 0 ? '#3dffa0' : C.red,
                              transition: 'width 0.4s ease',
                            }} />
                          </div>
                          <div style={{ fontFamily: fMono, fontSize: 8, color: '#6b7280' }}>
                            {orsCacheStatus.cached_combos}/{orsCacheStatus.total_combos} en cache
                            {orsCacheStatus.missing_combos > 0 && ` · ORS calculera les ${orsCacheStatus.missing_combos} manquants automatiquement`}
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          style={primaryBtn('#6b7280', isoDurations.length === 0 || battleLoading || orsChecking)}
                          disabled={isoDurations.length === 0 || battleLoading || orsChecking}
                          onClick={handleCheckORS}
                        >
                          {orsChecking ? 'VÉRIF...' : 'VÉRIFIER CACHE'}
                        </button>
                        <button
                          style={primaryBtn(C.red, isoDurations.length === 0 || battleLoading)}
                          disabled={isoDurations.length === 0 || battleLoading}
                          onClick={() => handleBattle(false)}
                        >
                          {battleLoading ? 'CALCUL ORS...' : 'LANCER'}
                        </button>
                        <button
                          style={primaryBtn(C.amber, isoDurations.length === 0 || battleLoading)}
                          disabled={isoDurations.length === 0 || battleLoading}
                          onClick={() => handleBattle(true)}
                        >
                          RECALCULER
                        </button>
                      </div>

                      {battleLog.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {/* ── Barre de progression ── */}
                          {battleLoading && battleTotal > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono, fontSize: 9, color: C.muted }}>
                                <span style={{ color: battleProgress === 100 ? C.green : C.amber }}>
                                  {battleProgress === 100 ? '✓ TERMINÉ' : `ORS — ${battleCompleted}/${battleTotal} POIs`}
                                </span>
                                <span style={{ color: battleProgress > 0 ? C.green : C.muted }}>{battleProgress}%</span>
                              </div>
                              <div style={{ height: 4, background: '#1a1025', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%',
                                  width: `${battleProgress}%`,
                                  background: battleProgress === 100 ? C.green : C.accent,
                                  transition: 'width 0.4s ease',
                                  borderRadius: 2,
                                }} />
                              </div>
                            </div>
                          )}
                          {/* ── Log terminal ── */}
                          <div style={{
                            background: '#020205', border: `1px solid rgba(248,113,113,0.25)`,
                            borderRadius: 2, padding: '8px 10px', fontFamily: fMono, fontSize: 9,
                            color: '#9ca3af', lineHeight: 1.7, maxHeight: 120, overflowY: 'auto',
                            display: 'flex', flexDirection: 'column', gap: 1,
                          }}>
                            {battleLog.map((line, i) => (
                              <div key={i} style={{
                                color: line.startsWith('> ✓') ? C.green
                                     : line.startsWith('> ✕') ? C.red
                                     : line.startsWith('> !') ? C.amber
                                     : line.includes('[3/3]') ? C.green
                                     : '#9ca3af',
                              }}>{line}</div>
                            ))}
                            {battleLoading && (
                              <div style={{ color: C.red, animation: 'fpBlink 1s ease-in-out infinite' }}>▌</div>
                            )}
                          </div>
                        </div>
                      )}

                      {battleVisible && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={pill(false, C.red)} onClick={() => { setBattleVisible(false); setBattleLog([]); }}>
                            Masquer les isochrones
                          </button>
                          <button
                            style={pill(battleOuterFillVisible, C.muted)}
                            onClick={() => setBattleOuterFillVisible(!battleOuterFillVisible)}
                            title="Afficher/masquer le remplissage Voronoï résiduel (zones hors portée)"
                          >
                            {battleOuterFillVisible ? 'Voronoï ✓' : 'Voronoï'}
                          </button>
                        </div>
                      )}

                      {/* ── Bouton BATAILLE (Phase 2 — ST_Difference) ────── */}
                      {battleRings.length > 0 && !battleLoading && (
                        <>
                        <button
                          style={{ ...pill(false, C.accent), opacity: battleApplyLoading ? 0.5 : 1 }}
                          disabled={battleApplyLoading}
                          onClick={async () => {
                            setBattleApplyLoading(true);
                            setBattleApplyPct(0);
                            setBattleLog(prev => [...prev, '> [BATAILLE] ST_Difference en cours…']);
                            try {
                              await onApplyBattle(
                                battleRings,
                                battleMeta?.categorie,
                                undefined,
                                (msg, pct) => {
                                  setBattleLog(prev => [...prev, `> ${msg}`]);
                                  setBattleApplyPct(pct);
                                },
                              );
                              setBattleApplyPct(100);
                              setBattleLog(prev => [...prev, '> ✓ Territoires découpés sans chevauchement']);
                            } catch (e: unknown) {
                              setBattleLog(prev => [...prev, `> ✕ ${e instanceof Error ? e.message : 'Erreur bataille'}`]);
                            } finally {
                              setBattleApplyLoading(false);
                            }
                          }}
                        >
                          {battleApplyLoading ? `BATAILLE… ${battleApplyPct}%` : 'X BATAILLE (ST_Difference)'}
                        </button>
                        {/* Barre de progression BATAILLE */}
                        {battleApplyLoading && (
                          <div style={{ height: 3, background: 'rgba(168,85,247,0.15)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${battleApplyPct}%`,
                              background: battleApplyPct === 100 ? C.green : C.accent,
                              transition: 'width 0.4s ease, background 0.3s',
                            }} />
                          </div>
                        )}
                        </>
                      )}

                      {/* couverture déplacée dans l'accordéon COUVERTURE */}
                    </div>
                    )}
                  </div>

                </div>
              )}

            </div>{/* fin section analyse spatiale */}
            </div>
            )}

            {/* ── Accordéon : CLUSTERING ──────────────────────────────────── */}
            <button
              onClick={() => toggleAnalyse('clustering')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 16px', background: analyseOpen.clustering ? 'rgba(118,183,178,0.07)' : 'transparent',
                border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: '#76b7b2' }}>
                CLUSTERING
              </span>
              <span style={{ color: '#76b7b2', fontSize: 9 }}>{analyseOpen.clustering ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.clustering && (
            <div style={{ borderBottom: `1px solid ${C.border}` }}>
              <div style={{ minHeight: 400 }}>
                <ClusterPanel
                  geojson={clusterGeoJSON ?? null}
                  visible={clustersVisible ?? false}
                  loading={clusterLoading ?? false}
                  duration={clusterDuration ?? 60}
                  onToggle={onToggleClusters ?? (() => {})}
                  onLoad={onLoadClusters ?? (() => {})}
                  onDurationChange={onClusterDurationChange ?? (() => {})}
                  onFlyTo={onFlyTo ?? (() => {})}
                  onFitBounds={onFitBounds ?? (() => {})}
                  onWizardHighlight={onWizardHighlight}
                  onWizardClose={onWizardClose}
                />
              </div>
            </div>
            )}

            {/* ── Accordéon : CARREAUX ────────────────────────────────────── */}
            <button
              onClick={() => toggleAnalyse('carreaux')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 16px', background: analyseOpen.carreaux ? 'rgba(251,191,36,0.07)' : 'transparent',
                border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: C.amber }}>
                CARREAUX
              </span>
              <span style={{ color: C.amber, fontSize: 9 }}>{analyseOpen.carreaux ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.carreaux && (
            <div style={{ padding: '16px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Toggle visible */}
              <button
                onClick={() => setCarreauxVisible?.(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  background: carreauxVisible ? 'rgba(96,165,250,0.1)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${carreauxVisible ? '#60a5fa60' : C.border}`,
                  borderRadius: 2, cursor: 'pointer', width: '100%',
                }}
              >
                <span style={{ width: 7, height: 7, background: carreauxVisible ? '#60a5fa' : 'transparent', border: `1.5px solid #60a5fa`, borderRadius: 1, flexShrink: 0 }} />
                <span style={{ fontFamily: fMono, fontSize: 10, color: carreauxVisible ? '#60a5fa' : C.textDim }}>
                  Carreaux{carreauxLoaded ? ' ✓' : ''}
                </span>
              </button>

              {/* Indicateur */}
              <select
                value={carreauxIndicateur ?? 'population_totale'}
                onChange={e => setCarreauxIndicateur?.(e.target.value)}
                style={{ width: '100%', background: '#0a0a12', border: `1px solid #60a5fa40`, borderRadius: 2, color: '#e2e8f0', fontSize: 10, fontFamily: fMono, padding: '3px 5px', cursor: 'pointer', outline: 'none' }}
              >
                {Array.from(new Set(CARREAUX_INDICATEURS.map(i => i.group))).map(g => (
                  <optgroup key={g} label={g} style={{ color: C.textDim }}>
                    {CARREAUX_INDICATEURS.filter(i => i.group === g).map(ind => (
                      <option key={ind.id} value={ind.id}>{ind.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* Palette */}
              <div>
                <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.1em', color: C.muted, marginBottom: 5 }}>PALETTE</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {CARREAUX_PALETTES.map(p => (
                    <button key={p.id} onClick={() => setCarreauxPalette?.(p.id)} title={p.label}
                      style={{ border: `1.5px solid ${carreauxPalette === p.id ? '#e2e8f0' : 'transparent'}`, borderRadius: 3, padding: 0, cursor: 'pointer', background: 'none', display: 'flex', overflow: 'hidden', width: 28, height: 12 }}
                    >
                      {p.stops.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Opacité */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.1em', color: C.muted, whiteSpace: 'nowrap' }}>OPACITÉ</span>
                <input type="range" min={0.1} max={1} step={0.05}
                  value={carreauxOpacity ?? 0.72}
                  onChange={e => setCarreauxOpacity?.(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: '#60a5fa', cursor: 'pointer', height: 4 }}
                />
                <span style={{ color: C.textDim, fontSize: 9, fontFamily: fMono, minWidth: 26, textAlign: 'right' }}>
                  {Math.round((carreauxOpacity ?? 0.72) * 100)}%
                </span>
              </div>

              {/* Légende */}
              <div>
                <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.1em', color: C.muted, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  LÉGENDE
                  {carreauxSelectedBucket !== null && (
                    <button onClick={() => setCarreauxSelectedBucket?.(null)}
                      style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 8, fontFamily: fMichroma, letterSpacing: '0.08em', padding: 0 }}
                    >✕ TOUT</button>
                  )}
                </div>
                {(() => {
                  const pal = CARREAUX_PALETTES.find(p => p.id === (carreauxPalette ?? 'rouge')) ?? CARREAUX_PALETTES[0];
                  if (carreauxRange) {
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {pal.stops.map((color, i) => {
                          const step = (carreauxRange.p95 - carreauxRange.p5) / 6;
                          const min = carreauxRange.p5 + i * step;
                          const max = carreauxRange.p5 + (i + 1) * step;
                          const isSelected = carreauxSelectedBucket === i;
                          const fmt = (v: number) => v >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v).toString();
                          return (
                            <button key={i} onClick={() => setCarreauxSelectedBucket?.(isSelected ? null : i)}
                              style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', background: isSelected ? color + '22' : 'none', border: `1px solid ${isSelected ? color : 'transparent'}`, borderRadius: 2, padding: '1px 3px', cursor: 'pointer' }}
                            >
                              <span style={{ width: 14, height: 8, background: color, borderRadius: 1, flexShrink: 0 }} />
                              <span style={{ color: isSelected ? '#e2e8f0' : C.textDim, fontSize: 8, fontFamily: fMono, flex: 1 }}>
                                {i === 5 ? `≥ ${fmt(min)}` : `${fmt(min)} – ${fmt(max)}`}
                              </span>
                              {isSelected && <span style={{ color, fontSize: 7, fontFamily: fMichroma }}>●</span>}
                            </button>
                          );
                        })}
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      {pal.stops.map((c, i) => <span key={i} style={{ display: 'inline-block', flex: 1, height: 7, background: c, borderRadius: 1 }} />)}
                      <span style={{ color: C.muted, fontSize: 8, marginLeft: 4, fontFamily: fMono }}>z≥10</span>
                    </div>
                  );
                })()}
              </div>

            </div>
            )}

            {/* ── Accordéon : IRIS ────────────────────────────────────────── */}
            <button
              onClick={() => toggleAnalyse('iris')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 16px', background: analyseOpen.iris ? 'rgba(66,146,198,0.07)' : 'transparent',
                border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: '#4292C6' }}>
                IRIS
                {irisVisible && <span style={{ color: '#4292C6', marginLeft: 6 }}>●</span>}
              </span>
              <span style={{ color: '#4292C6', fontSize: 9 }}>{analyseOpen.iris ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.iris && (
            <div style={{ padding: '16px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Toggle visible */}
              <button
                onClick={() => setIrisVisible?.(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  background: irisVisible ? 'rgba(66,146,198,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${irisVisible ? '#4292C660' : C.border}`,
                  borderRadius: 2, cursor: 'pointer', width: '100%',
                }}
              >
                <span style={{ width: 7, height: 7, background: irisVisible ? '#4292C6' : 'transparent', border: `1.5px solid #4292C6`, borderRadius: 1, flexShrink: 0 }} />
                <span style={{ fontFamily: fMono, fontSize: 10, color: irisVisible ? '#9ECAE1' : C.textDim }}>
                  Couche IRIS
                </span>
              </button>

              {/* Indicateur — généré depuis IRIS_DB_COLUMNS */}
              <select
                value={irisIndicateur ?? 'pop_15_29'}
                onChange={e => setIrisIndicateur?.(e.target.value)}
                style={{ width: '100%', background: '#0a0a12', border: `1px solid #4292C640`, borderRadius: 2, color: '#e2e8f0', fontSize: 10, fontFamily: fMono, padding: '3px 5px', cursor: 'pointer', outline: 'none' }}
              >
                {Array.from(
                  IRIS_DB_COLUMNS.reduce((acc, col) => {
                    if (!acc.has(col.group)) acc.set(col.group, []);
                    acc.get(col.group)!.push(col);
                    return acc;
                  }, new Map<string, typeof IRIS_DB_COLUMNS>())
                ).map(([group, cols]) => (
                  <optgroup key={group} label={group} style={{ color: C.textDim }}>
                    {cols.map(col => (
                      <option key={col.name} value={col.name}>{col.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* Palette */}
              <div>
                <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.1em', color: C.muted, marginBottom: 5 }}>PALETTE</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {IRIS_PALETTES.map(p => (
                    <button key={p.id} onClick={() => setIrisPalette?.(p.id)} title={p.label}
                      style={{ border: `1.5px solid ${irisPalette === p.id ? '#e2e8f0' : 'transparent'}`, borderRadius: 3, padding: 0, cursor: 'pointer', background: 'none', display: 'flex', overflow: 'hidden', width: 28, height: 12 }}
                    >
                      {p.stops.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Opacité */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.1em', color: C.muted, whiteSpace: 'nowrap' }}>OPACITÉ</span>
                <input type="range" min={0.1} max={1} step={0.05}
                  value={irisOpacity ?? 0.45}
                  onChange={e => setIrisOpacity?.(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: '#4292C6', cursor: 'pointer', height: 4 }}
                />
                <span style={{ color: C.textDim, fontSize: 9, fontFamily: fMono, minWidth: 26, textAlign: 'right' }}>
                  {Math.round((irisOpacity ?? 0.45) * 100)}%
                </span>
              </div>

              {/* Légende */}
              <div>
                <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.1em', color: C.muted, marginBottom: 4 }}>LÉGENDE</div>
                {(() => {
                  const pal = IRIS_PALETTES.find(p => p.id === (irisPalette ?? 'bleu')) ?? IRIS_PALETTES[0];
                  if (irisStats && irisStats.col_exists && irisStats.max > 0) {
                    const pts = [irisStats.p10, irisStats.p25, irisStats.p50, irisStats.p75, irisStats.p90, irisStats.max];
                    const fmt = (v: number) => v >= 100000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString();
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {pal.stops.map((color, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 14, height: 8, background: color, borderRadius: 1, flexShrink: 0 }} />
                            <span style={{ color: C.textDim, fontSize: 8, fontFamily: fMono }}>
                              {i === 0 ? `≤ ${fmt(pts[0])}` : i === 5 ? `≥ ${fmt(pts[4])}` : `${fmt(pts[i - 1])} – ${fmt(pts[i])}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  if (irisVisible && !irisStats) {
                    return <div style={{ color: C.muted, fontSize: 8, fontFamily: fMono }}>Chargement...</div>;
                  }
                  if (irisStats && !irisStats.col_exists) {
                    return <div style={{ color: C.amber, fontSize: 8, fontFamily: fMono }}>! Colonne non disponible en base</div>;
                  }
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      {pal.stops.map((c, i) => <span key={i} style={{ display: 'inline-block', flex: 1, height: 7, background: c, borderRadius: 1 }} />)}
                    </div>
                  );
                })()}
              </div>

            </div>
            )}

            {/* ── Accordéon : COUVERTURE ──────────────────────────────────── */}
            <button
              onClick={() => toggleAnalyse('couverture')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 16px', background: analyseOpen.couverture ? 'rgba(61,255,160,0.05)' : 'transparent',
                border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: C.green }}>
                COUVERTURE
                {coverageSummary && coverageSummary.length > 0 && (
                  <span style={{ color: C.accent, marginLeft: 6 }}>● {coverageSummary.length}</span>
                )}
              </span>
              <span style={{ color: C.green, fontSize: 9 }}>{analyseOpen.couverture ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.couverture && (
            <div style={{ padding: '0 4px 4px' }}>
              <CoverageResultsPanel
                inline
                battleFeatures={battleFeaturesProp}
                pois={battlePoisProp}
                onResultsReady={setCoverageSummary}
                battleCacheKey={battleCacheKey ?? undefined}
              />
            </div>
            )}

            {/* ── Accordéon : CORRÉLATION IRIS × POI ──────────────────── */}
            <button
              onClick={() => toggleAnalyse('correlation')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 16px', background: analyseOpen.correlation ? C.accentDim : 'transparent',
                border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: C.accent }}>
                CORRÉLATION IRIS × POI
              </span>
              <span style={{ color: C.accent, fontSize: 9 }}>{analyseOpen.correlation ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.correlation && (
            <div style={{ padding: '0 4px 4px' }}>
              <CorrelationPanel
                onFlyTo={onFlyTo}
                params={correlationParams ?? null}
                selectedDepts={selectedDepts}
                territoireLabel={territoire || undefined}
                onShowResiduals={onShowResiduals}
              />
            </div>
            )}

            {/* ── Accordéon : SCORING OOH ─────────────────────────────── */}
            <button
              onClick={() => toggleAnalyse('scoring')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 16px', background: analyseOpen.scoring ? 'rgba(61,255,160,0.05)' : 'transparent',
                border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.16em', color: C.green }}>
                SCORING OOH
              </span>
              <span style={{ color: C.green, fontSize: 9 }}>{analyseOpen.scoring ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.scoring && scoringMapRef && (
            <div style={{ padding: '0 4px 4px' }}>
              <ScoringPanel
                inline
                mapRef={scoringMapRef}
                mapReady={scoringMapReady ?? false}
                onFlyTo={onFlyTo ?? (() => {})}
                onScoreComputed={onScoreComputed}
              />
            </div>
            )}

          </div>
        )}

        </div>
        )}

      </div>

      {/* ── Footer actions ────────────────────────────────────────────────── */}
      {activeTab !== 'geoprompt' && (
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 14px', display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => setShowSavePanel(true)}
          style={{
            flex: 1, padding: '8px', fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.12em',
            background: 'none', border: `1px solid ${C.border}`, borderRadius: 2,
            color: C.muted, cursor: 'pointer', transition: 'all 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
        >
          SAUVEGARDER
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
      `}</style>
    </div>
  );
}
