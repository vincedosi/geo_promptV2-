'use client';

/**
 * @file app/map/_components/panneaux/PanneauCalques.tsx — panneau « Calques »
 * (Tâche 6, 2026-09-12).
 *
 * Contenu de l'entrée « Calques » du rail (lib/navigation/config.ts) : « Ce
 * que je vois ». Regroupe en SIX groupes repliables des sections EXISTANTES,
 * déplacées telles quelles depuis `FilterPanel.tsx` (leur logique métier n'a
 * pas changé) :
 *
 *   - Socio-démographie   → CarreauxSection, IrisSection
 *   - Campagne active     → couche d'impressions (SuiviMapLayer), visible
 *                           seulement si une campagne est active
 *   - POI et mobilité     → PoiSection, TransportSection, TmjaSection
 *   - Médias offline      → OohSection, RadioSection
 *   - Environnement       → CivicIndicatorsSection, CivicHealthSection,
 *                           MeteoSection
 *   - Mes analyses        → branché sur `GET /api/analyses` (Tâche 11,
 *                           `use-analyses.ts`) : vide à la Tâche 6, la table
 *                           `analyses` (sql/145) et la route n'existaient pas
 *                           encore. Chargé au premier dépliage du groupe
 *                           seulement (garde `useRef`, pas de prefetch).
 *
 * `GroupeCalques` est le SEUL composant à rendre un chevron DE GROUPE — les
 * accordéons internes aux sections déplacées (FilterSectionHeader, le ▲/▼ de
 * CarreauxSection/IrisSection) restent inchangés.
 *
 * Exclusivité des dégradés (carreaux, IRIS, indicateurs civiques, santé
 * environnementale) : ce composant sait QUEL calque correspond à quel
 * `DegradeId` et appelle `onDegrade(cible, next)` — fourni par page.tsx, qui
 * pilote l'état réel (`useMapLayers.basculerDegrade`) et le toast
 * d'exclusivité (spec §3). Météo et impressions de campagne s'activent HORS
 * de ce panneau (modale météo, événement DOM de suivi de campagne) : leur
 * exclusivité est câblée directement dans `page.tsx`.
 *
 * Divergence assumée avec le brief : `calquesActifs`/`onRetirerCalque` ne
 * sont PAS des props reçues du parent. Une partie de l'état affiché dans
 * « Actifs (n) » (OOH sélectionnés, types de transport) est LOCALE à ce
 * panneau — exactement comme elle l'était dans `FilterPanel.tsx` avant cette
 * tâche — donc la construction de la liste doit vivre ICI, pas chez le
 * parent. La lever à page.tsx aurait été une réécriture non demandée de
 * `OohSection`/`TransportSection`. Voir le rapport de tâche.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { GroupeCalques } from './GroupeCalques';
import { RisqueIndustrielSection } from '../filter-panel/RisqueIndustrielSection';
import type { EtatRisqueIndustriel } from '../filter-panel/use-risque-industriel';
import { CarreauxSection } from '../filter-panel/CarreauxSection';
import { IrisSection } from '../filter-panel/IrisSection';
import { CivicIndicatorsSection } from '../filter-panel/CivicIndicatorsSection';
import { CivicHealthSection } from '../filter-panel/CivicHealthSection';
import { MeteoSection } from '../filter-panel/MeteoSection';
import { PoiSection } from '../filter-panel/PoiSection';
import { TransportSection } from '../filter-panel/TransportSection';
import { TmjaSection } from '../filter-panel/TmjaSection';
import { OohSection } from '../filter-panel/OohSection';
import { RadioSection } from '../filter-panel/RadioSection';
import { useFilterSections } from '../filter-panel/use-filter-sections';
import { usePoiCatalog } from '../filter-panel/use-poi-catalog';
import { usePoiStyles } from '../filter-panel/use-poi-styles';
import { useCivicIngest } from '../filter-panel/use-civic-ingest';
import { useAnalyses } from '../filter-panel/use-analyses';
import type { AnalyseListItem } from '../filter-panel/use-analyses';
import type { POIStylesMap } from '../filter-panel/poi-style';
import type { DirectPOISearchParams } from '../filter-panel/types';
import type { BornesEchelle } from '@/lib/carreaux/bornes';
import type { BornesIris } from '@/lib/iris/echelle';
import { libelleDegrade, type DegradeId } from '@/lib/carte/degrades';
import type { SuiviMapEventDetail } from '../SuiviMapLayer';

export interface PanneauCalquesProps {
  // ── Exclusivité des dégradés (carreaux, IRIS, civic-indicateurs, civic-sante) ──
  degradeActif: DegradeId | null;
  onDegrade: (cible: DegradeId, next: boolean) => void;

  // ── Carreaux Filosofi ──────────────────────────────────────────────────────
  carreauxVisible?: boolean;
  carreauxLoaded?: boolean;
  carreauxIndicateur?: string;
  carreauxPalette?: string;
  carreauxOpacity?: number;
  carreaux3D?: boolean;
  setCarreaux3D?: (v: boolean) => void;
  carreauxHauteur?: number;
  setCarreauxHauteur?: (v: number) => void;
  carreauxRange?: BornesEchelle | null;
  carreauxSelectedBucket?: number | null;
  setCarreauxVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setCarreauxIndicateur?: (v: string) => void;
  setCarreauxPalette?: (v: string) => void;
  setCarreauxOpacity?: (v: number) => void;
  setCarreauxSelectedBucket?: (v: number | null) => void;

  // ── IRIS ───────────────────────────────────────────────────────────────────
  irisVisible?: boolean;
  irisIndicateur?: string;
  irisPalette?: string;
  irisOpacity?: number;
  iris3D?: boolean;
  setIris3D?: (v: boolean) => void;
  irisHauteur?: number;
  setIrisHauteur?: (v: number) => void;
  irisBornes?: BornesIris | null;
  irisTrueOnly?: boolean;
  zoomCourant?: number | null;
  irisZoomPlancher?: number;
  setIrisVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setIrisIndicateur?: (v: string) => void;
  setIrisPalette?: (v: string) => void;
  setIrisOpacity?: (v: number) => void;
  setIrisTrueOnly?: (v: boolean) => void;

  // ── Campagne active (SuiviMapLayer) ───────────────────────────────────────
  campagneActive: SuiviMapEventDetail | null;
  onFermerCampagneActive: () => void;

  // ── POI ────────────────────────────────────────────────────────────────────
  selectedPOI: string[];
  onSelectedPOIChange: (poi: string[]) => void;
  onDirectSearch: (params: DirectPOISearchParams) => Promise<void>;
  onPOIStylesChange?: (styles: POIStylesMap) => void;
  densityMode?: boolean;
  onDensityModeChange?: (v: boolean) => void;
  /** Périmètre territorial courant — construit `DirectPOISearchParams` (Tâche 4). */
  scope: 'metro' | 'all' | null;
  selectedRegions: string[];
  selectedDepts: string[];
  ville: string;

  // ── OOH ────────────────────────────────────────────────────────────────────
  onDirectOOH: (regies?: string[]) => Promise<void>;

  // ── Transport ──────────────────────────────────────────────────────────────
  onLoadTransport?: (types: string[]) => Promise<void>;

  // ── TMJA ───────────────────────────────────────────────────────────────────
  onLoadTMJA?: () => Promise<void>;
  tmjaVisible?: boolean;
  onClearTMJA?: () => void;
  tmjaHideLowTraffic?: boolean;
  onToggleTmjaHideLowTraffic?: (next: boolean) => void;

  // ── Radio ──────────────────────────────────────────────────────────────────
  radioVisible?: boolean;
  onToggleRadio?: () => void;
  radioHeatmapMode?: boolean;
  onToggleRadioHeatmap?: () => void;
  radioCoverageMode?: boolean;
  onToggleRadioCoverage?: () => void;
  radioLoading?: boolean;
  radioSystemeFilter?: string;
  onRadioSystemeChange?: (v: string) => void;
  onSelectRadio?: (radioId: string, radioNom: string) => void;
  radioCount?: number;
  radioSelectedNom?: string | null;
  onClearRadioSelection?: () => void;
  radioFilterIds?: string[];
  onRadioFilterIdsChange?: (ids: string[]) => void;
  radioExcludeCategories?: string[];
  onRadioExcludeCategoriesChange?: (cats: string[]) => void;
  /**
   * Etat de la couche « Zones a risque industriel », regroupe dans un hook
   * (`useRisqueIndustriel`) : ce panneau recoit deja une soixantaine de props,
   * en ajouter douze pour une seule section serait illisible. Meme patron que
   * `mapLayers`.
   */
  risqueIndustriel: EtatRisqueIndustriel;
  radioFilterOptions?: { radios: Array<{ id: string; nom: string; cat: string | null }>; categories: Array<{ value: string; label: string }> } | null;
  radioCoverageColor?: string;
  onRadioCoverageColorChange?: (c: string) => void;
  radioCoverageOpacity?: number;
  onRadioCoverageOpacityChange?: (v: number) => void;
  radioBorderWidth?: number;
  onRadioBorderWidthChange?: (v: number) => void;
  radioPointSize?: number;
  onRadioPointSizeChange?: (v: number) => void;
  onRecenterFrance?: () => void;

  // ── Indicateurs civiques ───────────────────────────────────────────────────
  civicVariableCode?: 'abstention_pres_2022' | null;
  onCivicVariableChange: (code: 'abstention_pres_2022' | null) => void;

  // ── Santé environnementale ─────────────────────────────────────────────────
  selectedIrisCommuneCode?: string | null;
  selectedIrisCommuneName?: string | null;
  civicHealthLayer?: 'pollen' | 'atmo' | null;
  onCivicHealthLayerChange: (layer: 'pollen' | 'atmo' | null) => void;
  civicProgress?: { done: number; total: number } | null;
  civicLoading?: boolean;
  civicScale?: 'departement' | 'cp';
  onCivicScaleChange?: (s: 'departement' | 'cp') => void;
  civicMetric?: string;
  onCivicMetricChange?: (m: string) => void;
  civicMinLevel?: number;
  onCivicMinLevelChange?: (n: number) => void;
  civicCpStatus?: 'ok' | 'no_data' | null;
  civicCpDate?: string | null;
  onCivicIngested?: () => void;

  // ── Météo — déjà exclusive côté page.tsx (modale hors de ce panneau) ───────
  onOpenMeteo: () => void;
  onClearMeteo?: () => void;
  meteoVisible?: boolean;
  meteoLabel?: string | null;

  /**
   * Ouvre l'overlay « Analyser la population à risque ».
   *
   * Relayée jusqu'a `RisqueIndustrielSection` : l'overlay est monté par
   * `app/map/page.tsx`, pas par ce panneau, parce qu'il couvre tout l'ecran et
   * doit survivre a la fermeture du panneau qui l'a ouvert.
   */
  onAnalyserPopulation?: () => void;
}

type CleGroupe = 'socioDemo' | 'campagne' | 'poiMobilite' | 'mediasOffline' | 'environnement' | 'analyses';

export function PanneauCalques(props: PanneauCalquesProps) {
  const { onAnalyserPopulation } = props;
  const {
    degradeActif, onDegrade,
    carreauxVisible, setCarreauxVisible,
    irisVisible, setIrisVisible,
    campagneActive, onFermerCampagneActive,
    selectedPOI, onSelectedPOIChange, onDirectSearch, onPOIStylesChange,
    densityMode, onDensityModeChange, scope, selectedRegions, selectedDepts, ville,
    onDirectOOH, onLoadTransport,
    onLoadTMJA, tmjaVisible, onClearTMJA, tmjaHideLowTraffic, onToggleTmjaHideLowTraffic,
    radioVisible, onToggleRadio,
    civicVariableCode, onCivicVariableChange,
    civicHealthLayer, onCivicHealthLayerChange,
    meteoVisible, onClearMeteo,
    risqueIndustriel,
  } = props;

  // ── Groupes repliables — tous fermés par défaut (même défaut que le mode
  // overlay de useFilterSections pour les sections non territoriales). ──────
  const [groupesOuverts, setGroupesOuverts] = useState<Record<CleGroupe, boolean>>({
    socioDemo: false, campagne: false, poiMobilite: false,
    mediasOffline: false, environnement: false, analyses: false,
  });
  const toggleGroupe = (cle: CleGroupe) => setGroupesOuverts(prev => ({ ...prev, [cle]: !prev[cle] }));

  // ── Recherche + sections repliables internes (poi/ooh/transport/tmja/meteo/
  // radio/civicHealth) — instance dédiée à ce panneau, comme FilterPanel avant
  // cette tâche (isOverlayMode = true : aucune persistance croisée). ────────
  const { filterSearch, sectionsOpen, toggleSection } = useFilterSections(true, props.selectedIrisCommuneCode);

  // ── Catalogue POI (categories + natures, chargé depuis la base au montage
  // du panneau — comportement inchangé, déjà celui de FilterPanel). ────────
  const {
    poiTypes, catsLoading, catsError, fetchCategories,
    poiNatures, fetchPoiNatures, selectedPoiNatures, setSelectedPoiNatures,
  } = usePoiCatalog();

  const { poiStyles, setPoiStyles, getPOIStyle, setPOIStyle } = usePoiStyles(onPOIStylesChange);
  const { civicIngestState, runCivicIngestStream } = useCivicIngest(props.onCivicIngested);
  const analysesState = useAnalyses();

  // ── État local — mêmes portées qu'avant cette tâche dans FilterPanel ──────
  const [selectedOOH, setSelectedOOH] = useState<string[]>([]);
  const [selectedTransportTypes, setSelectedTransportTypes] = useState<string[]>([]);
  const [transportLoading, setTransportLoading] = useState(false);
  const [tmjaLoading, setTmjaLoading] = useState(false);
  const [poisRayon] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [analyseOpenInterne, setAnalyseOpenInterne] = useState<Record<string, boolean>>({});

  const hasAnyPOI = selectedPOI.length > 0;
  const handleSearchPOI = async () => {
    if (!hasAnyPOI || searchLoading) return;
    setSearchLoading(true);
    try {
      await onDirectSearch({
        poi_types: selectedPOI,
        scope, regions: selectedRegions, depts: selectedDepts, ville,
        rayon_poi: poisRayon,
        poi_natures: Object.fromEntries(Object.entries(selectedPoiNatures).filter(([, v]) => v.length > 0)),
      });
    } finally {
      setSearchLoading(false);
    }
  };
  const setSelectedPOI = (next: string[] | ((prev: string[]) => string[])) => {
    onSelectedPOIChange(typeof next === 'function' ? (next as (p: string[]) => string[])(selectedPOI) : next);
  };

  // ── Bascule d'un calque à dégradé : demande l'exclusivité PUIS applique la
  // visibilité — jamais l'inverse (le toast doit connaître l'ancien état). ──
  const setCarreauxVisibleCalque = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(!!carreauxVisible) : v;
    onDegrade('carreaux', next);
    setCarreauxVisible(next);
  };
  const setIrisVisibleCalque = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(!!irisVisible) : v;
    onDegrade('iris', next);
    setIrisVisible(next);
  };
  const onCivicVariableChangeCalque = (code: 'abstention_pres_2022' | null) => {
    onDegrade('civic-indicateurs', code !== null);
    onCivicVariableChange(code);
  };
  const onCivicHealthLayerChangeCalque = (layer: 'pollen' | 'atmo' | null) => {
    onDegrade('civic-sante', layer !== null);
    onCivicHealthLayerChange(layer);
  };

  // ── Accordéon interne carreaux/iris lié à leur visibilité : les réglages
  // (maillage, indicateur, palette, opacité) ne s'affichent QUE quand le
  // calque est actif (décision du contrôleur, étape 1 du brief). Cliquer
  // l'en-tête de la section ACTIVE/désactive le calque — CarreauxSection et
  // IrisSection ne sont pas réécrits : ils reçoivent juste un `toggleAnalyse`
  // qui fait les deux à la fois pour ces deux clés. ─────────────────────────
  const analyseOpen = { ...analyseOpenInterne, carreaux: !!carreauxVisible, iris: !!irisVisible };
  const toggleAnalyse = (key: string) => {
    if (key === 'carreaux') { setCarreauxVisibleCalque(!carreauxVisible); return; }
    if (key === 'iris') { setIrisVisibleCalque(!irisVisible); return; }
    setAnalyseOpenInterne(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // ── « Actifs (n) » — un item par calque affiché, avec une croix qui l'éteint.
  // Construit ici (pas reçu en prop) : une partie de cet état est locale à ce
  // panneau (OOH, transport) — voir la divergence documentée en tête de fichier.
  interface ActifCalque { id: string; label: string; onRetirer: () => void }
  const actifs: ActifCalque[] = [];
  if (carreauxVisible) actifs.push({ id: 'carreaux', label: libelleDegrade('carreaux'), onRetirer: () => setCarreauxVisibleCalque(false) });
  if (irisVisible) actifs.push({ id: 'iris', label: libelleDegrade('iris'), onRetirer: () => setIrisVisibleCalque(false) });
  if (campagneActive) actifs.push({ id: 'campagne-impressions', label: libelleDegrade('campagne-impressions'), onRetirer: onFermerCampagneActive });
  if (selectedPOI.length > 0) actifs.push({ id: 'poi', label: `POI (${selectedPOI.length})`, onRetirer: () => setSelectedPOI([]) });
  if (selectedTransportTypes.length > 0) actifs.push({ id: 'transport', label: `Transport (${selectedTransportTypes.length})`, onRetirer: () => setSelectedTransportTypes([]) });
  if (tmjaVisible) actifs.push({ id: 'tmja', label: 'Flux routier (TMJA)', onRetirer: () => onClearTMJA?.() });
  if (selectedOOH.length > 0) actifs.push({ id: 'ooh', label: `OOH (${selectedOOH.length} régies)`, onRetirer: () => setSelectedOOH([]) });
  if (radioVisible) actifs.push({ id: 'radio', label: 'Radio FM/DAB+', onRetirer: () => onToggleRadio?.() });
  if (civicVariableCode) actifs.push({ id: 'civic-indicateurs', label: libelleDegrade('civic-indicateurs'), onRetirer: () => onCivicVariableChangeCalque(null) });
  if (civicHealthLayer) actifs.push({ id: 'civic-sante', label: libelleDegrade('civic-sante'), onRetirer: () => onCivicHealthLayerChangeCalque(null) });
  if (meteoVisible) actifs.push({ id: 'meteo', label: libelleDegrade('meteo'), onRetirer: () => onClearMeteo?.() });
  // Les deux couches de risque industriel MANQUAIENT à cette liste : « Actifs »
  // est le seul endroit qui dise ce qui est posé sur la carte, et une couche
  // absente d'ici ne peut pas s'éteindre depuis là. Elles sont comptées
  // séparément parce qu'elles s'allument séparément — un périmètre opposable
  // et un rayon de notre invention ne se pilotent pas ensemble.
  if (risqueIndustriel.actif) {
    actifs.push({
      id: 'risque-industriel',
      label: 'Zones à risque industriel',
      onRetirer: () => risqueIndustriel.setActif(false),
    });
  }
  if (risqueIndustriel.pprtActif) {
    actifs.push({
      id: 'pprt',
      label: 'Périmètre PPRT',
      onRetirer: () => risqueIndustriel.setPprtActif(false),
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

      {/* ── Actifs (n) ─────────────────────────────────────────────────────── */}
      <div style={{ borderBottom: '0.5px solid var(--border-subtle)' }}>
        <div style={{
          padding: '10px 14px', fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 12, fontWeight: 500, color: 'var(--text-primary)',
        }}>
          Actifs ({actifs.length})
        </div>
        {actifs.length > 0 && (
          <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {actifs.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                background: 'var(--elevated)', border: '0.5px solid var(--border-subtle)', borderRadius: 4,
              }}>
                <span style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                  {a.label}
                </span>
                <button
                  type="button"
                  onClick={a.onRetirer}
                  title={`Masquer ${a.label}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 0 }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        {actifs.length === 0 && (
          <div style={{ padding: '0 14px 10px', fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-tertiary)' }}>
            Aucun calque affiché
          </div>
        )}
      </div>

      {/* ── Socio-démographie ──────────────────────────────────────────────── */}
      <GroupeCalques titre="Socio-démographie" ouvert={groupesOuverts.socioDemo} onToggle={() => toggleGroupe('socioDemo')}
        compte={(carreauxVisible ? 1 : 0) + (irisVisible ? 1 : 0)}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <CarreauxSection
            analyseOpen={analyseOpen}
            toggleAnalyse={toggleAnalyse}
            carreauxVisible={carreauxVisible}
            carreauxLoaded={props.carreauxLoaded}
            carreauxIndicateur={props.carreauxIndicateur}
            carreauxPalette={props.carreauxPalette}
            carreauxOpacity={props.carreauxOpacity}
            carreaux3D={props.carreaux3D}
            setCarreaux3D={props.setCarreaux3D}
            carreauxHauteur={props.carreauxHauteur}
            setCarreauxHauteur={props.setCarreauxHauteur}
            carreauxRange={props.carreauxRange}
            carreauxSelectedBucket={props.carreauxSelectedBucket}
            setCarreauxVisible={setCarreauxVisibleCalque}
            setCarreauxIndicateur={props.setCarreauxIndicateur}
            setCarreauxPalette={props.setCarreauxPalette}
            setCarreauxOpacity={props.setCarreauxOpacity}
            setCarreauxSelectedBucket={props.setCarreauxSelectedBucket}
          />
          <IrisSection
            analyseOpen={analyseOpen}
            toggleAnalyse={toggleAnalyse}
            irisVisible={irisVisible}
            irisIndicateur={props.irisIndicateur}
            irisPalette={props.irisPalette}
            irisOpacity={props.irisOpacity}
            iris3D={props.iris3D}
            setIris3D={props.setIris3D}
            irisHauteur={props.irisHauteur}
            setIrisHauteur={props.setIrisHauteur}
            irisBornes={props.irisBornes}
            irisTrueOnly={props.irisTrueOnly}
            zoomCourant={props.zoomCourant}
            irisZoomPlancher={props.irisZoomPlancher}
            setIrisVisible={setIrisVisibleCalque}
            setIrisIndicateur={props.setIrisIndicateur}
            setIrisPalette={props.setIrisPalette}
            setIrisOpacity={props.setIrisOpacity}
            setIrisTrueOnly={props.setIrisTrueOnly}
          />
        </div>
      </GroupeCalques>

      {/* ── Campagne active ────────────────────────────────────────────────── */}
      {campagneActive && (
        <GroupeCalques titre="Campagne active" ouvert={groupesOuverts.campagne} onToggle={() => toggleGroupe('campagne')} compte={1}>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-secondary)' }}>
              Couche d&apos;impressions active — pilotée depuis le cockpit de suivi de la campagne.
            </div>
            <button
              type="button"
              onClick={onFermerCampagneActive}
              style={{
                alignSelf: 'flex-start', background: 'transparent', border: '0.5px solid var(--border-default)',
                borderRadius: 6, padding: '5px 10px', color: 'var(--text-secondary)', cursor: 'pointer',
                fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12,
              }}
            >
              Masquer la couche
            </button>
          </div>
        </GroupeCalques>
      )}

      {/* ── POI et mobilité ────────────────────────────────────────────────── */}
      <GroupeCalques titre="POI et mobilité" ouvert={groupesOuverts.poiMobilite} onToggle={() => toggleGroupe('poiMobilite')}
        compte={selectedPOI.length + selectedTransportTypes.length + (tmjaVisible ? 1 : 0)}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* `risque_industriel` est RETIRE de la liste des types de POI : la
              donnee a sa propre section dans le groupe Environnement, avec son
              niveau reglementaire, son type de risque, sa zone de danger et sa
              legende. La laisser ici en ferait une ligne parmi d'autres, sans
              aucun de ces reglages — et sa couleur par categorie ecraserait la
              couleur par type de risque. */}
          <PoiSection
            filterSearch={filterSearch}
            sectionsOpen={sectionsOpen}
            toggleSection={toggleSection}
            selectedPOI={selectedPOI}
            setSelectedPOI={setSelectedPOI}
            poiTypes={poiTypes.filter((t) => t.id !== 'risque_industriel')}
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
        </div>
      </GroupeCalques>

      {/* ── Médias offline ─────────────────────────────────────────────────── */}
      <GroupeCalques titre="Médias offline" ouvert={groupesOuverts.mediasOffline} onToggle={() => toggleGroupe('mediasOffline')}
        compte={selectedOOH.length + (radioVisible ? 1 : 0)}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <OohSection
            filterSearch={filterSearch}
            sectionsOpen={sectionsOpen}
            toggleSection={toggleSection}
            selectedOOH={selectedOOH}
            setSelectedOOH={setSelectedOOH}
            onDirectOOH={onDirectOOH}
          />
          <RadioSection
            filterSearch={filterSearch}
            sectionsOpen={sectionsOpen}
            toggleSection={toggleSection}
            radioCount={props.radioCount}
            radioVisible={radioVisible}
            onToggleRadio={onToggleRadio}
            radioSelectedNom={props.radioSelectedNom}
            onClearRadioSelection={props.onClearRadioSelection}
            onSelectRadio={props.onSelectRadio}
            radioFilterOptions={props.radioFilterOptions}
            radioFilterIds={props.radioFilterIds}
            onRadioFilterIdsChange={props.onRadioFilterIdsChange}
            radioExcludeCategories={props.radioExcludeCategories}
            onRadioExcludeCategoriesChange={props.onRadioExcludeCategoriesChange}
            radioSystemeFilter={props.radioSystemeFilter}
            onRadioSystemeChange={props.onRadioSystemeChange}
            radioCoverageMode={props.radioCoverageMode}
            onToggleRadioCoverage={props.onToggleRadioCoverage}
            radioCoverageColor={props.radioCoverageColor}
            onRadioCoverageColorChange={props.onRadioCoverageColorChange}
            radioCoverageOpacity={props.radioCoverageOpacity}
            onRadioCoverageOpacityChange={props.onRadioCoverageOpacityChange}
            radioBorderWidth={props.radioBorderWidth}
            onRadioBorderWidthChange={props.onRadioBorderWidthChange}
            radioHeatmapMode={props.radioHeatmapMode}
            onToggleRadioHeatmap={props.onToggleRadioHeatmap}
            radioPointSize={props.radioPointSize}
            onRadioPointSizeChange={props.onRadioPointSizeChange}
            onRecenterFrance={props.onRecenterFrance}
          />
        </div>
      </GroupeCalques>

      {/* ── Environnement ──────────────────────────────────────────────────── */}
      <GroupeCalques titre="Environnement" ouvert={groupesOuverts.environnement} onToggle={() => toggleGroupe('environnement')}
        compte={(risqueIndustriel.actif ? 1 : 0) + (risqueIndustriel.pprtActif ? 1 : 0) + (civicVariableCode ? 1 : 0) + (civicHealthLayer ? 1 : 0) + (meteoVisible ? 1 : 0)}>
          <RisqueIndustrielSection
            filterSearch={filterSearch}
            sectionsOpen={sectionsOpen}
            toggleSection={toggleSection}
            actif={risqueIndustriel.actif}
            setActif={risqueIndustriel.setActif}
            niveaux={risqueIndustriel.niveaux}
            setNiveaux={risqueIndustriel.setNiveaux}
            typesRisque={risqueIndustriel.typesRisque}
            setTypesRisque={risqueIndustriel.setTypesRisque}
            inclureInactifs={risqueIndustriel.inclureInactifs}
            setInclureInactifs={risqueIndustriel.setInclureInactifs}
            rayonM={risqueIndustriel.rayonM}
            setRayonM={risqueIndustriel.setRayonM}
            afficherHalo={risqueIndustriel.afficherHalo}
            setAfficherHalo={risqueIndustriel.setAfficherHalo}
            compte={risqueIndustriel.compte}
            pprtActif={risqueIndustriel.pprtActif}
            setPprtActif={risqueIndustriel.setPprtActif}
            pprtTypes={risqueIndustriel.pprtTypes}
            setPprtTypes={risqueIndustriel.setPprtTypes}
            pprtEtat={risqueIndustriel.pprtEtat}
            onAnalyserPopulation={onAnalyserPopulation}
          />
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CivicIndicatorsSection
            filterSearch={filterSearch}
            sectionsOpen={sectionsOpen}
            toggleSection={toggleSection}
            civicVariableCode={civicVariableCode}
            onCivicVariableChange={onCivicVariableChangeCalque}
          />
          <CivicHealthSection
            filterSearch={filterSearch}
            sectionsOpen={sectionsOpen}
            toggleSection={toggleSection}
            selectedIrisCommuneCode={props.selectedIrisCommuneCode}
            selectedIrisCommuneName={props.selectedIrisCommuneName}
            civicHealthLayer={civicHealthLayer}
            onCivicHealthLayerChange={onCivicHealthLayerChangeCalque}
            civicScale={props.civicScale}
            onCivicScaleChange={props.onCivicScaleChange}
            civicMetric={props.civicMetric}
            onCivicMetricChange={props.onCivicMetricChange}
            civicMinLevel={props.civicMinLevel}
            onCivicMinLevelChange={props.onCivicMinLevelChange}
            civicProgress={props.civicProgress}
            civicLoading={props.civicLoading}
            civicCpStatus={props.civicCpStatus}
            civicCpDate={props.civicCpDate}
            runCivicIngestStream={runCivicIngestStream}
            civicIngestState={civicIngestState}
          />
          <MeteoSection
            filterSearch={filterSearch}
            sectionsOpen={sectionsOpen}
            toggleSection={toggleSection}
            meteoVisible={meteoVisible}
            meteoLabel={props.meteoLabel}
            onOpenMeteo={props.onOpenMeteo}
            onClearMeteo={onClearMeteo}
          />
        </div>
      </GroupeCalques>

      {/* ── Mes analyses — GET /api/analyses au premier dépliage (Tâche 11). */}
      <GroupeCalques
        titre="Mes analyses"
        ouvert={groupesOuverts.analyses}
        onToggle={() => {
            // Charger a l'OUVERTURE seulement (relecture du 2026-09-13) :
            // `onToggle` est appele dans les deux sens, et apres un echec
            // reseau `use-analyses.ts` remet `fetchedRef` a false — replier
            // le groupe lancait alors une requete dont personne ne verrait
            // jamais le resultat.
            const ouvrir = !groupesOuverts.analyses;
            toggleGroupe('analyses');
            if (ouvrir) analysesState.demanderChargement();
          }}
      >
        {analysesState.loading && (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-tertiary)' }}>
              Chargement…
            </div>
          </div>
        )}
        {!analysesState.loading && analysesState.error && (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--danger)' }}>
              {analysesState.error}
            </div>
          </div>
        )}
        {!analysesState.loading && !analysesState.error && analysesState.analyses.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-tertiary)' }}>
              Aucune analyse enregistrée
            </div>
          </div>
        )}
        {!analysesState.loading && !analysesState.error && analysesState.analyses.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {analysesState.analyses.map((a: AnalyseListItem) => (
              <div
                key={a.id}
                style={{
                  padding: '10px 14px', borderTop: '0.5px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {a.nom}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {new Date(a.created_at).toLocaleDateString('fr-FR')}
                    {a.maillage ? ` · ${a.maillage}` : ''}
                    {a.statut !== 'termine' ? ` · ${a.statut === 'echec' ? 'échec' : 'en cours'}` : ''}
                  </div>
                </div>
                <span style={{
                  fontFamily: "'Inter', system-ui, sans-serif", fontSize: 10, color: 'var(--text-tertiary)',
                  background: 'var(--overlay)', border: '0.5px solid var(--border-default)',
                  borderRadius: 4, padding: '2px 8px', flexShrink: 0,
                }}>
                  {a.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </GroupeCalques>

    </div>
  );
}
