'use client';

/**
 * @file app/map/_components/panneaux/PanneauAnalyse.tsx — panneau « Analyse »
 * (Tâche 7, 2026-09-12).
 *
 * Contenu de l'entrée « Analyse » du rail (lib/navigation/config.ts) : « Ce que
 * je calcule ». Regroupe deux blocs repris TELS QUELS depuis l'ex-catégorie
 * `analyses` de `FilterPanel.tsx` (`VoronoiTool`, `IsochronesTool`,
 * `BattleV2Tool`, `ClusteringSection`, `SpatialAnalysisEmptyState`/
 * `SpatialAnalysisTooManyPoi` — fichiers NON déplacés physiquement, seulement
 * réimportés ici depuis `../filter-panel/`, comme `PanneauCalques` l'a fait
 * pour les sections Calques à la Tâche 6) :
 *
 *   - Analyse spatiale : Voronoï géométrique, Bataille V2 (multi-paliers),
 *     Isochrones routiers (ORS) — exclusion mutuelle CONSERVÉE telle quelle
 *     (chaque outil ferme les deux autres, comportement de
 *     `FilterPanel.tsx:787-851` avant cette tâche).
 *   - Clustering (K-Means) — `ClusteringSection` telle quelle. GARDÉE en DEUX
 *     points distincts (voir ci-dessous) : ni `ClusteringSection.tsx`, ni
 *     `ClusterPanel.tsx`, ni `ClusteringWizard.tsx` ne voient leur LOGIQUE
 *     modifiée — chacun ne fait que relayer une nouvelle prop
 *     `verifierPerimetre` d'un niveau à l'autre, exactement comme les props
 *     de lancement enveloppées ci-dessous.
 *
 * **Garde de périmètre (spec §5, CLAUDE.md — incidents du 28/03 et du 08/04) :**
 * `lib/carte/garde-perimetre.ts` (logique pure, testée) bloque tant qu'aucun
 * `FiltreActif` n'est posé. Câblage vérifié structurellement par
 * `tests/unit/carte/panneau-analyse-garde.test.ts` (lit le SOURCE de ce
 * fichier) — SIX points de lancement, à CINQ endroits distincts :
 *   1. Voronoï (`VoronoiTool` → geo.prompt)
 *   2. Bataille isochrone V1 (`IsochronesTool` → vérif. cache/lancement)
 *   3. Bataille isochrone V2 (`BattleV2Tool` → vérif. cache/remplissage ORS/lancement)
 *   4. Application de la bataille — bouton « BATAILLE (ST_Difference) »
 *      (`IsochronesTool.onApplyBattle`), un second point de calcul PostGIS
 *      distinct du lancement
 *   5. Clustering — DEUX points, round 2 de correction (voir ci-dessous) :
 *      a. `ClusteringSection.onLoadClusters` — un simple GET de relecture
 *         d'un modèle déjà calculé, gardé par prudence (round 1) mais qui
 *         N'EST PAS le calcul lourd ;
 *      b. `ClusteringWizard.handleLaunch` (POST `/api/poi-clusters/run`,
 *         `geo_filter` optionnel construit par LE WIZARD LUI-MÊME, sans
 *         aucun rapport avec `FiltreActif`) — LE VRAI point de calcul,
 *         gardé en relayant `verifierPerimetre` en prop à travers
 *         `ClusteringSection` → `ClusterPanel` → `ClusteringWizard`, qui
 *         l'appelle juste avant son `fetch`. Round 1 gardait UNIQUEMENT (a),
 *         en croyant border (b) — ce qui ne bloquait rien : `onLoadClusters`
 *         et le POST du wizard sont deux chemins de code totalement
 *         indépendants.
 *
 * **Parité stricte avec l'ex-FilterPanel pour le territoire de la bataille**
 * (`scope`/`selectedRegions`/`selectedDepts`/`ville`, dérivés via
 * `useTerritorySelection`) : ces props restent câblées depuis `page.tsx`
 * EXACTEMENT comme avant cette tâche — `FilterPanel.tsx` documentait déjà ce
 * code comme « injoignable, piège pour la Tâche 8 » (plus aucune UI ne les
 * fait varier depuis que `PerimeterSections` a déménagé dans `PanneauFiltre`).
 * Ni corrigé ni retiré ici : ce n'est pas l'objet de cette tâche, et la
 * bataille elle-même dérive son VRAI territoire du `filtre` actif
 * (`filtreVilleBattle`/`filtreRegionsBattle`/`filtreDeptsBattle`, identique à
 * l'ex-FilterPanel).
 */
import { useEffect, useMemo, useState } from 'react';
import { ISO_MODES } from '@/lib/geo/france-admin';
import { C, fInter } from '../filter-panel/tokens';
import { labelStyle, pill } from '../filter-panel/styles';
import { ClusteringSection } from '../filter-panel/ClusteringSection';
import { SpatialAnalysisEmptyState, SpatialAnalysisTooManyPoi } from '../filter-panel/SpatialAnalysisIntro';
import { VoronoiTool } from '../filter-panel/VoronoiTool';
import { ScoreCompositeTool } from '../filter-panel/ScoreCompositeTool';
import { CorrelationTool } from '../filter-panel/CorrelationTool';
import { BattleV2Tool } from '../filter-panel/BattleV2Tool';
import { IsochronesTool } from '../filter-panel/IsochronesTool';
import { useTerritorySelection } from '../filter-panel/use-territory-selection';
import { useIsochroneBattle } from '../filter-panel/use-isochrone-battle';
import type { ClusterGeoJSON } from '../ClusterPanel';
import type { FilterPanelProps } from '../filter-panel/types';
import type { FiltreActif } from '@/lib/carte/filtre';
import { messageGardePerimetre } from '@/lib/carte/garde-perimetre';

export interface PanneauAnalyseProps {
  // ── Territoire — parité stricte avec l'ex-FilterPanel (voir en-tête) ──────
  scope?: 'metro' | 'all' | null;
  onScopeChange?: (scope: 'metro' | 'all' | null) => void;
  selectedRegions?: string[];
  onSelectedRegionsChange?: (regions: string[]) => void;
  selectedDepts?: string[];
  onSelectedDeptsChange?: (depts: string[]) => void;
  ville?: string;
  onVilleChange?: (ville: string) => void;

  /** Filtre unique actif — garde de périmètre (spec §5). */
  filtre: FiltreActif | null;

  /** POI sélectionnés (lifted à page.tsx, partagé avec PanneauCalques). */
  selectedPOI: string[];

  /** Voronoï passe par le chat geo.prompt (function calling), pas un appel direct. */
  sendMessage: (text: string) => void;
  isLoading: boolean;

  onDirectBattle: FilterPanelProps['onDirectBattle'];
  onDirectBattleV2: FilterPanelProps['onDirectBattleV2'];
  onFillIsochroneCache: FilterPanelProps['onFillIsochroneCache'];
  onApplyBattle: FilterPanelProps['onApplyBattle'];

  voronoiVisible: boolean;
  setVoronoiVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  battleVisible: boolean;
  setBattleVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  battleOuterFillVisible: boolean;
  setBattleOuterFillVisible: (v: boolean) => void;

  // ── Clustering (K-Means) ───────────────────────────────────────────────
  clusterGeoJSON?: ClusterGeoJSON | null;
  clustersVisible?: boolean;
  clusterLoading?: boolean;
  clusterDuration?: number;
  onToggleClusters?: () => void;
  onLoadClusters?: () => void;
  onClusterDurationChange?: (d: number) => void;
  onFlyTo?: (lat: number, lng: number, zoom?: number) => void;
  onFitBounds?: (bounds: [[number, number], [number, number]]) => void;
  onWizardHighlight?: (poiTypes: string[], metropolitaine: boolean) => void;
  onWizardClose?: () => void;
}

export function PanneauAnalyse(props: PanneauAnalyseProps) {
  const {
    scope: scopeProp, onScopeChange,
    selectedRegions: selectedRegionsProp, onSelectedRegionsChange,
    selectedDepts: selectedDeptsProp, onSelectedDeptsChange,
    ville: villeProp, onVilleChange,
    filtre, selectedPOI,
    sendMessage, isLoading,
    onDirectBattle, onDirectBattleV2, onFillIsochroneCache, onApplyBattle,
    voronoiVisible, setVoronoiVisible,
    battleVisible, setBattleVisible,
    battleOuterFillVisible, setBattleOuterFillVisible,
  } = props;

  // ── Perimetre territorial — voir en-tete du fichier (parite, non corrige) ─
  const { REF_REGIONS, territoire } = useTerritorySelection({
    scope: scopeProp, onScopeChange,
    selectedRegions: selectedRegionsProp, onSelectedRegionsChange,
    selectedDepts: selectedDeptsProp, onSelectedDeptsChange,
    ville: villeProp, onVilleChange,
  });

  // ── Accordeons ────────────────────────────────────────────────────────
  const [analyseOpen, setAnalyseOpen] = useState<Record<string, boolean>>({ spatiale: false, clustering: false });
  const toggleAnalyse = (key: string) => setAnalyseOpen(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Exclusion mutuelle des trois outils — conservee telle quelle ────────
  const [showVoronoi, setShowVoronoi] = useState(false);
  const [showBattle, setShowBattle] = useState(false);
  const [showBattleV2, setShowBattleV2] = useState(false);

  const exactlyOnePOI = selectedPOI.length === 1;
  const hasAnyPOI = selectedPOI.length > 0;

  // ── Territoire REEL de la bataille, derive du filtre actif (Tache 4,
  // round 1 de correction) — identique a l'ex-FilterPanel. ────────────────
  const filtreVilleBattle = filtre?.type === 'commune' ? filtre.label : '';
  const filtreRegionsBattle = useMemo(
    () => (filtre?.type === 'region' ? [filtre.code] : []),
    [filtre],
  );
  const filtreDeptsBattle = useMemo(
    () => (filtre?.type === 'departement' ? [filtre.code] : []),
    [filtre],
  );

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

  const send = (text: string) => { if (!isLoading) sendMessage(text); };

  // ── Garde de perimetre (spec §5) — logique pure dans garde-perimetre.ts,
  // ce composant se contente d'appeler la fonction et d'afficher son message
  // avant tout lancement. Cablage verifie structurellement par
  // tests/unit/carte/panneau-analyse-garde.test.ts (lit ce fichier). ───────
  const [gardeMessage, setGardeMessage] = useState<string | null>(null);
  useEffect(() => { if (filtre) setGardeMessage(null); }, [filtre]);
  const verifierPerimetre = (): boolean => {
    const msg = messageGardePerimetre(filtre);
    setGardeMessage(msg);
    return msg === null;
  };

  const handleVoronoi = () => {
    if (!exactlyOnePOI || !verifierPerimetre()) return;
    send(`Fais le Voronoi des ${selectedPOI[0]} ${territoire}`);
  };
  const handleCheckORSGarde = () => { if (verifierPerimetre()) handleCheckORS(); };
  const handleBattleGarde = (force = false) => { if (verifierPerimetre()) handleBattle(force); };
  const handleCheckV2Garde = () => { if (verifierPerimetre()) handleCheckV2(); };
  const handleFillMissingV2Garde = () => { if (verifierPerimetre()) handleFillMissingV2(); };
  const handleBattleV2Garde = (force = false) => { if (verifierPerimetre()) handleBattleV2(force); };

  // ── Round 1 de correction : point de lancement transmis nu au premier
  // passage — même patron que ci-dessus (enveloppe la fonction passée en
  // prop, ne touche pas IsochronesTool.tsx). ───────────────────────────────
  const handleApplyBattleGarde: FilterPanelProps['onApplyBattle'] = async (rings, category, poisForMap, onProgress) => {
    if (!verifierPerimetre()) return;
    await onApplyBattle(rings, category, poisForMap, onProgress);
  };
  // Round 1 : gardait cette relecture GET (prudence). Round 2 : ce n'est PAS
  // le calcul lourd — voir plus bas `verifierPerimetre` relayé au wizard.
  const handleLoadClustersGarde = () => { if (verifierPerimetre()) props.onLoadClusters?.(); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

      {/* Garde de perimetre (spec §5) — message affiche apres une tentative de
          lancement bloquee, POUR N'IMPORTE LEQUEL des cinq outils (Voronoi,
          bataille V1/V2, application de la bataille, clustering) : place au
          niveau du panneau, pas dans l'accordeon Analyse spatiale, sinon un
          lancement de clustering bloque restait muet (round 1 de correction —
          le clustering se lance hors de ce bloc, sans passer par
          `exactlyOnePOI`). S'efface des qu un filtre est pose (effet
          ci-dessus). */}
      {gardeMessage && (
        <div style={{
          margin: '10px 14px 0', padding: '8px 10px', borderRadius: 4,
          background: 'rgba(255,87,87,0.08)', border: '0.5px solid rgba(255,87,87,0.25)',
          color: 'var(--danger)', fontFamily: fInter, fontSize: 12, lineHeight: 1.5,
        }}>
          ! {gardeMessage}
        </div>
      )}

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
                handleCheckV2={handleCheckV2Garde}
                handleFillMissingV2={handleFillMissingV2Garde}
                handleBattleV2={handleBattleV2Garde}
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
                handleCheckORS={handleCheckORSGarde}
                battleLoading={battleLoading}
                battleLog={battleLog}
                setBattleLog={setBattleLog}
                battleTotal={battleTotal}
                battleCompleted={battleCompleted}
                battleProgress={battleProgress}
                handleBattle={handleBattleGarde}
                battleRings={battleRings}
                battleMeta={battleMeta}
                battleApplyLoading={battleApplyLoading}
                setBattleApplyLoading={setBattleApplyLoading}
                battleApplyPct={battleApplyPct}
                setBattleApplyPct={setBattleApplyPct}
                onApplyBattle={handleApplyBattleGarde}
              />

            </div>
          )}

        </div>{/* fin section analyse spatiale */}
        </div>
        )}

        {/* ── Accordéon : SCORE COMPOSITE (Tâche 12, 2026-09-13) ──────────
            Sixième outil de calcul du panneau, donc SEPTIÈME point de
            lancement gardé : `verifierPerimetre` est relayé en prop et appelé
            juste avant le POST, comme pour le wizard de clustering. Sans
            périmètre, le score porterait sur les 6 187 CP de France. */}
        <ScoreCompositeTool filtre={filtre} verifierPerimetre={verifierPerimetre} />

        {/* ── Accordéon : CORRÉLATION (Tâche 13, 2026-09-13) ───────────────
            PAS de garde de périmètre, et c'est délibéré : cet outil est borné
            par une CAMPAGNE, pas par une zone géographique. Il lit
            `campaign_cp_rollup` (déjà agrégé, scopé à une campagne dont
            l'accès est vérifié côté route) — il n'existe aucun balayage à
            empêcher, et exiger un filtre carte interdirait une analyse
            parfaitement bornée. Le verrou structurel de la garde le déclare
            explicitement pour que cette absence reste un choix lisible et non
            un oubli. */}
        <CorrelationTool />

        {/* ── Accordéon : CLUSTERING — composant telle quelle, DEUX points gardés :
            onLoadClusters (relecture, round 1) et verifierPerimetre relayé
            jusqu'à ClusteringWizard pour son POST /api/poi-clusters/run —
            le VRAI calcul (round 2, voir en-tête du fichier). ──────────── */}
        <ClusteringSection
          analyseOpen={analyseOpen}
          toggleAnalyse={toggleAnalyse}
          clusterGeoJSON={props.clusterGeoJSON}
          clustersVisible={props.clustersVisible}
          clusterLoading={props.clusterLoading}
          clusterDuration={props.clusterDuration}
          onToggleClusters={props.onToggleClusters}
          onLoadClusters={handleLoadClustersGarde}
          onClusterDurationChange={props.onClusterDurationChange}
          onFlyTo={props.onFlyTo}
          onFitBounds={props.onFitBounds}
          onWizardHighlight={props.onWizardHighlight}
          onWizardClose={props.onWizardClose}
          verifierPerimetre={verifierPerimetre}
        />

      </div>
    </div>
  );
}
