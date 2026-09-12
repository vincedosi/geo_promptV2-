'use client';
import { logger } from '@/lib/logger';

/**
 * @file FilterPanel.tsx — composant central de filtrage MAGELIAN (carte /map)
 *
 * Rendu par /map dans le panneau ouvert par le rail, avec `visibleCategory` qui
 * selectionne un ou plusieurs des blocs de sections (terrain / audience /
 * analyses) — un tableau affiche plusieurs blocs dans le meme panneau (entree
 * « Calques » du rail, cf lib/navigation/config.ts). Le bloc perimetre a
 * demenage dans `PanneauFiltre` (entree « Filtre ») a la Tache 4 (2026-09-12) :
 * `'perimeter'` a disparu de l'union `CategorieFiltre`.
 *
 * Ce fichier n'est plus qu'un ASSEMBLEUR : il cable des hooks d'etat a des
 * composants de section, et ne porte que le squelette de rendu (tabs, barre de
 * recherche, resize, pied de page).
 *
 * @see ./filter-panel/types.ts             — contrat public (props + params d'action)
 * @see ./filter-panel/use-filter-sections  — recherche + sections repliables
 * @see ./filter-panel/use-panel-resize     — largeur redimensionnable
 * @see ./filter-panel/use-civic-ingest     — ingestion pollen + qualite de l'air
 * @see ./filter-panel/use-poi-catalog      — categories et natures POI (dynamiques)
 * @see ./filter-panel/use-territory-selection — perimetre, cascade, libelle
 * @see ./filter-panel/use-admin-scope-layer   — filtre admin → couche + scope
 * @see ./filter-panel/use-territory-mask      — masque hors-territoire MapLibre
 * @see ./filter-panel/use-poi-styles          — style des pins
 * @see ./filter-panel/use-isochrone-battle    — isochrones, cache ORS, bataille V1/V2
 * @see ./filter-panel/                        — composants de section
 *
 * @maintainers Pour etendre ce fichier sans le faire regrossir :
 *   - un nouvel ETAT va dans un hook `./filter-panel/use-*.ts`, pas ici ;
 *   - un nouveau BLOC D'UI va dans un composant `./filter-panel/*.tsx` ;
 *   - lire docs/known_tech_debt.md avant tout refactor structurel.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { CategoryGroup } from '@/components/ui/CategoryGroup';
import { C, fInter, fMono } from './filter-panel/tokens';
import { labelStyle, pill } from './filter-panel/styles';
import { ClusteringSection } from './filter-panel/ClusteringSection';
import { SpatialAnalysisEmptyState, SpatialAnalysisTooManyPoi } from './filter-panel/SpatialAnalysisIntro';
import { VoronoiTool } from './filter-panel/VoronoiTool';
import { BattleV2Tool } from './filter-panel/BattleV2Tool';
import { IsochronesTool } from './filter-panel/IsochronesTool';
// ─── Equity indicator types ──────────────────────────────────────────────────

// ─── Données géographiques ─────────────────────────────────────────────────────
// REGIONS et ALL_DEPTS sont maintenant fetch dynamiquement depuis ref_regions
// / ref_departements via useRefGeo() → les codes envoyés à Supabase sont les
// vrais codes INSEE ('53' Bretagne, '84' ARA, etc.) et non plus des ids
// alphabétiques applicatifs ('bre', 'ara') qui ne matchaient aucune RPC.
import { ISO_MODES } from '@/lib/geo/france-admin';
import { usePanelResize } from './filter-panel/use-panel-resize';
import { useCivicIngest } from './filter-panel/use-civic-ingest';
import { useFilterSections } from './filter-panel/use-filter-sections';
import { usePoiCatalog } from './filter-panel/use-poi-catalog';
import { useTerritorySelection } from './filter-panel/use-territory-selection';
import { useAdminScopeLayer } from './filter-panel/use-admin-scope-layer';
import { useTerritoryMask } from './filter-panel/use-territory-mask';
import { usePoiStyles } from './filter-panel/use-poi-styles';
import { useIsochroneBattle } from './filter-panel/use-isochrone-battle';

type Tab = 'geoprompt' | 'expert';
// ExpertSubTab supprimé — panel unique scrollable (Sprint 1)

// ─── POI Style ────────────────────────────────────────────────────────────────
// Types déplacés dans ./filter-panel/poi-style.ts — réexportés ici pour ne pas
// casser les importateurs existants (map/page.tsx, useMapMarkers, useMapDirectActions).
export type { POIStyle, POIStylesMap } from './filter-panel/poi-style';

// ─── Props ─────────────────────────────────────────────────────────
// Deplaces dans ./filter-panel/types.ts — reexportes ici pour ne pas casser
// les importateurs existants (map/page.tsx, useMapMarkers, useMapDirectActions).
export type {
  DirectPOISearchParams,
  DirectBattleParams,
  DirectBattleV2Params,
  FillIsochroneCacheParams,
  FilterPanelProps,
  CategorieFiltre,
} from './filter-panel/types';
import type { FilterPanelProps, CategorieFiltre } from './filter-panel/types';

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
  carreauxOpacity, carreaux3D, setCarreaux3D, carreauxHauteur, setCarreauxHauteur,
  carreauxRange, carreauxSelectedBucket,
  setCarreauxVisible, setCarreauxIndicateur, setCarreauxPalette, setCarreauxOpacity, setCarreauxSelectedBucket,
  irisVisible, irisIndicateur, irisPalette, irisOpacity, irisBornes, irisTrueOnly,
  zoomCourant, irisZoomPlancher,
  clusterGeoJSON, clustersVisible, clusterLoading, clusterDuration,
  onToggleClusters, onLoadClusters, onClusterDurationChange, onFitBounds,
  onWizardHighlight, onWizardClose,
  iris3D, setIris3D, irisHauteur, setIrisHauteur,
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
  filtre = null,
}: FilterPanelProps) {
  const isOverlayMode = !!visibleCategory;
  // `visibleCategory` accepte une categorie seule ou un tableau (l'entree
  // « Calques » du rail affiche audience + terrain dans le meme panneau —
  // voir lib/navigation/config.ts, Tache 2).
  const categoriesVisibles: CategorieFiltre[] | null = visibleCategory == null
    ? null
    : Array.isArray(visibleCategory) ? visibleCategory : [visibleCategory];
  const categorieVisible = (cat: CategorieFiltre) => !categoriesVisibles || categoriesVisibles.includes(cat);

  // ── Recherche + sections repliables ────────────────────────────────
  const {
    filterSearch, setFilterSearch, sectionsOpen,
    toggleSection, collapseAll, expandAll,
  } = useFilterSections(isOverlayMode, selectedIrisCommuneCode);

  // ── Ingestion sante environnementale (admin) ──────────────────────
  const { civicIngestState, runCivicIngestStream } = useCivicIngest(onCivicIngested);

  // ── Panel resize ────────────────────────────────────────────────────
  const { panelWidth, setPanelWidth, onResizeMouseDown } = usePanelResize();

  // ── Catalogue POI (categories + natures, charge depuis la base) ────────
  const {
    poiTypes, catsLoading, catsError, fetchCategories,
    poiNatures, fetchPoiNatures, selectedPoiNatures, setSelectedPoiNatures,
  } = usePoiCatalog();

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('geoprompt');
  // activeExpertTab supprimé — panel unique scrollable (Sprint 1)

  // ── OOH / DOOH state ──────────────────────────────────────────────────────
  const [selectedOOH, setSelectedOOH] = useState<string[]>([]);

  // ── Transport en commun ───────────────────────────────────────────────────
  const [selectedTransportTypes, setSelectedTransportTypes] = useState<string[]>([]);
  const [transportLoading, setTransportLoading]             = useState(false);

  // ── TMJA ──────────────────────────────────────────────────────────────────
  const [tmjaLoading, setTmjaLoading] = useState(false);

  // ── Analyse accordions ────────────────────────────────────────────────────
  const [analyseOpen, setAnalyseOpen] = useState<Record<string, boolean>>({
    spatiale: false, clustering: false, iris: false, carreaux: false,
  });
  const toggleAnalyse = (key: string) =>
    setAnalyseOpen(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Perimetre territorial (etat + referentiel + cascade + libelle) ──────
  // Depuis la Tache 4 (2026-09-12), plus aucune UI de CE composant ne modifie
  // scope/selectedRegions/selectedDepts/ville : PerimeterSections (seul
  // consommateur des setters) a demenage dans PanneauFiltre (entree Filtre
  // du rail), avec sa propre instance locale non liee. Les valeurs restent
  // lues ici (recherche POI, bataille isochrone, libelle territoire) via les
  // props controlees depuis page.tsx, mais rien ne les fait plus varier
  // depuis ce composant — code laisse en l'etat par la decision du controleur
  // (« code injoignable, piege pour la Tache 8 » qui supprimera ce fichier).
  const {
    scope,
    selectedRegions,
    selectedDepts,
    ville,
    REF_REGIONS,
    territoire, hasTerritoire,
  } = useTerritorySelection({
    scope: scopeProp, onScopeChange,
    selectedRegions: selectedRegionsProp, onSelectedRegionsChange,
    selectedDepts: selectedDeptsProp, onSelectedDeptsChange,
    ville: villeProp, onVilleChange,
  });

  // ── Filtre admin → couche carte + scope de capture partage ────────────
  const { adminScale, adminCodes } = useAdminScopeLayer(selectedRegions, selectedDepts);

  // ── Masque "afficher uniquement le territoire filtre" ────────────────
  // Le toggle (checkbox) vivait dans PerimeterSections, deplace dans
  // PanneauFiltre sans lui (voir plus haut) : plus rien n'active jamais ce
  // masque depuis ce composant, la valeur reste figee a false. L'appel est
  // conserve pour son effet de bord (retrait propre du layer au demontage).
  useTerritoryMask(mainMapRef, adminScale, adminCodes);

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

  // ── Style des pins POI ────────────────────────────────────────
  const { poiStyles, setPoiStyles, getPOIStyle, setPOIStyle } = usePoiStyles(onPOIStylesChange);
  const [poisRayon,     setPoisRayon]     = useState<string | null>(null);
  const [showVoronoi,      setShowVoronoi]      = useState(false);
  const [showBattle,       setShowBattle]       = useState(false);
  const [showBattleV2,     setShowBattleV2]     = useState(false);
  // ── Analyses logic ────────────────────────────────────────────────────────
  const exactlyOnePOI = selectedPOI.length === 1;
  const hasAnyPOI     = selectedPOI.length > 0;

  // ── Territoire de la bataille isochrone, dérivé du filtre actif (Tâche 4,
  // round 1 de correction) ────────────────────────────────────────────────
  // `selectedRegions`/`selectedDepts`/`ville` de CE composant ne sont plus
  // alimentés par aucune UI depuis que PerimeterSections a déménagé dans
  // PanneauFiltre (widget local, non lié) : la bataille partait donc sans
  // AUCUNE borne géographique, la famille de requêtes qui a mis la base à
  // terre le 08/04. On dérive le territoire du `filtre` unique à la place —
  // cp/zone/aucun filtre : rien, comme avant cette tâche.
  const filtreVilleBattle   = filtre?.type === 'commune' ? filtre.label : '';
  const filtreRegionsBattle = useMemo(
    () => (filtre?.type === 'region' ? [filtre.code] : []),
    [filtre],
  );
  const filtreDeptsBattle = useMemo(
    () => (filtre?.type === 'departement' ? [filtre.code] : []),
    [filtre],
  );

  // ── Outils isochrones / bataille ─────────────────────────────────
  const {
    transportMode, setTransportMode,
    isoDurations, toggleDuration,
    battleV2Paliers, setBattleV2Paliers,
    battleV2Loading, battleV2Log, setBattleV2Log,
    v2CacheStatus, setV2CacheStatus, v2Checking, v2Filling,
    v2FillTotal, v2FillCompleted, v2FillPct, v2FillRings,
    orsCacheStatus, orsChecking,
    battleLoading, battleLog, setBattleLog,
    battleMeta, battleRings,
    battleApplyLoading, setBattleApplyLoading,
    battleApplyPct, setBattleApplyPct,
    battleProgress, battleTotal, battleCompleted,
    handleCheckV2, handleCheckORS, handleFillMissingV2,
    handleBattle, handleBattleV2,
  } = useIsochroneBattle({
    selectedPOI, exactlyOnePOI,
    ville: filtreVilleBattle, selectedRegions: filtreRegionsBattle, selectedDepts: filtreDeptsBattle,
    refRegions: REF_REGIONS,
    onDirectBattle, onDirectBattleV2, onFillIsochroneCache,
  });


  // ── Actions ───────────────────────────────────────────────────────────────
  const send = (text: string) => { if (!isLoading) sendMessage(text); };


  const [searchLoading,    setSearchLoading]    = useState(false);
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
            CATÉGORIE — ANALYSES (ex-Analyse)
        ════════════════════════════════════════ */}
        {categorieVisible('analyses') && (
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

            {/* ── Accordéon : CLUSTERING ──────────────────────────────────── */}
            <ClusteringSection
              analyseOpen={analyseOpen}
              toggleAnalyse={toggleAnalyse}
              clusterGeoJSON={clusterGeoJSON}
              clustersVisible={clustersVisible}
              clusterLoading={clusterLoading}
              clusterDuration={clusterDuration}
              onToggleClusters={onToggleClusters}
              onLoadClusters={onLoadClusters}
              onClusterDurationChange={onClusterDurationChange}
              onFlyTo={onFlyTo}
              onFitBounds={onFitBounds}
              onWizardHighlight={onWizardHighlight}
              onWizardClose={onWizardClose}
            />

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
