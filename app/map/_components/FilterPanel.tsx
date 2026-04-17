'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Search, X, ChevronDown, HelpCircle } from 'lucide-react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { ZoneData } from '@/types/spatial';
import { CoverageResultsPanel, type CoverageSummaryEntry } from '@/components/CoverageResultsPanel';
import { ClusterPanel } from './ClusterPanel';
import type { ClusterGeoJSON } from './ClusterPanel';
import { ClusterResultsOverlay } from '@/components/ClusterResultsOverlay';
import { CARREAUX_INDICATEURS, CARREAUX_PALETTES } from '@/components/CarreauxPMTilesLayer';
import { IRIS_PALETTES, type IrisStats } from '@/app/copilote/_hooks/useMapLayers';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';
import { ScoringPanel } from './ScoringPanel';
import type { CampaignListItem } from '@/types/campaign';
import { adminFetch } from '@/lib/admin-fetch';
import dynamic from 'next/dynamic';
import type { CorrelationParams, ResidualsMeta } from './CorrelationPanel';
const CorrelationPanel = dynamic(
  () => import('./CorrelationPanel').then(m => ({ default: m.CorrelationPanel })),
  { ssr: false },
);

// ─── Equity indicator types ──────────────────────────────────────────────────
// ─── Digital palettes (same IDs as IRIS for consistency) ──────────────────────
export const DIGITAL_PALETTES = [
  { id: 'bleu',    label: 'Bleu',    stops: ['#F7FBFF','#C6DBEF','#9ECAE1','#4292C6','#2171B5','#08306B'] },
  { id: 'vert',    label: 'Vert',    stops: ['#F7FCF5','#C7E9C0','#74C476','#41AB5D','#238B45','#00441B'] },
  { id: 'chaleur', label: 'Chaleur', stops: ['#FAEEDA','#FAC775','#EF9F27','#D85A30','#993C1D','#501313'] },
  { id: 'rouge',   label: 'Rouge',   stops: ['#FFF5F0','#FEE0D2','#FCBBA1','#FC9272','#DE2D26','#A50F15'] },
  { id: 'turbo',   label: 'Turbo',   stops: ['#30123b','#4675ed','#1bcfd4','#61fc6c','#f6a91b','#c42503'] },
  { id: 'plasma',  label: 'Plasma',  stops: ['#0d0887','#6a00a8','#b12a90','#e16462','#fca636','#f0f921'] },
  { id: 'teal',    label: 'Teal',    stops: ['#0a0a0a','#16537e','#1e8a7a','#4ecdc4','#7eddd5','#f7fff7'] },
];

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:        'var(--bg-primary)',
  bgPanel:   'var(--bg-surface)',
  bgInput:   'var(--bg-level-2)',
  border:    'var(--border-subtle)',
  text:      'var(--text-primary)',
  textSec:   'var(--text-secondary)',
  textDim:   'var(--text-tertiary)',
  green:     'var(--success)',
  greenDim:  'rgba(61,255,160,0.10)',
  amber:     'var(--warning)',
  amberDim:  'rgba(247,183,49,0.10)',
  red:       'var(--danger)',
  redDim:    'rgba(255,87,87,0.08)',
  redBorder: 'rgba(255,87,87,0.25)',
  muted:     'var(--text-tertiary)',
};
const fInter    = "'Inter', system-ui, sans-serif";
const fMono     = "'JetBrains Mono','Fira Mono',monospace";
const fMichroma = fInter;
const fOrbitron = fInter;

// ─── Radio search autocomplete ────────────────────────────────────────────────
function RadioSearchInput({ onSelect }: { onSelect: (radioId: string, radioNom: string) => void }) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Array<{ id: string; nom: string; categorie_arcom: string | null }>>([]);
  const [show, setShow] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>();

  const search = (q: string) => {
    setQuery(q);
    clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); setShow(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/radio/stations?search=${encodeURIComponent(q)}&limit=8`);
        if (!res.ok) return;
        const d = await res.json();
        setResults(d.stations ?? []);
        setShow(true);
      } catch { /* ignore */ }
    }, 300);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => search(e.target.value)}
        placeholder="Ex: NRJ, France Inter..."
        style={{
          width: '100%', background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6,
          padding: '6px 10px', fontSize: 11, color: 'var(--text-primary)', outline: 'none',
          fontFamily: "'Inter', system-ui, sans-serif",
          transition: 'border-color 0.15s',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; if (results.length) setShow(true); }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; setTimeout(() => setShow(false), 200); }}
      />
      {show && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderRadius: 6,
          marginTop: 4, maxHeight: 200, overflowY: 'auto',
        }}>
          {results.map(r => (
            <button key={r.id} onMouseDown={() => { onSelect(r.id, r.nom); setQuery(r.nom); setShow(false); }} style={{
              display: 'block', width: '100%', padding: '6px 10px', background: 'none', border: 'none',
              textAlign: 'left', cursor: 'pointer', fontSize: 11, color: 'var(--text-primary)',
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: 'background 0.1s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-level-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {r.nom} {r.categorie_arcom && <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>({r.categorie_arcom})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tooltip data for complex labels ──────────────────────────────────────────
const TOOLTIPS: Record<string, string> = {
  tmja:       'Trafic Moyen Journalier Annuel — nombre de véhicules/jour sur un tronçon routier',
  iris:       'Ilots Regroupés pour l\'Information Statistique — découpage INSEE de 2 000 habitants',
  carreaux:   'Maillage 200m de l\'INSEE avec revenus et données fiscales',
  scoring:    'Score de performance d\'un panneau basé sur visibilité, trafic et affinité cible',
  isochrone:  'Zone accessible en X minutes depuis un point donné',
  poi:        'Point d\'Intérêt — commerce, service, lieu public',
  couverture: 'Population unique touchée par l\'ensemble des panneaux (dédupliquée)',
};

// ─── Collapsible section header ───────────────────────────────────────────────
function FilterSectionHeader({
  label, sectionKey, open, onToggle, count, tooltipKey, searchTerm,
}: {
  label: string; sectionKey: string; open: boolean; onToggle: () => void;
  count?: number; tooltipKey?: string; searchTerm?: string;
}) {
  // Highlight search match in label
  const renderLabel = () => {
    if (!searchTerm) return label;
    const idx = label.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (idx < 0) return label;
    return (
      <>
        {label.slice(0, idx)}
        <mark style={{ background: 'rgba(78,205,196,0.2)', color: 'var(--text-primary)', borderRadius: 2, padding: '0 1px' }}>
          {label.slice(idx, idx + searchTerm.length)}
        </mark>
        {label.slice(idx + searchTerm.length)}
      </>
    );
  };

  return (
    <div
      onClick={onToggle}
      style={{
        background: 'var(--bg-level-2)', borderTop: '1px solid var(--border-subtle)',
        padding: '10px 14px', margin: '0 -16px',
        display: 'flex', alignItems: 'center', gap: 8,
        cursor: 'pointer', userSelect: 'none',
        position: 'sticky', top: 0, zIndex: 10,
      }}
    >
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
      <span style={{ fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 500, fontSize: 12, color: 'var(--text-primary)', flex: 1 }}>
        {renderLabel()}
      </span>
      {tooltipKey && TOOLTIPS[tooltipKey] && (
        <span
          title={TOOLTIPS[tooltipKey]}
          style={{ display: 'inline-flex', cursor: 'help', flexShrink: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <HelpCircle size={12} style={{ color: 'var(--text-tertiary)' }} />
        </span>
      )}
      {count !== undefined && count > 0 && (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--brand-teal)',
          background: 'rgba(78,205,196,0.15)', borderRadius: 4, padding: '1px 6px', lineHeight: 1.4,
        }}>
          {count}
        </span>
      )}
      <ChevronDown size={14} style={{
        color: 'var(--text-tertiary)', flexShrink: 0,
        transition: 'transform 0.2s ease',
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
      }} />
    </div>
  );
}

// ─── Données géographiques ─────────────────────────────────────────────────────
import {
  REGIONS_ADMIN as REGIONS, ALL_DEPTS,
  ISO_MODES, ISO_DURATIONS,
} from '@/lib/geo/france-admin';

interface ClusterModelSummary {
  version: number;
  k: number;
  silhouette_score: number;
  n_poi_trained: number;
  duration_minutes: number;
  mode: string;
  created_at: string;
  cluster_labels: Record<string, string>;
}

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
  irisTrueOnly?:        boolean;
  setIrisVisible?:      (v: boolean | ((p: boolean) => boolean)) => void;
  setIrisIndicateur?:   (v: string) => void;
  setIrisPalette?:      (v: string) => void;
  setIrisOpacity?:      (v: number) => void;
  setIrisTrueOnly?:     (v: boolean) => void;
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

  // Digital (DSP impressions choropleth)
  onDigitalShowImpressions?: (campaignId: string) => void;
  onDigitalClear?: () => void;
  digitalVisible?: boolean;
  digitalLoading?: boolean;
  digitalStats?: { total_impressions: number; zones_count: number; campaign_name: string } | null;
  digitalPalette?: string;
  onDigitalPaletteChange?: (paletteId: string) => void;
  digitalInverted?: boolean;
  onDigitalInvertChange?: (inverted: boolean) => void;
  digitalScale?: string;
  onDigitalScaleChange?: (scale: string) => void;
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

  // Auto-enable search when >10 items
  const showSearch = searchable || items.length > 10;

  const filtered = showSearch && search
    ? items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()) || i.id.toLowerCase().includes(search.toLowerCase()))
    : items;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(i => selected.includes(i.id));

  const selectAllFiltered = () => {
    const newIds = new Set(selected);
    for (const i of filtered) newIds.add(i.id);
    onChange([...newIds]);
  };

  const deselectAllFiltered = () => {
    const toRemove = new Set(filtered.map(i => i.id));
    onChange(selected.filter(id => !toRemove.has(id)));
  };

  const displayLabel = selected.length === 0
    ? label
    : selected.length === 1
      ? (items.find(i => i.id === selected[0])?.label ?? selected[0])
      : `${selected.length} / ${items.length} selectionnes`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 11px', background: C.bgInput,
          border: `0.5px solid ${open ? 'var(--border-hover)' : C.border}`, borderRadius: 4,
          cursor: 'pointer', fontFamily: fInter, fontSize: 13, color: selected.length > 0 ? C.text : C.textDim,
          transition: 'all 0.2s ease',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 8 }}>
          {selected.length > 0 && (
            <span
              onClick={e => { e.stopPropagation(); onChange([]); }}
              style={{ fontSize: 11, color: C.textDim, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
              title="Effacer"
            >✕</span>
          )}
          <span style={{ color: C.textDim, fontSize: 9 }}>{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
          background: 'var(--bg-level-2)', border: `0.5px solid var(--border-default)`, borderTop: 'none',
          borderRadius: '0 0 4px 4px', maxHeight: 260, display: 'flex', flexDirection: 'column',
          animation: 'fpDropIn 0.15s ease-out',
        }}>
          {/* Search bar */}
          {showSearch && (
            <div style={{ padding: '5px 8px', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Search size={12} style={{ color: C.textDim, flexShrink: 0 }} />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher..." style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontFamily: fInter, fontSize: 12, color: C.text }} />
              {search && (
                <span onClick={() => setSearch('')} style={{ fontSize: 10, color: C.textDim, cursor: 'pointer', flexShrink: 0 }}>✕</span>
              )}
            </div>
          )}

          {/* Select all / deselect all bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0 }}>
            <button onClick={allFilteredSelected ? deselectAllFiltered : selectAllFiltered}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: fInter, fontSize: 10, color: 'var(--brand-teal)', padding: 0 }}>
              {allFilteredSelected ? 'Tout deselectionner' : `Tout selectionner${search ? ` (${filtered.length})` : ''}`}
            </button>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: C.textDim }}>
              {selected.length}/{items.length}
            </span>
          </div>

          {/* Items list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '8px 11px', fontFamily: fInter, fontSize: 12, color: C.textDim }}>Aucun resultat</div>
            )}
            {filtered.map(item => {
              const active = selected.includes(item.id);
              return (
                <button key={item.id} onClick={() => toggle(item.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                    padding: '6px 11px', background: active ? 'rgba(78,205,196,0.06)' : 'none',
                    border: 'none', borderBottom: `0.5px solid ${C.border}`,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = active ? 'rgba(78,205,196,0.06)' : 'none'; }}
                >
                  <div style={{
                    width: 12, height: 12, borderRadius: 2, border: `0.5px solid ${active ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                    background: active ? 'var(--brand-teal)' : 'transparent', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {active && <span style={{ fontSize: 8, color: 'var(--bg-primary)', fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontFamily: fInter, fontSize: 12, color: active ? C.text : C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                </button>
              );
            })}
          </div>
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
  irisVisible, irisIndicateur, irisPalette, irisOpacity, irisStats, irisTrueOnly,
  setIrisVisible, setIrisIndicateur, setIrisPalette, setIrisOpacity, setIrisTrueOnly,
  scoringMapRef, scoringMapReady, onScoreComputed,
  onLoadTransport, onLoadTMJA, tmjaVisible, onClearTMJA,
  correlationParams, onShowResiduals,
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
  onDigitalShowImpressions, onDigitalClear, digitalVisible, digitalLoading, digitalStats,
  digitalPalette, onDigitalPaletteChange, digitalInverted, onDigitalInvertChange,
  digitalScale, onDigitalScaleChange,
}: FilterPanelProps) {

  // ── UX: Search filter ──────────────────────────────────────────────────────
  const [filterSearch, setFilterSearch] = useState('');

  // ── UX: Collapsible sections with localStorage memory ─────────────────────
  const SECTION_KEYS = ['perimetre', 'regions', 'departements', 'recherche', 'poi', 'ooh', 'transport', 'tmja'] as const;
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return Object.fromEntries(SECTION_KEYS.map(k => [k, true]));
    try {
      const saved = localStorage.getItem('geomatik-filter-sections');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return Object.fromEntries(SECTION_KEYS.map(k => [k, true]));
  });
  const toggleSection = (key: string) => {
    setSectionsOpen(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('geomatik-filter-sections', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const collapseAll = () => {
    const next = Object.fromEntries(SECTION_KEYS.map(k => [k, false]));
    setSectionsOpen(next);
    try { localStorage.setItem('geomatik-filter-sections', JSON.stringify(next)); } catch { /* ignore */ }
  };
  const expandAll = () => {
    const next = Object.fromEntries(SECTION_KEYS.map(k => [k, true]));
    setSectionsOpen(next);
    try { localStorage.setItem('geomatik-filter-sections', JSON.stringify(next)); } catch { /* ignore */ }
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
  const fetchCategories = (forceRefresh = false) => {
    setCatsLoading(true);
    setCatsError(null);
    fetch(forceRefresh ? '/api/map/categories?refresh=1' : '/api/map/categories')
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
        } else {
          setCatsError(data.error ?? 'Réponse inattendue');
        }
      })
      .catch((err: Error) => setCatsError(err.message))
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
    spatiale: false, clustering: false, iris: false, carreaux: false, couverture: false, scoring: false, digital: false,
  });
  const toggleAnalyse = (key: string) =>
    setAnalyseOpen(prev => ({ ...prev, [key]: !prev[key] }));

  // Digital campaign state
  const [digitalCampaigns, setDigitalCampaigns] = useState<CampaignListItem[]>([]);
  const [digitalSelectedCampaign, setDigitalSelectedCampaign] = useState<string>('');
  const [digitalMetricMode, setDigitalMetricMode] = useState<'brut' | 'pour_mille'>('brut');

  useEffect(() => {
    if (!analyseOpen.digital) return;
    // Always refresh campaign list when accordion opens
    fetch(`/api/digital/campaigns?_t=${Date.now()}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: CampaignListItem[]) => {
        setDigitalCampaigns(data);
        // Reset selection if current campaign no longer exists
        if (digitalSelectedCampaign && !data.some(c => c.id === digitalSelectedCampaign)) {
          setDigitalSelectedCampaign('');
        }
      })
      .catch(() => {});
  }, [analyseOpen.digital]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cluster overlay state
  const [clusterModels, setClusterModels] = useState<ClusterModelSummary[]>([]);
  const [selectedClusterVersion, setSelectedClusterVersion] = useState<number | null>(null);
  const [showNewClustering, setShowNewClustering] = useState(false);

  useEffect(() => {
    if (!analyseOpen.clustering) return;
    fetch('/api/poi-clusters/models')
      .then(r => r.json())
      .then(d => { if (d.models) setClusterModels(d.models); })
      .catch(() => {});
  }, [analyseOpen.clustering]);

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
    if (!hex.startsWith('#') || hex.length < 7) return '240,240,240';
    return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`;
  };

  const pill = (active: boolean, color: string) => ({
    fontFamily: fInter, fontSize: 11, padding: '5px 9px',
    background: active ? `rgba(${hexToRgb(color)},0.12)` : C.bgInput,
    border: `0.5px solid ${active ? color : C.border}`, borderRadius: 4,
    color: active ? color : C.textDim, cursor: 'pointer', transition: 'all 0.2s ease', flexShrink: 0 as const,
  });

  const primaryBtn = (color: string, disabled = false) => ({
    fontFamily: fInter, fontSize: 12,
    padding: '9px 14px', width: '100%',
    background: disabled ? 'rgba(255,255,255,0.03)' : `rgba(${hexToRgb(color)},0.10)`,
    border: `0.5px solid ${disabled ? C.border : color}`, borderRadius: 4,
    color: disabled ? C.textDim : color, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1, transition: 'all 0.2s ease',
  });

  const labelStyle = {
    fontFamily: fInter, fontSize: 11, fontWeight: 500 as const,
    color: C.textSec, marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    fontFamily: fInter, fontSize: 13, background: C.bgInput,
    border: `0.5px solid ${C.border}`, borderRadius: 4,
    color: C.text, padding: '7px 10px', outline: 'none', width: '100%',
    transition: 'border-color 0.3s ease',
  };

  const inputFocusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = C.border; },
  };

  // ── Tab config ────────────────────────────────────────────────────────────
  const EXPERT_BADGE = (hasTerritoire ? 1 : 0) + (selectedPOI.length > 0 ? 1 : 0) + (selectedOOH.length > 0 ? 1 : 0) + (clusterGeoJSON ? 1 : 0);
  const EXPERT_SUBTABS: { id: ExpertSubTab; label: string; badge?: number }[] = [
    { id: 'territoire', label: 'Territoire', badge: hasTerritoire ? 1 : 0 },
    { id: 'poi',        label: 'POI',        badge: selectedPOI.length + selectedOOH.length },
    { id: 'analyse',    label: 'Analyse',    badge: clusterGeoJSON ? 1 : 0 },
  ];

  return (
    <div style={{
      width: panelWidth, minWidth: 260, height: '100%',
      background: C.bgPanel, borderRight: `0.5px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      position: 'relative', flexShrink: 0,
    }}>
      {/* ── Resize handle with dots indicator ── */}
      <div
        onMouseDown={onResizeMouseDown}
        onDoubleClick={() => setPanelWidth(prev => prev > 400 ? 320 : 560)}
        style={{
          position: 'absolute', top: 0, right: 0, width: 8, height: '100%',
          cursor: 'col-resize', zIndex: 50, background: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.15s',
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


      {/* ── Error / loading bar ───────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '6px 14px', background: 'rgba(248,113,113,0.07)', borderBottom: `1px solid rgba(248,113,113,0.2)`, fontFamily: fMono, fontSize: 10, color: C.red, flexShrink: 0, animation: 'fpErrorIn 0.2s ease-out' }}>
          ! {error}
        </div>
      )}
      {(isLoading || battleLoading) && (
        <div style={{ height: 2, flexShrink: 0, background: C.border, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: '40%',
            background: battleLoading ? C.red : C.green,
            animation: 'fpSlide 1.2s ease-in-out infinite',
          }} />
        </div>
      )}

      {/* ── Bouton HOME ───────────────────────────────────────────────────── */}
      <a href="/dashboard" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 14px', flexShrink: 0,
        background: 'none', borderBottom: `0.5px solid ${C.border}`,
        color: C.textDim, textDecoration: 'none',
        fontFamily: fInter, fontSize: 12,
        transition: 'all 0.2s ease',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = C.text; (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-level-2)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = C.textDim; (e.currentTarget as HTMLAnchorElement).style.background = 'none'; }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        Home
      </a>

      {/* ── Tab navigation (2 onglets maîtres) ──────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0, background: C.bgPanel, position: 'relative' }}>
        {/* GEO.PROMPT */}
        {(() => {
          const active = activeTab === 'geoprompt';
          return (
            <button onClick={() => setActiveTab('geoprompt')} className="fp-tab" style={{
              flex: 1, padding: '12px 6px 10px', position: 'relative',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer', transition: 'color 0.2s ease',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <div style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: active ? 'var(--text-primary)' : C.textDim, transition: 'color 0.2s ease' }}>
                Geo.Prompt
              </div>
              {/* Sliding underline */}
              <span style={{
                position: 'absolute', bottom: 0, left: '50%',
                width: active ? '100%' : '0%',
                height: 2, background: 'var(--brand-teal)',
                transform: 'translateX(-50%)',
                transition: 'width 0.25s ease',
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
              cursor: 'pointer', transition: 'color 0.2s ease',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <div style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: active ? 'var(--text-primary)' : C.textDim, transition: 'color 0.2s ease' }}>
                Expert
              </div>
              {EXPERT_BADGE > 0 && (
                <div style={{ position: 'absolute', top: 7, right: 10, width: 5, height: 5, borderRadius: '50%', background: 'var(--brand-teal)', transition: 'opacity 0.2s ease' }} />
              )}
              <span style={{
                position: 'absolute', bottom: 0, left: '50%',
                width: active ? '100%' : '0%',
                height: 2, background: 'var(--brand-teal)',
                transform: 'translateX(-50%)',
                transition: 'width 0.25s ease',
              }} />
            </button>
          );
        })()}
      </div>

      {/* ── Sous-onglets EXPERT ───────────────────────────────────────────── */}
      {activeTab === 'expert' && (
        <div style={{ display: 'flex', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0, background: C.bgPanel }}>
          {EXPERT_SUBTABS.map(sub => {
            const active = activeExpertTab === sub.id;
            return (
              <button key={sub.id} onClick={() => setActiveExpertTab(sub.id)} className="fp-tab" style={{
                flex: 1, padding: '9px 4px 7px', position: 'relative',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer', transition: 'color 0.2s ease',
              }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)'; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <div style={{ fontFamily: fInter, fontSize: 12, fontWeight: active ? 500 : 400, color: active ? 'var(--text-primary)' : C.textDim, transition: 'color 0.2s ease' }}>
                  {sub.label}
                </div>
                {(sub.badge ?? 0) > 0 && (
                  <div style={{ position: 'absolute', top: 5, right: 8, width: 4, height: 4, borderRadius: '50%', background: 'var(--brand-teal)' }} />
                )}
                <span style={{
                  position: 'absolute', bottom: 0, left: '50%',
                  width: active ? '100%' : '0%',
                  height: 1.5, background: 'var(--brand-teal)',
                  transform: 'translateX(-50%)',
                  transition: 'width 0.25s ease',
                }} />
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
        {/* ── Search + Quick actions (Expert tab only) ── */}
        {activeTab === 'expert' && (
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
                  fontFamily: fInter, outline: 'none', transition: 'border-color 0.15s',
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
                transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = 'var(--bg-level-2)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'none'; }}
              >
                Tout réduire
              </button>
              <button onClick={expandAll} style={{
                background: 'none', border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '3px 8px',
                fontSize: 10, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: fInter,
                transition: 'all 0.15s',
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
        {activeTab === 'expert' && (
        <div className="filter-panel-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ════════════════════════════════════════
            ONGLET 2 — TERRITOIRE
        ════════════════════════════════════════ */}
        {activeExpertTab === 'territoire' && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Scope global */}
            {(!filterSearch || 'périmètre global'.includes(filterSearch.toLowerCase())) && (
            <div>
              <FilterSectionHeader label="Périmètre global" sectionKey="perimetre" open={sectionsOpen.perimetre !== false} onToggle={() => toggleSection('perimetre')} count={scope ? 1 : 0} searchTerm={filterSearch} />
              {sectionsOpen.perimetre !== false && (
              <div style={{ marginBottom: 12, transition: 'opacity 0.15s', animation: 'fadeIn 0.15s ease-out' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ ...pill(scope === 'metro', C.green), flex: 1, textAlign: 'center' }} onClick={() => selectScope('metro')}>
                  France Metro
                </button>
                <button style={{ ...pill(scope === 'all', C.green), flex: 1, textAlign: 'center' }} onClick={() => selectScope('all')}>
                  France + DROM
                </button>
              </div>
              </div>
              )}
            </div>
            )}

            {/* Régions */}
            {(!filterSearch || 'région régions'.includes(filterSearch.toLowerCase())) && (
            <div>
              <FilterSectionHeader label="Régions" sectionKey="regions" open={sectionsOpen.regions !== false} onToggle={() => toggleSection('regions')} count={selectedRegions.length} searchTerm={filterSearch} />
              {sectionsOpen.regions !== false && (
              <div style={{ marginBottom: 12, animation: 'fadeIn 0.15s ease-out' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <button
                  onClick={() => {
                    const allIds = REGIONS.map(r => r.id);
                    const allSelected = selectedRegions.length === REGIONS.length;
                    setSelectedRegions(allSelected ? [] : allIds);
                    setScope(null);
                  }}
                  style={{ fontFamily: fInter, fontSize: 11, color: selectedRegions.length === REGIONS.length ? C.red : C.textSec, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {selectedRegions.length === REGIONS.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                </button>
              </div>
              <MultiDropdown
                label="Toutes les régions"
                items={REGIONS.map(r => ({ id: r.id, label: r.nom }))}
                selected={selectedRegions}
                onChange={ids => { setSelectedRegions(ids); if (ids.length > 0) setScope(null); }}
              />
              </div>
              )}
            </div>
            )}

            {/* Départements */}
            {(!filterSearch || 'département départements'.includes(filterSearch.toLowerCase())) && (
            <div>
              <FilterSectionHeader label="Départements" sectionKey="departements" open={sectionsOpen.departements !== false} onToggle={() => toggleSection('departements')} count={selectedDepts.length} searchTerm={filterSearch} />
              {sectionsOpen.departements !== false && (
              <div style={{ marginBottom: 12, animation: 'fadeIn 0.15s ease-out' }}>
              <MultiDropdown
                label="Tous les départements"
                items={availableDepts.map(d => ({ id: d.code, label: `${d.code} — ${d.nom}` }))}
                selected={selectedDepts}
                onChange={ids => { setSelectedDepts(ids); if (ids.length > 0) setScope(null); }}
                searchable
              />
              {selectedRegions.length === 0 && (
                <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, marginTop: 4, fontStyle: 'italic' }}>
                  Filtrer d&apos;abord par région
                </div>
              )}
              </div>
              )}
            </div>
            )}

            {/* Recherche locale */}
            {(!filterSearch || 'recherche locale ville'.includes(filterSearch.toLowerCase())) && (
            <div>
              <FilterSectionHeader label="Recherche locale" sectionKey="recherche" open={sectionsOpen.recherche !== false} onToggle={() => toggleSection('recherche')} count={(ville ? 1 : 0) + (codePostal ? 1 : 0)} searchTerm={filterSearch} />
              {sectionsOpen.recherche !== false && (
              <div style={{ marginBottom: 12, animation: 'fadeIn 0.15s ease-out' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>Ville</div>
                  <input style={inputStyle} placeholder="ex: Brest" value={ville}
                    onChange={e => { setVille(e.target.value); if (e.target.value) setScope(null); }} {...inputFocusHandlers} />
                </div>
                <div style={{ width: 80 }}>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>Code postal</div>
                  <input style={inputStyle} placeholder="29200" value={codePostal}
                    onChange={e => setCodePostal(e.target.value)} maxLength={5} {...inputFocusHandlers} />
                </div>
              </div>
              </div>
              )}
            </div>
            )}

            {/* Territoire summary */}
            {hasTerritoire && (
              <div style={{ padding: '10px 12px', background: C.greenDim, border: `0.5px solid rgba(61,255,160,0.2)`, borderRadius: 4 }}>
                <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.green, marginBottom: 4 }}>
                  Territoire sélectionné
                </div>
                <div style={{ fontFamily: fInter, fontSize: 13, color: C.text, lineHeight: 1.4 }}>{territoire}</div>
                <button
                  onClick={() => { setScope(null); setSelectedRegions([]); setSelectedDepts([]); setVille(''); setCodePostal(''); }}
                  style={{ marginTop: 8, fontFamily: fInter, fontSize: 11, color: C.textDim, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  ✕ Réinitialiser
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
              <FilterSectionHeader label="Points d'intérêt (POI)" sectionKey="poi" open={sectionsOpen.poi !== false} onToggle={() => toggleSection('poi')} count={selectedPOI.length} tooltipKey="poi" searchTerm={filterSearch} />
              {sectionsOpen.poi !== false && (
              <div style={{ animation: 'fadeIn 0.15s ease-out' }}>
            <div>
              <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  Types de POI
                  {selectedPOI.length > 0 && <span style={{ color: C.textSec }}> — {selectedPOI.length} sélectionné{selectedPOI.length > 1 ? 's' : ''}</span>}
                  {!catsLoading && poiTypes.length > 0 && <span style={{ color: C.textDim }}> ({poiTypes.length})</span>}
                </span>
                <button
                  onClick={() => fetchCategories(true)}
                  title="Rafraîchir la liste"
                  style={{ background: 'none', border: 'none', color: catsLoading ? C.muted : C.textDim, cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1 }}
                >{catsLoading ? '…' : '↻'}</button>
              </div>
              {catsError && (
                <div style={{ fontFamily: fMono, fontSize: 10, color: C.red, marginBottom: 4 }}>
                  ! Erreur chargement catégories : {catsError} — <button onClick={() => fetchCategories(true)} style={{ background: 'none', border: 'none', color: C.amber, cursor: 'pointer', fontSize: 10, fontFamily: fMono, padding: 0 }}>réessayer</button>
                </div>
              )}
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
                      fontFamily: fInter, fontSize: 13,
                      background: C.bgInput,
                      border: `0.5px solid ${C.border}`, borderRadius: 4,
                      color: C.text, padding: '4px 22px 4px 8px',
                      outline: 'none', cursor: 'pointer', flex: 1, width: '100%',
                      appearance: 'none' as const,
                    };
                    const selectWrap: React.CSSProperties = {
                      position: 'relative', flex: 1, display: 'flex', alignItems: 'center',
                    };
                    const selectArrow: React.CSSProperties = {
                      position: 'absolute', right: 7, pointerEvents: 'none',
                      fontFamily: fInter, fontSize: 9, color: C.textDim, lineHeight: 1,
                    };
                    return (
                      <div key={poi} style={{
                        background: 'rgba(255,255,255,0.02)',
                        border: `0.5px solid ${C.border}`,
                        borderRadius: 4, padding: '8px 10px',
                        display: 'flex', flexDirection: 'column', gap: 7,
                      }}>
                        {/* Header : nom + bouton X */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: C.text }}>
                            {poi}
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
                          <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, whiteSpace: 'nowrap', width: 50 }}>
                            Épingle
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
                          <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, whiteSpace: 'nowrap', width: 50 }}>
                            Couleur
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
                            <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                              Nature
                              {(selectedPoiNatures[poi]?.length ?? 0) > 0 && (
                                <span style={{ color: C.textSec }}>
                                  {' '}— {selectedPoiNatures[poi].length} sélectionnée{selectedPoiNatures[poi].length > 1 ? 's' : ''}
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
                    background: densityMode ? 'rgba(255,255,255,0.08)' : C.bgInput,
                    border: `0.5px solid ${densityMode ? 'var(--text-primary)' : C.border}`,
                    borderRadius: 4, cursor: 'pointer',
                    fontFamily: fInter, fontSize: 12,
                    color: densityMode ? 'var(--text-primary)' : C.textDim,
                    whiteSpace: 'nowrap', transition: 'all 0.2s ease',
                  }}
                >
                  {densityMode ? '◉ Densité' : '◎ Densité'}
                </button>
              </div>
            )}

            </div>
            )}{/* fin collapsible POI content */}
            </div>{/* fin section POI */}

            {/* ── Section : Panneaux OOH & DOOH ───────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <FilterSectionHeader label="Panneaux OOH et DOOH" sectionKey="ooh" open={sectionsOpen.ooh !== false} onToggle={() => toggleSection('ooh')} count={selectedOOH.length} searchTerm={filterSearch} />
              {sectionsOpen.ooh !== false && (
              <div style={{ animation: 'fadeIn 0.15s ease-out' }}>

              {/* Info stock */}
              <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
                <span style={{ color: C.textSec }}>1 434</span> panneaux · Brest Métropole
                <span style={{ color: C.textDim }}> · DECAUX, Clear Channel…</span>
              </div>

              {/* Filtre par régie (optionnel) */}
              <div>
                <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    Filtrer par régie (optionnel)
                    {selectedOOH.length > 0 && <span style={{ color: C.textSec }}> — {selectedOOH.length} sélectionnée{selectedOOH.length > 1 ? 's' : ''}</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button
                      title="Tout sélectionner"
                      onClick={() => setSelectedOOH(OOH_REGIES.map(r => r.id))}
                      style={{ background: 'none', border: `0.5px solid ${C.border}`, color: C.textDim, cursor: 'pointer', fontSize: 11, padding: '1px 6px', fontFamily: fInter }}
                    >Tout</button>
                    <button
                      title="Tout désélectionner"
                      onClick={() => setSelectedOOH([])}
                      style={{ background: 'none', border: `0.5px solid ${C.border}`, color: C.textDim, cursor: 'pointer', fontSize: 10, padding: '1px 5px', lineHeight: 1 }}
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
                  : 'Afficher tous les panneaux'}
              </button>
              </div>
              )}{/* fin collapsible OOH */}
            </div>

            {/* ── Section : Arrêts de transport en commun ─────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <FilterSectionHeader label="Arrêts de transport en commun" sectionKey="transport" open={sectionsOpen.transport !== false} onToggle={() => toggleSection('transport')} count={selectedTransportTypes.length} searchTerm={filterSearch} />
              {sectionsOpen.transport !== false && (
              <div style={{ animation: 'fadeIn 0.15s ease-out' }}>

              {/* Sélection du type */}
              <div>
                <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    Type de transport
                    {selectedTransportTypes.length > 0 && (
                      <span style={{ color: C.textSec }}> — {selectedTransportTypes.join(', ')}</span>
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
                      style={pill(selectedTransportTypes.includes(t.id), C.textSec)}
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
                {transportLoading ? 'Chargement...' : 'Afficher arrêts'}
              </button>
              </div>
              )}{/* fin collapsible transport */}
            </div>

            {/* ── Section : Flux routier TMJA ──────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <FilterSectionHeader label="Flux routier (TMJA)" sectionKey="tmja" open={sectionsOpen.tmja !== false} onToggle={() => toggleSection('tmja')} count={tmjaVisible ? 1 : 0} tooltipKey="tmja" searchTerm={filterSearch} />
              {sectionsOpen.tmja !== false && (
              <div style={{ animation: 'fadeIn 0.15s ease-out' }}>

              {/* Légende couleurs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 2 }}>
                  Légende — trafic moyen journalier
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
                  {tmjaLoading ? 'CHARGEMENT…' : tmjaVisible ? '↻ Actualiser' : 'Afficher TMJA'}
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
              )}{/* fin collapsible TMJA */}
            </div>

            {/* ── Section : Radio FM/DAB+ ──────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ background: 'var(--bg-level-2)', borderTop: '1px solid var(--border-subtle)', padding: '10px 14px', margin: '0 -16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
                <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: 'var(--text-primary)', flex: 1 }}>Radio FM/DAB+</span>
                {radioCount !== undefined && radioCount > 0 && (
                  <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--brand-teal)', background: 'rgba(78,205,196,0.1)', border: '0.5px solid rgba(78,205,196,0.2)', borderRadius: 4, padding: '1px 6px' }}>
                    {radioCount.toLocaleString('fr-FR')}
                  </span>
                )}
                {radioLoading && <span style={{ fontSize: 9, color: C.textDim, fontFamily: fMono }}>chargement...</span>}
              </div>

              {/* Selected radio banner */}
              {radioSelectedNom && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(78,205,196,0.08)', border: '0.5px solid rgba(78,205,196,0.2)',
                  borderRadius: 6, padding: '6px 10px', fontSize: 11,
                }}>
                  <span style={{ color: 'var(--brand-teal)', flex: 1, fontWeight: 500, fontFamily: fInter }}>
                    📻 {radioSelectedNom}
                  </span>
                  <button onClick={onClearRadioSelection} style={{
                    background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
                    fontSize: 14, padding: 0, lineHeight: 1, transition: 'color 0.15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                  >×</button>
                </div>
              )}

              {/* Main toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={onToggleRadio}
                  style={{
                    flex: 1, padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                    fontFamily: fInter, cursor: 'pointer', transition: 'all 0.15s',
                    background: radioVisible ? 'rgba(78,205,196,0.1)' : 'transparent',
                    border: `0.5px solid ${radioVisible ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                    color: radioVisible ? 'var(--brand-teal)' : C.textSec,
                  }}
                >
                  {radioVisible ? '📻 Émetteurs visibles' : '📻 Afficher les émetteurs'}
                </button>
              </div>

              {/* Sub-layer toggles + filters + visual controls */}
              {radioVisible && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Radio search */}
                  <div>
                    <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>Rechercher une radio</div>
                    <RadioSearchInput onSelect={(id, nom) => onSelectRadio?.(id, nom)} />
                  </div>

                  {/* Multi-radio filter */}
                  {radioFilterOptions && radioFilterOptions.radios.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>Filtrer par radios</div>
                      <MultiDropdown
                        label="Selectionner des radios..."
                        items={radioFilterOptions.radios.map(r => ({ id: r.id, label: `${r.nom}${r.cat ? ` (${r.cat})` : ''}` }))}
                        selected={radioFilterIds ?? []}
                        onChange={ids => onRadioFilterIdsChange?.(ids)}
                        searchable
                      />
                    </div>
                  )}

                  {/* Exclude categories */}
                  <div>
                    <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>Exclure des categories</div>
                    <MultiDropdown
                      label="Aucune exclusion"
                      items={[
                        { id: 'D,E,P', label: 'Toutes nationales (D/E/P)' },
                        { id: 'D', label: 'D — Thematiques nationales' },
                        { id: 'E', label: 'E — Generalistes nationales' },
                        { id: 'P', label: 'P — Service public' },
                        { id: 'A', label: 'A — Associatives' },
                        { id: 'B', label: 'B — Locales commerciales' },
                        { id: 'C', label: 'C — Franchises locales' },
                      ]}
                      selected={radioExcludeCategories ?? []}
                      onChange={cats => onRadioExcludeCategoriesChange?.(cats)}
                    />
                  </div>

                  {/* System filter */}
                  <div>
                    <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>Système</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[{ label: 'Tous', value: '' }, { label: 'FM', value: 'FM' }, { label: 'DAB+', value: 'DAB+' }].map(opt => (
                        <button key={opt.value} onClick={() => onRadioSystemeChange?.(opt.value)} style={{
                          flex: 1, padding: '4px 0', borderRadius: 4, fontSize: 10, fontFamily: fInter,
                          background: radioSystemeFilter === opt.value ? 'rgba(78,205,196,0.1)' : 'transparent',
                          border: `0.5px solid ${radioSystemeFilter === opt.value ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                          color: radioSystemeFilter === opt.value ? 'var(--brand-teal)' : C.textDim,
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ borderTop: '0.5px solid var(--border-subtle)', paddingTop: 8 }} />

                  {/* Layer toggles */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: C.textSec }}>
                    <input type="checkbox" checked={radioCoverageMode} onChange={() => onToggleRadioCoverage?.()} style={{ accentColor: 'var(--brand-teal)' }} />
                    Zones de couverture
                  </label>

                  {/* Coverage controls (visible when coverage on) */}
                  {radioCoverageMode && (
                    <div style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 9, color: C.textDim, fontStyle: 'italic', marginBottom: 2 }}>Couverture estimée (approximation)</div>

                      {/* Color picker */}
                      <div>
                        <div style={{ fontSize: 10, color: C.textDim, marginBottom: 3 }}>Couleur</div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {['#4ecdc4', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'].map(c => (
                            <button key={c} onClick={() => onRadioCoverageColorChange?.(c)} style={{
                              width: 16, height: 16, borderRadius: '50%', background: c, border: radioCoverageColor === c ? '2px solid var(--text-primary)' : '1px solid var(--border-hover)',
                              cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
                            }} />
                          ))}
                          <input type="color" value={radioCoverageColor ?? '#4ecdc4'} onChange={e => onRadioCoverageColorChange?.(e.target.value)} style={{ width: 16, height: 16, border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }} />
                        </div>
                      </div>

                      {/* Opacity slider */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textDim, marginBottom: 2 }}>
                          <span>Opacité</span>
                          <span style={{ fontFamily: fMono, color: C.textSec }}>{radioCoverageOpacity}%</span>
                        </div>
                        <input type="range" min={0} max={100} step={5} value={radioCoverageOpacity ?? 15}
                          onChange={e => onRadioCoverageOpacityChange?.(Number(e.target.value))}
                          style={{ width: '100%', accentColor: 'var(--brand-teal)', height: 4, cursor: 'pointer' }} />
                      </div>

                      {/* Border width */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textDim, marginBottom: 2 }}>
                          <span>Contour</span>
                          <span style={{ fontFamily: fMono, color: C.textSec }}>{radioBorderWidth}px</span>
                        </div>
                        <input type="range" min={0} max={5} step={0.5} value={radioBorderWidth ?? 0.5}
                          onChange={e => onRadioBorderWidthChange?.(Number(e.target.value))}
                          style={{ width: '100%', accentColor: 'var(--brand-teal)', height: 4, cursor: 'pointer' }} />
                      </div>
                    </div>
                  )}

                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: C.textSec }}>
                    <input type="checkbox" checked={radioHeatmapMode} onChange={() => onToggleRadioHeatmap?.()} style={{ accentColor: 'var(--brand-teal)' }} />
                    Densité (heatmap)
                  </label>

                  {/* Point size */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textDim, marginBottom: 2 }}>
                      <span>Taille points</span>
                      <span style={{ fontFamily: fMono, color: C.textSec }}>{radioPointSize}px</span>
                    </div>
                    <input type="range" min={2} max={12} step={1} value={radioPointSize ?? 5}
                      onChange={e => onRadioPointSizeChange?.(Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--brand-teal)', height: 4, cursor: 'pointer' }} />
                  </div>

                  <div style={{ borderTop: '0.5px solid var(--border-subtle)', paddingTop: 6 }}>
                    <button onClick={onRecenterFrance} style={{
                      background: 'transparent', border: '0.5px solid var(--border-default)', borderRadius: 6,
                      padding: '5px 12px', fontSize: 10, color: C.textDim, cursor: 'pointer',
                      fontFamily: fInter, transition: 'all 0.15s', width: '100%',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = C.textDim; }}
                    >
                      Recentrer France
                    </button>
                  </div>
                </div>
              )}

              <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, fontStyle: 'italic' }}>
                Source : ANFR data.gouv.fr
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
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'var(--bg-level-2)',
                border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s ease',
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

              {/* Info encart — 0 POI sélectionné */}
              {!hasAnyPOI && (
                <div style={{
                  padding: '14px', borderRadius: 4,
                  background: 'rgba(255,255,255,0.02)',
                  border: `0.5px solid ${C.border}`,
                }}>
                  <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 8 }}>
                    Analyses spatiales disponibles
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { icon: '⬡', label: 'Voronoï géométrique', desc: 'Zones à vol d\'oiseau' },
                      { icon: '◎', label: 'Isochrones routiers',  desc: 'Temps de trajet réel ORS' },
                    ].map(tool => (
                      <div key={tool.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 4, border: `0.5px solid ${C.border}` }}>
                        <span style={{ fontSize: 14, color: C.textDim, flexShrink: 0, fontFamily: fMono }}>{tool.icon}</span>
                        <div>
                          <div style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: C.textSec }}>{tool.label}</div>
                          <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginTop: 1 }}>{tool.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: '9px 11px', background: 'rgba(255,255,255,0.03)', border: `0.5px solid var(--border-default)`, borderRadius: 4 }}>
                    <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textSec, marginBottom: 4 }}>
                      Sélectionnez 1 seul type de POI
                    </div>
                    <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
                      Isolez un réseau (ex: CIRFA) pour débloquer le calcul de zone de chalandise.
                    </div>
                  </div>
                </div>
              )}

              {/* Info encart — plusieurs POI sélectionnés */}
              {selectedPOI.length > 1 && (
                <div style={{ padding: '10px 12px', background: C.redDim, border: `0.5px solid ${C.redBorder}`, borderRadius: 4, marginTop: 4 }}>
                  <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.red, marginBottom: 4 }}>! Trop de types sélectionnés</div>
                  <div style={{ fontFamily: fInter, fontSize: 12, color: '#fca5a5', lineHeight: 1.5 }}>
                    Les analyses spatiales nécessitent exactement 1 type de POI. Retirez {selectedPOI.length - 1} type{selectedPOI.length > 2 ? 's' : ''}.
                  </div>
                </div>
              )}

              {/* Boutons analyses — visibles uniquement si exactement 1 POI */}
              {exactlyOnePOI && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>

                  {/* Mode de transport — visible globalement */}
                  <div>
                    <div style={labelStyle}>Mode de transport</div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {ISO_MODES.map(m => (
                        <button key={m.id} style={{ ...pill(transportMode === m.id, '#f0f0f0'), flex: 1, textAlign: 'center' }} onClick={() => setTransportMode(m.id)}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Voronoï Géométrique ── */}
                  <div style={{ border: `0.5px solid ${showVoronoi ? 'var(--border-default)' : C.border}`, borderRadius: 4, overflow: 'hidden' }}>
                    <button
                      disabled={isLoading}
                      onClick={() => { setShowVoronoi(s => !s); setShowBattle(false); setShowBattleV2(false); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 12px', background: showVoronoi ? 'var(--bg-level-2)' : 'rgba(255,255,255,0.02)',
                        border: 'none', cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: voronoiVisible ? C.text : C.textSec }}>
                        {voronoiVisible ? '✓ ' : ''}Voronoï géométrique
                      </span>
                      <span style={{ color: C.textDim, fontSize: 10 }}>{showVoronoi ? '▲' : '▼'}</span>
                    </button>
                    {showVoronoi && (
                      <div style={{ padding: '12px', background: 'rgba(255,255,255,0.01)', borderTop: `0.5px solid var(--border-subtle)`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontFamily: fInter, fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>
                          Zones au POI le plus proche à vol d'oiseau. Instantané, sans API.
                        </div>
                        <button style={primaryBtn('#f0f0f0', isLoading)} disabled={isLoading} onClick={handleVoronoi}>
                          Lancer le calcul
                        </button>
                        {voronoiVisible && (
                          <button style={pill(false, C.textSec)} onClick={() => setVoronoiVisible(false)}>
                            Masquer le Voronoï
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Bataille V2 — cache only ── */}
                  <div style={{ border: `0.5px solid ${showBattleV2 ? 'var(--border-default)' : C.border}`, borderRadius: 4, overflow: 'hidden' }}>
                    <button
                      disabled={battleV2Loading}
                      onClick={() => { setShowBattleV2(s => !s); setShowBattle(false); setShowVoronoi(false); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 12px', background: showBattleV2 ? 'var(--bg-level-2)' : 'rgba(255,255,255,0.02)',
                        border: 'none', cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: battleVisible ? C.text : C.textSec }}>
                        {battleVisible ? '✓ ' : ''}Bataille V2 (multi-paliers)
                      </span>
                      <span style={{ color: C.textDim, fontSize: 10 }}>{showBattleV2 ? '▲' : '▼'}</span>
                    </button>
                  {showBattleV2 && (
                    <div style={{ padding: '13px', background: 'rgba(255,255,255,0.01)', borderTop: `0.5px solid var(--border-subtle)`, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ fontFamily: fInter, fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>
                        Lit le cache existant — <span style={{ color: C.text }}>aucun appel ORS</span>. Paliers manquants skippés.
                        Lance d'abord les isochrones v1 pour remplir le cache.
                      </div>

                      {/* Sélection des paliers */}
                      <div>
                        <div style={{ ...labelStyle }}>
                          Paliers — {battleV2Paliers.join(', ')} min
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {[10, 20, 30, 40, 50, 60, 90].map(p => (
                            <button
                              key={p}
                              style={pill(battleV2Paliers.includes(p), '#f0f0f0')}
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
                            border: `0.5px solid ${v2CacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.3)' : 'rgba(247,183,49,0.35)'}`,
                            borderRadius: 2, padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 4,
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontFamily: fMono, fontSize: 9, color: '#94a3b8' }}>
                                {v2CacheStatus.total_pois} POIs · {v2CacheStatus.total_combos} isochrones
                              </span>
                              <span style={{ fontFamily: fMono, fontSize: 9, color: v2CacheStatus.missing_combos === 0 ? 'var(--success)' : C.amber, fontWeight: 700 }}>
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
                                background: v2CacheStatus.missing_combos === 0 ? 'var(--success)' : '#22d3ee',
                                transition: 'width 0.4s ease',
                              }} />
                            </div>
                            <div style={{ fontFamily: fMono, fontSize: 8, color: 'var(--text-tertiary)' }}>
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
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                            <span style={{ color: C.amber }}>
                              {v2FillTotal > 0 ? `ORS — ${v2FillCompleted}/${v2FillTotal} POIs` : 'ORS — initialisation...'}
                            </span>
                            <span style={{ color: v2FillPct > 0 ? C.green : C.textDim }}>{v2FillPct}%</span>
                          </div>
                          {/* Barre principale */}
                          <div style={{ height: 4, background: 'var(--bg-level-2)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 2,
                              width: `${v2FillPct}%`,
                              background: v2FillPct === 100 ? C.green : C.amber,
                              transition: 'width 0.4s ease',
                            }} />
                          </div>
                          {/* Sous-stats */}
                          <div style={{ display: 'flex', gap: 10, fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                            {v2FillTotal > 0 && (
                              <>
                                <span style={{ color: C.green }}>↗ {v2FillRings} isochrones reçus</span>
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
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                            <span style={{ color: C.textSec, animation: 'fpBlink 1s ease-in-out infinite' }}>
                              Bataille V2 — PostGIS ST_Difference...
                            </span>
                          </div>
                          {/* Barre indéterminée */}
                          <div style={{ height: 4, background: 'var(--bg-level-2)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                            <div style={{
                              position: 'absolute', height: '100%', width: '40%',
                              background: 'linear-gradient(90deg, transparent, var(--text-secondary), transparent)',
                              animation: 'fpScan 1.8s linear infinite',
                              borderRadius: 2,
                            }} />
                          </div>
                        </div>
                      )}

                      {/* ── Log terminal ── */}
                      {battleV2Log.length > 0 && (
                        <div style={{
                          background: 'var(--bg-primary)', border: `0.5px solid var(--border-default)`,
                          borderRadius: 4, padding: '8px 10px', fontFamily: fMono, fontSize: 10,
                          color: C.textDim, lineHeight: 1.7, maxHeight: 140, overflowY: 'auto',
                          display: 'flex', flexDirection: 'column', gap: 1,
                        }}>
                          {battleV2Log.map((line, i) => (
                            <div key={i} style={{
                              color: line.startsWith('> ✓') ? C.green
                                   : line.startsWith('> ✕') ? C.red
                                   : line.startsWith('> !') ? C.amber
                                   : line.startsWith('> ◆') ? C.textSec
                                   : line.startsWith('> ORS') ? C.amber
                                   : C.textDim,
                            }}>{line}</div>
                          ))}
                          {(battleV2Loading || v2Filling) && <div style={{ color: C.textSec, animation: 'fpBlink 1s ease-in-out infinite' }}>▌</div>}
                        </div>
                      )}

                      {battleVisible && (
                        <button style={pill(false, C.textSec)} onClick={() => { setBattleVisible(false); setBattleV2Log([]); }}>
                          Masquer
                        </button>
                      )}
                    </div>
                  )}
                  </div>

                  {/* ── Isochrones Routiers (ORS) ── */}
                  <div style={{ border: `0.5px solid ${showBattle ? 'var(--border-default)' : C.border}`, borderRadius: 4, overflow: 'hidden' }}>
                    <button
                      disabled={battleLoading}
                      onClick={() => { setShowBattle(s => !s); setShowVoronoi(false); setShowBattleV2(false); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 12px', background: showBattle ? 'var(--bg-level-2)' : 'rgba(255,255,255,0.02)',
                        border: 'none', cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: battleVisible ? C.text : C.textSec }}>
                        {battleVisible ? '✓ ' : ''}Isochrones routiers (ORS)
                      </span>
                      <span style={{ color: C.textDim, fontSize: 10 }}>{showBattle ? '▲' : '▼'}</span>
                    </button>
                    {showBattle && (
                    <div style={{ padding: '13px', background: 'rgba(255,255,255,0.01)', borderTop: `0.5px solid var(--border-subtle)`, display: 'flex', flexDirection: 'column', gap: 13 }}>

                      {/* Durées */}
                      <div>
                        <div style={labelStyle}>
                          Temps de trajet
                          {isoDurations.length > 0 && <span style={{ color: C.textSec }}> — {isoDurations.join(', ')} min</span>}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {ISO_DURATIONS.map(d => (
                            <button key={d} style={pill(isoDurations.includes(d), '#f0f0f0')} onClick={() => toggleDuration(d)}>
                              {d} min
                            </button>
                          ))}
                        </div>
                        <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginTop: 5, fontStyle: 'italic' }}>
                          Anneaux concentriques — calculé via ORS directement, sans IA
                        </div>
                      </div>

                      {/* ── Statut cache ORS ── */}
                      {orsCacheStatus && (
                        <div style={{
                          background: orsCacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.06)' : 'rgba(251,191,36,0.06)',
                          border: `0.5px solid ${orsCacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.3)' : 'rgba(247,183,49,0.35)'}`,
                          borderRadius: 2, padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 4,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: fMono, fontSize: 9, color: '#94a3b8' }}>
                              {orsCacheStatus.total_pois} POIs · {orsCacheStatus.total_combos} isochrones
                            </span>
                            <span style={{ fontFamily: fMono, fontSize: 9, color: orsCacheStatus.missing_combos === 0 ? 'var(--success)' : C.amber, fontWeight: 700 }}>
                              {orsCacheStatus.missing_combos === 0
                                ? '✓ 100% en cache'
                                : `${orsCacheStatus.missing_pois} POI${orsCacheStatus.missing_pois > 1 ? 's' : ''} à calculer`}
                            </span>
                          </div>
                          <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 2,
                              width: `${Math.round((orsCacheStatus.cached_combos / Math.max(orsCacheStatus.total_combos, 1)) * 100)}%`,
                              background: orsCacheStatus.missing_combos === 0 ? 'var(--success)' : C.red,
                              transition: 'width 0.4s ease',
                            }} />
                          </div>
                          <div style={{ fontFamily: fMono, fontSize: 8, color: 'var(--text-tertiary)' }}>
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
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                                <span style={{ color: battleProgress === 100 ? C.green : C.amber }}>
                                  {battleProgress === 100 ? '✓ Terminé' : `ORS — ${battleCompleted}/${battleTotal} POIs`}
                                </span>
                                <span style={{ color: battleProgress > 0 ? C.green : C.textDim }}>{battleProgress}%</span>
                              </div>
                              <div style={{ height: 4, background: 'var(--bg-level-2)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%',
                                  width: `${battleProgress}%`,
                                  background: battleProgress === 100 ? C.green : C.textSec,
                                  transition: 'width 0.4s ease',
                                  borderRadius: 2,
                                }} />
                              </div>
                            </div>
                          )}
                          {/* ── Log terminal ── */}
                          <div style={{
                            background: 'var(--bg-primary)', border: `0.5px solid var(--border-default)`,
                            borderRadius: 4, padding: '8px 10px', fontFamily: fMono, fontSize: 10,
                            color: C.textDim, lineHeight: 1.7, maxHeight: 120, overflowY: 'auto',
                            display: 'flex', flexDirection: 'column', gap: 1,
                          }}>
                            {battleLog.map((line, i) => (
                              <div key={i} style={{
                                color: line.startsWith('> ✓') ? C.green
                                     : line.startsWith('> ✕') ? C.red
                                     : line.startsWith('> !') ? C.amber
                                     : line.includes('[3/3]') ? C.green
                                     : C.textDim,
                              }}>{line}</div>
                            ))}
                            {battleLoading && (
                              <div style={{ color: C.textDim, animation: 'fpBlink 1s ease-in-out infinite' }}>▌</div>
                            )}
                          </div>
                        </div>
                      )}

                      {battleVisible && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={pill(false, C.textSec)} onClick={() => { setBattleVisible(false); setBattleLog([]); }}>
                            Masquer les isochrones
                          </button>
                          <button
                            style={pill(battleOuterFillVisible, C.textSec)}
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
                          style={{ ...pill(false, C.textSec), opacity: battleApplyLoading ? 0.5 : 1 }}
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
                          <div style={{ height: 3, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${battleApplyPct}%`,
                              background: battleApplyPct === 100 ? C.green : C.textSec,
                              transition: 'width 0.4s ease, background 0.2s ease',
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
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'var(--bg-level-2)',
                border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s ease',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
                Clustering
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.clustering ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.clustering && (
            <div style={{ borderBottom: `0.5px solid ${C.border}` }}>
              {!showNewClustering ? (
                <div style={{ padding: '10px 12px' }}>
                  {/* Existing models list */}
                  {clusterModels.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      {clusterModels.map((m) => {
                        const silColor = m.silhouette_score >= 0.5 ? 'var(--success)' : m.silhouette_score >= 0.3 ? 'var(--warning)' : 'var(--danger)';
                        const dateStr = new Date(m.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
                        return (
                          <div
                            key={m.version}
                            onClick={() => setSelectedClusterVersion(m.version)}
                            style={{
                              background: 'var(--bg-level-2)',
                              border: '0.5px solid var(--border-subtle)',
                              borderRadius: 6,
                              padding: '10px 12px',
                              marginBottom: 6,
                              cursor: 'pointer',
                              transition: 'border-color 0.2s ease',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--brand-teal-30)')}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                              <span style={{ fontFamily: fMono, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                                v{m.version}
                              </span>
                              <span style={{ fontFamily: fMono, fontSize: 9, color: silColor, border: `1px solid ${silColor}40`, borderRadius: 2, padding: '1px 4px' }}>
                                SIL {m.silhouette_score.toFixed(3)}
                              </span>
                              <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                                {dateStr}
                              </span>
                            </div>
                            <div style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-secondary)' }}>
                              {m.k} clusters · {m.n_poi_trained} POI · {m.duration_minutes}min {m.mode}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {clusterModels.length === 0 && (
                    <div style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)', padding: '12px 0', textAlign: 'center' }}>
                      Aucun modèle calculé
                    </div>
                  )}
                  {/* New clustering button */}
                  <button
                    onClick={() => setShowNewClustering(true)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: '0.5px solid var(--brand-teal)',
                      color: 'var(--brand-teal)',
                      borderRadius: 6,
                      padding: '8px 16px',
                      fontFamily: fInter,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'background 0.2s ease',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(78,205,196,0.1)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    + Nouveau clustering
                  </button>
                </div>
              ) : (
                <div>
                  <button
                    onClick={() => setShowNewClustering(false)}
                    style={{
                      display: 'block', width: '100%',
                      background: 'none', border: 'none',
                      borderBottom: '0.5px solid var(--border-subtle)',
                      padding: '8px 12px', cursor: 'pointer',
                      fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)',
                      textAlign: 'left',
                    }}
                  >
                    ← Liste des modèles
                  </button>
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
            </div>
            )}

            {/* ── Accordéon : CARREAUX ────────────────────────────────────── */}
            <button
              onClick={() => toggleAnalyse('carreaux')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'var(--bg-level-2)',
                border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s ease',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
                Carreaux
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.carreaux ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.carreaux && (
            <div style={{ padding: '16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Toggle visible */}
              <button
                onClick={() => setCarreauxVisible?.(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  background: carreauxVisible ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `0.5px solid ${carreauxVisible ? 'var(--border-default)' : C.border}`,
                  borderRadius: 4, cursor: 'pointer', width: '100%',
                }}
              >
                <span style={{ width: 11, height: 11, background: carreauxVisible ? 'var(--text-primary)' : 'transparent', border: `0.5px solid ${carreauxVisible ? 'var(--text-primary)' : 'var(--border-default)'}`, borderRadius: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {carreauxVisible && <span style={{ fontSize: 7, color: 'var(--bg-primary)', fontWeight: 700 }}>✓</span>}
                </span>
                <span style={{ fontFamily: fInter, fontSize: 13, color: carreauxVisible ? C.text : C.textDim }}>
                  Carreaux{carreauxLoaded ? ' ✓' : ''}
                </span>
              </button>

              {/* Indicateur */}
              <select
                value={carreauxIndicateur ?? 'population_totale'}
                onChange={e => setCarreauxIndicateur?.(e.target.value)}
                style={{ width: '100%', background: C.bgInput, border: `0.5px solid ${C.border}`, borderRadius: 4, color: C.text, fontSize: 13, fontFamily: fInter, padding: '6px 8px', cursor: 'pointer', outline: 'none' }}
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
                <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 5 }}>Palette</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {CARREAUX_PALETTES.map(p => (
                    <button key={p.id} onClick={() => setCarreauxPalette?.(p.id)} title={p.label}
                      style={{ border: `1.5px solid ${carreauxPalette === p.id ? 'var(--text-primary)' : 'transparent'}`, borderRadius: 3, padding: 0, cursor: 'pointer', background: 'none', display: 'flex', overflow: 'hidden', width: 28, height: 12 }}
                    >
                      {p.stops.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Opacité */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, whiteSpace: 'nowrap' }}>Opacité</span>
                <input type="range" min={0.1} max={1} step={0.05}
                  value={carreauxOpacity ?? 0.72}
                  onChange={e => setCarreauxOpacity?.(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--text-primary)', cursor: 'pointer', height: 4 }}
                />
                <span style={{ color: C.textDim, fontSize: 11, fontFamily: fMono, minWidth: 26, textAlign: 'right' }}>
                  {Math.round((carreauxOpacity ?? 0.72) * 100)}%
                </span>
              </div>

              {/* Légende */}
              <div>
                <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  Légende
                  {carreauxSelectedBucket !== null && (
                    <button onClick={() => setCarreauxSelectedBucket?.(null)}
                      style={{ background: 'none', border: 'none', color: C.textSec, cursor: 'pointer', fontSize: 11, fontFamily: fInter, padding: 0 }}
                    >✕ Tout</button>
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
                              style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', background: isSelected ? color + '22' : 'none', border: `0.5px solid ${isSelected ? color : 'transparent'}`, borderRadius: 2, padding: '1px 3px', cursor: 'pointer' }}
                            >
                              <span style={{ width: 14, height: 8, background: color, borderRadius: 1, flexShrink: 0 }} />
                              <span style={{ color: isSelected ? C.text : C.textDim, fontSize: 10, fontFamily: fMono, flex: 1 }}>
                                {i === 5 ? `≥ ${fmt(min)}` : `${fmt(min)} – ${fmt(max)}`}
                              </span>
                              {isSelected && <span style={{ color, fontSize: 8, fontFamily: fMono }}>●</span>}
                            </button>
                          );
                        })}
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      {pal.stops.map((c, i) => <span key={i} style={{ display: 'inline-block', flex: 1, height: 7, background: c, borderRadius: 1 }} />)}
                      <span style={{ color: C.textDim, fontSize: 9, marginLeft: 4, fontFamily: fMono }}>z≥10</span>
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
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'var(--bg-level-2)',
                border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s ease',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
                IRIS
                {irisVisible && <span style={{ color: C.green, marginLeft: 6 }}>●</span>}
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.iris ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.iris && (
            <div style={{ padding: '16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Toggle visible */}
              <button
                onClick={() => setIrisVisible?.(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  background: irisVisible ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `0.5px solid ${irisVisible ? 'var(--border-default)' : C.border}`,
                  borderRadius: 4, cursor: 'pointer', width: '100%',
                }}
              >
                <span style={{ width: 11, height: 11, background: irisVisible ? 'var(--text-primary)' : 'transparent', border: `0.5px solid ${irisVisible ? 'var(--text-primary)' : 'var(--border-default)'}`, borderRadius: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {irisVisible && <span style={{ fontSize: 7, color: 'var(--bg-primary)', fontWeight: 700 }}>✓</span>}
                </span>
                <span style={{ fontFamily: fInter, fontSize: 13, color: irisVisible ? C.text : C.textDim }}>
                  Couche IRIS
                </span>
              </button>

              {/* Toggle vrais IRIS uniquement */}
              <button
                onClick={() => setIrisTrueOnly?.(!irisTrueOnly)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  background: 'rgba(255,255,255,0.02)',
                  border: `0.5px solid ${C.border}`,
                  borderRadius: 4, cursor: 'pointer', width: '100%',
                }}
              >
                <span style={{ width: 11, height: 11, background: irisTrueOnly ? 'var(--text-primary)' : 'transparent', border: `0.5px solid ${irisTrueOnly ? 'var(--text-primary)' : 'var(--border-default)'}`, borderRadius: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {irisTrueOnly && <span style={{ fontSize: 7, color: 'var(--bg-primary)', fontWeight: 700 }}>✓</span>}
                </span>
                <span style={{ fontFamily: fInter, fontSize: 12, color: C.textSec, flex: 1, textAlign: 'left' }}>
                  Vrais IRIS uniquement
                </span>
                <span style={{ fontFamily: fInter, fontSize: 10, color: C.textDim }}>
                  {irisTrueOnly ? '16 k quartiers' : '49 k (+ communes)'}
                </span>
              </button>

              {/* Indicateur — généré depuis IRIS_DB_COLUMNS */}
              <select
                value={irisIndicateur ?? 'pop_15_29'}
                onChange={e => setIrisIndicateur?.(e.target.value)}
                style={{ width: '100%', background: C.bgInput, border: `0.5px solid ${C.border}`, borderRadius: 4, color: C.text, fontSize: 13, fontFamily: fInter, padding: '6px 8px', cursor: 'pointer', outline: 'none' }}
              >
                {Array.from(
                  IRIS_DB_COLUMNS.filter(c => c.type !== 'boolean').reduce((acc, col) => {
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
                <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 5 }}>Palette</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {IRIS_PALETTES.map(p => (
                    <button key={p.id} onClick={() => setIrisPalette?.(p.id)} title={p.label}
                      style={{ border: `1.5px solid ${irisPalette === p.id ? 'var(--text-primary)' : 'transparent'}`, borderRadius: 3, padding: 0, cursor: 'pointer', background: 'none', display: 'flex', overflow: 'hidden', width: 28, height: 12 }}
                    >
                      {p.stops.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Opacité */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, whiteSpace: 'nowrap' }}>Opacité</span>
                <input type="range" min={0.1} max={1} step={0.05}
                  value={irisOpacity ?? 0.45}
                  onChange={e => setIrisOpacity?.(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--text-primary)', cursor: 'pointer', height: 4 }}
                />
                <span style={{ color: C.textDim, fontSize: 11, fontFamily: fMono, minWidth: 26, textAlign: 'right' }}>
                  {Math.round((irisOpacity ?? 0.45) * 100)}%
                </span>
              </div>

              {/* Légende */}
              <div>
                <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 4 }}>Légende</div>
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
                    return <div style={{ color: C.textDim, fontSize: 11, fontFamily: fInter }}>Chargement...</div>;
                  }
                  if (irisStats && !irisStats.col_exists) {
                    return <div style={{ color: C.amber, fontSize: 11, fontFamily: fInter }}>! Colonne non disponible en base</div>;
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
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'var(--bg-level-2)',
                border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s ease',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
                Couverture
                {coverageSummary && coverageSummary.length > 0 && (
                  <span style={{ color: C.green, marginLeft: 6 }}>● {coverageSummary.length}</span>
                )}
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.couverture ? '▲' : '▼'}</span>
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
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'var(--bg-level-2)',
                border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s ease',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
                Corrélation IRIS × POI
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.correlation ? '▲' : '▼'}</span>
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
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'var(--bg-level-2)',
                border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s ease',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
                Scoring OOH
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.scoring ? '▲' : '▼'}</span>
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

            {/* ── Accordéon : DIGITAL ───────────────────────────────── */}
            <button
              onClick={() => toggleAnalyse('digital')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'var(--bg-level-2)',
                border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.2s ease',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
                Digital {digitalVisible && <span style={{ color: C.green }}>●</span>}
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.digital ? '▲' : '▼'}</span>
            </button>
            {analyseOpen.digital && (
            <div style={{ padding: '16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Campaign selector */}
              <div>
                <div style={labelStyle}>Campagne DSP</div>
                <select
                  value={digitalSelectedCampaign}
                  onChange={e => setDigitalSelectedCampaign(e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">Sélectionner une campagne</option>
                  {digitalCampaigns.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.total_tracked_ads?.toLocaleString('fr-FR')} imp.
                    </option>
                  ))}
                </select>
              </div>

              {/* Scale selector */}
              <div>
                <div style={labelStyle}>Échelle</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {([
                    { id: 'cp' as const, label: 'Code postal' },
                    { id: 'departement' as const, label: 'Département' },
                    { id: 'region' as const, label: 'Région' },
                  ]).map(s => (
                    <button
                      key={s.id}
                      onClick={() => onDigitalScaleChange?.(s.id)}
                      style={{
                        flex: 1, padding: '6px 4px', fontSize: 10, fontFamily: fInter,
                        background: digitalScale === s.id ? 'rgba(78,205,196,0.12)' : 'rgba(255,255,255,0.02)',
                        border: `0.5px solid ${digitalScale === s.id ? 'var(--brand-teal)' : C.border}`,
                        borderRadius: 4, cursor: 'pointer',
                        color: digitalScale === s.id ? 'var(--brand-teal)' : C.textSec,
                        transition: 'all 0.2s',
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Palette selector */}
              <div>
                <div style={labelStyle}>Palette</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {DIGITAL_PALETTES.map(p => (
                    <button
                      key={p.id}
                      onClick={() => onDigitalPaletteChange?.(p.id)}
                      title={p.label}
                      style={{
                        width: 28, height: 16, borderRadius: 3, cursor: 'pointer', padding: 0,
                        background: `linear-gradient(to right, ${p.stops.join(', ')})`,
                        border: `1.5px solid ${digitalPalette === p.id ? 'var(--text-primary)' : 'transparent'}`,
                        transition: 'border 0.15s',
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Invert toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11, fontFamily: fInter, color: C.textSec }}>
                <input
                  type="checkbox"
                  checked={digitalInverted ?? false}
                  onChange={e => onDigitalInvertChange?.(e.target.checked)}
                  style={{ accentColor: 'var(--brand-teal)' }}
                />
                Inverser la palette
              </label>

              {/* Show impressions button */}
              <button
                onClick={() => onDigitalShowImpressions?.(digitalSelectedCampaign)}
                disabled={!digitalSelectedCampaign || digitalLoading}
                style={{
                  fontFamily: fInter, fontSize: 12, padding: '10px 14px', width: '100%',
                  background: digitalVisible ? 'rgba(78,205,196,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `0.5px solid ${digitalVisible ? 'var(--brand-teal)' : C.border}`, borderRadius: 6,
                  color: digitalVisible ? 'var(--brand-teal)' : C.text,
                  cursor: !digitalSelectedCampaign ? 'not-allowed' : 'pointer',
                  opacity: !digitalSelectedCampaign ? 0.5 : 1, transition: 'all 0.2s',
                }}
              >
                {digitalLoading ? 'Chargement...' : digitalVisible ? 'Impressions affichées' : 'Afficher les impressions'}
              </button>

              {/* Stats + legend when visible */}
              {digitalVisible && digitalStats && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: 4, border: `0.5px solid ${C.border}` }}>
                  {digitalStats.campaign_name && (
                    <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textSec }}>{digitalStats.campaign_name}</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: fInter }}>
                    <span style={{ color: C.textSec }}>Total impressions</span>
                    <span style={{ fontFamily: fMono, color: 'var(--brand-teal)' }}>{Number(digitalStats.total_impressions).toLocaleString('fr-FR')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: fInter }}>
                    <span style={{ color: C.textSec }}>Codes postaux</span>
                    <span style={{ fontFamily: fMono, color: C.text }}>{Number(digitalStats.zones_count).toLocaleString('fr-FR')}</span>
                  </div>
                  {/* Legend gradient */}
                  <div>
                    <div style={{
                      height: 10, borderRadius: 3,
                      background: `linear-gradient(to right, ${(digitalInverted ? [...(DIGITAL_PALETTES.find(p => p.id === digitalPalette)?.stops ?? DIGITAL_PALETTES[0].stops)].reverse() : (DIGITAL_PALETTES.find(p => p.id === digitalPalette)?.stops ?? DIGITAL_PALETTES[0].stops)).join(', ')})`,
                    }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                      <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>0</span>
                      <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>médiane</span>
                      <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>max</span>
                    </div>
                  </div>
                  <button
                    onClick={() => onDigitalClear?.()}
                    style={{ fontFamily: fInter, fontSize: 10, padding: '5px 8px', background: 'none', border: `0.5px solid ${C.border}`, borderRadius: 3, color: C.textDim, cursor: 'pointer' }}
                  >
                    Masquer
                  </button>
                </div>
              )}
            </div>
            )}

          </div>
        )}

        </div>
        )}

      </div>

      {/* ── Footer actions ────────────────────────────────────────────────── */}
      {activeTab !== 'geoprompt' && (
      <div style={{ borderTop: `0.5px solid ${C.border}`, padding: '10px 14px', display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => setShowSavePanel(true)}
          style={{
            flex: 1, padding: '8px', fontFamily: fInter, fontSize: 13,
            background: 'none', border: `0.5px solid ${C.border}`, borderRadius: 4,
            color: C.textDim, cursor: 'pointer', transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textDim; }}
        >
          Sauvegarder
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
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      {/* Cluster results overlay */}
      {selectedClusterVersion !== null && (
        <ClusterResultsOverlay
          version={selectedClusterVersion}
          onClose={() => setSelectedClusterVersion(null)}
        />
      )}
    </div>
  );
}
