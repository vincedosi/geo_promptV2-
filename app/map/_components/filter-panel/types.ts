/**
 * @file filter-panel/types.ts — contrat public du FilterPanel
 *
 * Extrait de FilterPanel.tsx (2026-09-08). Les params des actions directes
 * (recherche POI, bataille V1/V2, remplissage de cache isochrone) sont
 * consommes par map/page.tsx et useMapDirectActions ; FilterPanel.tsx les
 * reexporte pour ne pas casser les importateurs historiques.
 */
import type React from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { ZoneData } from '@/types/spatial';
import type { IrisStats } from '@/app/copilote/_hooks/useMapLayers';
import type { BornesEchelle } from '@/lib/carreaux/bornes';
import type { POIStylesMap } from './poi-style';

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
  carreauxRange?:           BornesEchelle | null;
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
