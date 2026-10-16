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
 *   4. Deep-link URL (?customZone : charge une zone custom au montage)
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

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { adminFetch } from '@/lib/admin-fetch';
import { downloadZoneExport } from '@/lib/custom-geo/download-export';
import { MAP_STYLES, MAP_STYLE } from '@/app/map/_lib/constants';
import { useMapInit }          from '@/app/map/_hooks/useMapInit';
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
import { useVoronoiDirect }    from '@/app/map/_hooks/useVoronoiDirect';
import { useMapLayers }        from '@/app/map/_hooks/useMapLayers';
import { MapPanel }            from '@/app/map/_components/MapPanel';
import type { POIStylesMap } from '@/app/map/_components/filter-panel/poi-style';
import { IrisDetailPanel }    from '@/app/map/_components/IrisDetailPanel';
import type { IrisDetailData } from '@/app/map/_components/IrisDetailPanel';
import { CaptureLayers } from '@/app/map/_components/CaptureLayers';
import { CivicIndicatorsLayer, type CivicVariableCode } from '@/app/map/_components/CivicIndicatorsLayer';
import { CivicHealthMapLayer } from '@/app/map/_components/CivicHealthMapLayer';
import { SuiviMapLayer } from '@/app/map/_components/SuiviMapLayer';
import { DiffusionMapLayer } from '@/app/map/_components/DiffusionMapLayer';
import { ScoreMapLayer, SCORE_MAP_EVENT, type ScoreMapEventDetail } from '@/app/map/_components/ScoreMapLayer';
import { ZoneMediaPlanPanel, PANEL_WIDTH } from '@/app/map/_components/ZoneMediaPlanPanel';
import dynamic from 'next/dynamic';
import type { ClusterGeoJSON } from '@/app/map/_components/ClusterPanel';
import type { ZoneData, BattleResult } from '@/types/spatial';
import { RailNavigation } from '@/components/map/RailNavigation';
import { MapTopBar, MAP_TOPBAR_HEIGHT } from '@/components/map/MapTopBar';
import { BandeauErreur } from '@/components/map/BandeauErreur';
import { OverlayPanel } from '@/components/map/OverlayPanel';
import { SettingsOverlay } from '@/components/map/overlays/SettingsOverlay';
import { HelpOverlay } from '@/components/map/overlays/HelpOverlay';
import { useMagelianOverlay } from '@/components/magelian/MagelianOverlayContext';
import { useCampagneSession } from '@/lib/campagne/CampagneSessionContext';
import { CampagneActiveCard } from '@/components/magelian/CampagneActiveCard';
import { BarreContexteCampagne } from '@/components/campagne/BarreContexteCampagne';
import { DIFFUSION_REARM_EVENT } from '@/components/campagne/diffusion-rearm';
import { ENTREES_NAVIGATION, LARGEUR_RAIL, entreeParRaccourci, type EntreeId } from '@/lib/navigation/config';
import { ignorerRaccourciClavier } from '@/lib/navigation/garde-saisie';
import { empiler, depiler, fermerLePlusHaut } from '@/lib/carte/pile-echap';
import { PanneauFiltre } from '@/app/map/_components/panneaux/PanneauFiltre';
import { PanneauCalques } from '@/app/map/_components/panneaux/PanneauCalques';
import { RisqueIndustrielLayer } from '@/app/map/_components/RisqueIndustrielLayer';
import { PprtLayer } from '@/app/map/_components/PprtLayer';
import { ZonesRisqueLayer } from '@/app/map/_components/ZonesRisqueLayer';
import { AnalysePopulationOverlay } from '@/components/risques/AnalysePopulationOverlay';
import {
  ecrireEtatUrl, ETAT_DEFAUT as ETAT_RISQUE_DEFAUT,
} from '@/lib/risques/etat-url';
import { useRisqueIndustriel } from '@/app/map/_components/filter-panel/use-risque-industriel';
import { PanneauAnalyse } from '@/app/map/_components/panneaux/PanneauAnalyse';
import { PanneauZones } from '@/app/map/_components/panneaux/PanneauZones';
import { LegendeCarte } from '@/components/map/LegendeCarte';
import { FiltreChip } from '@/components/map/FiltreChip';
import { retirerFiltre, type FiltreActif } from '@/lib/carte/filtre';
import { libelleDegrade, type DegradeId } from '@/lib/carte/degrades';
import {
  SUIVI_MAP_STATUS_EVENT, SUIVI_MAP_CLEAR_EVENT, type SuiviMapEventDetail,
} from '@/app/map/_components/SuiviMapLayer';
import { useToast } from '@/components/ui/geo-toast';
import { Maximize2, Minimize2, Eraser, FileDown } from 'lucide-react';
import type { POI } from '@/types/poi';
import type { SelectedBillboard } from '@/types/map';

/**
 * Couleur du dot de l'en-tête de l'OverlayPanel, par entrée du rail.
 * Le titre, lui, vient directement de
 * `ENTREES_NAVIGATION` (source unique de la navigation, cf
 * lib/navigation/config.ts) — plus d'override local à synchroniser.
 */
const DOT_PAR_ENTREE: Partial<Record<EntreeId, string>> = {
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
  // Monté côté client uniquement (Tâche 15) : `CampagneSessionProvider` seme
  // sa session de façon SYNCHRONE dès son premier rendu client (lecture
  // immédiate de l'URL/localStorage, `CampagneSessionContext.tsx`) — un rendu
  // serveur qui n'a JAMAIS `window` reste toujours sur `SESSION_DEFAUT`. Tout
  // JSX de cette page qui ajoute/retire un noeud DOM selon `campagneSession.vue`
  // doit donc attendre ce flag, sans quoi le tout premier rendu client (avant
  // hydratation) peut déjà diverger du HTML serveur — mismatch d'hydratation.
  const [monte, setMonte] = useState(false);
  useEffect(() => { setMonte(true); }, []);
  const { open: magelianOverlayOpen, openOverlay, requestClose: requestCloseMagelianOverlay, setFiltreActif } = useMagelianOverlay();
  const { toast } = useToast();
  // Campagne active (SuiviMapLayer) : statut rediffusé par ce composant à
  // chaque changement (activation, fermeture, changement de métrique) — seul
  // moyen pour cette page de savoir si une campagne est active, l'état réel
  // vivant dans SuiviMapLayer (déclenché par un événement DOM émis ailleurs,
  // ex. CampaignSuivi.tsx). Tâche 6 : pilote le groupe « Campagne active » du
  // panneau Calques + l'exclusivité des dégradés de couleur (effet plus bas,
  // après la définition de `onDegrade`, qui dépend de `mapLayers`).
  const [campagneActive, setCampagneActive] = useState<SuiviMapEventDetail | null>(null);
  const campagneActiveRef = useRef<SuiviMapEventDetail | null>(null);
  // Session de campagne (Tâche 2, contexte GLOBAL depuis app/layout.tsx) —
  // pilote `DiffusionMapLayer` (Tâche 13B) : contrairement à `SuiviMapLayer`
  // ci-dessus, cette page peut lire l'état d'activation DIRECTEMENT (même
  // contexte React que l'overlay MAGELIAN), sans bus d'événements DOM.
  const { session: campagneSession } = useCampagneSession();
  const diffusionActifRef = useRef(false);
  // Hauteur RÉELLE de la barre de contexte campagne, mesurée plutôt que codée
  // en dur : elle passe à deux lignes sur une fenêtre étroite (`flexWrap`).
  // Sert à décaler `FiltreChip`, qui lui passait intégralement dessous en vue
  // Diffusion (constat 4 : la croix « Retirer le filtre » devenait
  // inatteignable, seule façon de retirer un filtre sans quitter la vue).
  const barreContexteRef = useRef<HTMLDivElement | null>(null);
  const [hauteurBarreContexte, setHauteurBarreContexte] = useState(0);
  useEffect(() => {
    const el = barreContexteRef.current;
    if (!el) { setHauteurBarreContexte(0); return; }
    const mesurer = () => setHauteurBarreContexte(el.getBoundingClientRect().height);
    mesurer();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [monte, campagneSession.vue]);
  // Route selon le TYPE de l'entrée (lib/navigation/config.ts), pas selon son
  // id : une entrée `overlay-plein-ecran` (Campagne) ouvre l'overlay MAGELIAN
  // via son propre contexte et ne devient donc jamais `entreeActive` — les
  // autres (panneau gauche, lien) basculent `entreeActive`, et
  // c'est le JSX de rendu qui décide où chacune s'affiche.
  const handleEntree = useCallback((id: EntreeId) => {
    const entree = ENTREES_NAVIGATION.find(e => e.id === id);
    if (entree?.type === 'overlay-plein-ecran') {
      // Bascule Campagne / Carte (Tâche 9) : Alt+C ou le clic sur l'icône du
      // rail alternent entre les deux, au lieu de rouvrir un overlay déjà
      // ouvert. `requestClose` (jamais `closeOverlay` en direct, round de
      // correction 1 point 4) : même chemin de fermeture animée que le
      // bouton Fermer et Échap.
      if (magelianOverlayOpen) requestCloseMagelianOverlay(); else openOverlay();
      return;
    }
    setEntreeActive(prev => prev === id ? null : id);
  }, [magelianOverlayOpen, openOverlay, requestCloseMagelianOverlay]);
  // POI sélectionnés : lifted ici pour persistance entre fermeture/réouverture overlay
  // (sinon le state local de PanneauCalques/PanneauAnalyse se perd → analyses
  // bloquées par le check exactlyOnePOI)
  const [selectedPOI, setSelectedPOI] = useState<string[]>([]);
  // Filtre unique « où je regarde » (Tâche 4, lib/carte/filtre.ts) — source
  // unique partagée par PanneauFiltre, FiltreChip, la pastille du rail et les
  // fetchs de couche bornés par bboxDuFiltre (useMapDirectActions, useMeteoLayer,
  // CivicHealthMapLayer). Pas de duplication d'état : un seul useState ici.
  const [filtre, setFiltre] = useState<FiltreActif | null>(null);
  // Miroir dans le contexte MAGELIAN (Tâche 9) : l'onglet Stratégie affiche
  // la note de périmètre (spec §3) sans dupliquer l'état du filtre.
  useEffect(() => { setFiltreActif(filtre); }, [filtre, setFiltreActif]);
  // Périmètre territorial : même lift (filtre dept/région doit survivre au cycle
  // mount/unmount des overlays — sinon Bataille V2 ignore le filtre user)
  const [perimeterScope,           setPerimeterScope]           = useState<'metro' | 'all' | null>(null);
  const [perimeterSelectedRegions, setPerimeterSelectedRegions] = useState<string[]>([]);
  const [perimeterSelectedDepts,   setPerimeterSelectedDepts]   = useState<string[]>([]);
  const [perimeterVille,           setPerimeterVille]           = useState('');
  const [selectedBillboard, setSelectedBillboard] = useState<SelectedBillboard | null>(null);
  const [mapStyleUrl, setMapStyleUrl] = useState<string>(MAP_STYLE);
  const [densityMode,         setDensityMode]         = useState<boolean>(false);

  // Couche « Zones a risque industriel » : etat regroupe dans son hook, partage
  // entre le panneau (reglages) et la couche (rendu). Defaut Seveso, cf.
  // use-risque-industriel.ts.
  const risqueIndustriel = useRisqueIndustriel();
  const [analysePopulation, setAnalysePopulation] = useState(false);

  /*
   * Ouvre l'atelier « Population à risque industriel » sur un jeu enregistré,
   * depuis la liste du panneau Zones.
   *
   * ⚠ L'état du module vit dans UN SEUL paramètre d'URL (`risque`), encodé par
   * `ecrireEtatUrl` : le module s'ouvre dans une page qui porte déjà ses
   * propres paramètres, et les y mélanger rendrait les deux illisibles. On
   * écrit donc l'URL AVANT de monter l'overlay — monté d'abord, il lirait
   * l'ancien état et afficherait l'onglet Rayons pendant que l'adresse dit
   * autre chose.
   */
  const ouvrirJeuDeZones = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(
      'risque',
      ecrireEtatUrl({ ...ETAT_RISQUE_DEFAUT, etape: 'zones', jeu: id }).toString(),
    );
    window.history.replaceState(null, '', url.toString());
    setAnalysePopulation(true);
  }, []);
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




  // ── Rail masqué (mode immersif) : entrée dans la pile Echap, au lieu d'un
  // listener direct — Escape le ré-affiche, avec le même ordre garanti
  // (dernier ouvert = premier fermé) que les panneaux et tiroirs. ──
  useEffect(() => {
    if (!railMasque) return;
    empiler('rail-masque', () => setRailMasque(false));
    return () => depiler('rail-masque');
  }, [railMasque]);

  // ── Un seul listener clavier global : raccourcis du rail (entreeParRaccourci,
  // lib/navigation/config.ts) + Escape (fermerLePlusHaut, lib/carte/pile-echap.ts).
  // La garde de saisie (lib/navigation/garde-saisie.ts, round de correction 1)
  // ne s'applique JAMAIS à Echap : taper dans une recherche de
  // panneau ne doit pas désactiver la touche qui les ferme. Elle ne filtre que
  // les raccourcis à modificateur, portée reprise de l'ancien IconBar.tsx:57-59
  // (supprimé Tâche 2), qui ne scopait sa garde qu'au seul raccourci `/`. ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (ignorerRaccourciClavier(e.key, document.activeElement)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        fermerLePlusHaut();
        return;
      }
      const entree = entreeParRaccourci(e);
      if (entree) {
        e.preventDefault();
        handleEntree(entree);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleEntree]);

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
  } = useMeteoLayer(mapRef, mapReady, filtre);

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
  // tmjaVisible existante côté PanneauCalques et CaptureLayers — la vraie data
  // est servie par les tiles MVT via la source vector tmja-source.
  const handleLoadTMJA = async () => {
    setTmjaGeoJSON({ type: 'FeatureCollection', features: [] });
  };

  const mapLayers = useMapLayers({ mapRef, mapReady });

  // Etat du calque de score, en REF : lu et ecrit dans la meme pile
  // synchrone que `onDegrade` (voir le deroule detaille plus bas).
  const scoreActifRef = useRef(false);

  // ── Exclusivité des dégradés de couleur (Tâche 6) — un seul à la fois
  // (lib/carte/degrades.ts). `mapLayers.basculerDegrade` porte carreaux et
  // IRIS (son état) et applique déjà leur propre extinction ; cette fonction
  // applique celle des trois dégradés qui vivent hors de `useMapLayers`
  // (indicateurs civiques, santé environnementale, météo, impressions de
  // campagne) et le toast d'exclusivité (spec §3) — quel que soit le calque
  // qui vient de s'activer.
  const onDegrade = useCallback((cible: DegradeId, next: boolean) => {
    const eteint = mapLayers.basculerDegrade(cible, next);
    if (!eteint) return;
    if (eteint === 'civic-indicateurs') setCivicVariableCode(null);
    if (eteint === 'civic-sante') setCivicHealthLayer(null);
    if (eteint === 'meteo') handleMeteoClear();
    if (eteint === 'campagne-impressions') window.dispatchEvent(new Event(SUIVI_MAP_CLEAR_EVENT));
    // Tache 12 : eteindre le score = rediffuser l'evenement avec zero score.
    //
    // `scoreActifRef` est mis a jour AVANT le dispatch, et ce n'est pas un
    // detail : `dispatchEvent` est SYNCHRONE, donc le listener `onScore`
    // ci-dessous s'executerait dans cette meme pile et rappellerait
    // `onDegrade('score', false)` — avec le `degradeActif` du DERNIER RENDU,
    // pas celui qu'on vient de poser. Deroule du defaut (relecture du
    // 2026-09-13), au depart score allume :
    //   1. l'utilisateur coche IRIS   -> setDegradeActif('iris') en file
    //   2. dispatch synchrone          -> onScore -> onDegrade('score', false)
    //   3. degradeActif y vaut encore 'score' (etat non rafraichi)
    //      -> setDegradeActif(null) en file, APRES le 'iris'
    //   4. React applique dans l'ordre : degradeActif finit a null alors
    //      qu'IRIS est affiche.
    // La legende n'annoncait donc plus rien, et le degrade suivant n'evincait
    // plus IRIS : deux chorophletes empilees, le defaut meme que la Tache 5 a
    // ferme. Poser la ref d'abord neutralise l'etape 2 par la garde de
    // transition du listener.
    if (eteint === 'score') {
      scoreActifRef.current = false;
      window.dispatchEvent(new CustomEvent(SCORE_MAP_EVENT, {
        detail: { scores: [], libelle: '', nIndicateurs: 0 } satisfies ScoreMapEventDetail,
      }));
    }
    toast.info(`${libelleDegrade(eteint)} a été masqué — un seul dégradé de couleur à la fois`);
  }, [mapLayers, handleMeteoClear, toast]);

  // Statut « campagne active » (SuiviMapLayer) — ne demande l'exclusivité
  // qu'à la transition null ⇄ non-null (jamais à chaque changement de
  // métrique, qui rediffuse aussi ce statut).
  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<SuiviMapEventDetail | null>).detail ?? null;
      const etaitActive = campagneActiveRef.current !== null;
      const estActive = detail !== null;
      campagneActiveRef.current = detail;
      setCampagneActive(detail);
      if (estActive && !etaitActive) onDegrade('campagne-impressions', true);
      if (!estActive && etaitActive) onDegrade('campagne-impressions', false);
    };
    window.addEventListener(SUIVI_MAP_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(SUIVI_MAP_STATUS_EVENT, onStatus);
  }, [onDegrade]);

  // Score composite (Tache 12) : le calque s'allume depuis PanneauAnalyse, pas
  // depuis une checkbox de calque — page.tsx doit donc apprendre son etat par
  // le meme evenement, pour appliquer l'exclusivite des degrades. Ne demande
  // la bascule qu'aux transitions, comme le statut de campagne ci-dessus.
  useEffect(() => {
    const onScore = (e: Event) => {
      const detail = (e as CustomEvent<ScoreMapEventDetail>).detail;
      const actif = Boolean(detail?.scores?.length);
      if (actif === scoreActifRef.current) return;
      scoreActifRef.current = actif;
      onDegrade('score', actif);
    };
    window.addEventListener(SCORE_MAP_EVENT, onScore);
    return () => window.removeEventListener(SCORE_MAP_EVENT, onScore);
  }, [onDegrade]);

  // Carte Diffusion (Tâche 13B) : contrairement au statut « campagne active »
  // et au score ci-dessus, aucun bus d'événements n'est nécessaire — la
  // session de campagne est un contexte React partagé (Tâche 2), lu
  // directement. Même règle « transition seulement » que les deux blocs
  // précédents (jamais à chaque changement de maille/fil d'Ariane, qui ne
  // change pas l'activation elle-même). Aucun effet de bord à l'éviction :
  // `DiffusionMapLayer` recalcule lui-même sa visibilité depuis
  // `mapLayers.degradeActif` (prop `visible` ci-dessous) et se nettoie seul.
  const diffusionActif = Boolean(campagneSession.campaignId) && campagneSession.vue === 'carte';
  useEffect(() => {
    const etaitActive = diffusionActifRef.current;
    diffusionActifRef.current = diffusionActif;
    if (diffusionActif && !etaitActive) onDegrade('diffusion', true);
    if (!diffusionActif && etaitActive) onDegrade('diffusion', false);
  }, [diffusionActif, onDegrade]);

  // Réarmement (constat 9). « Transition seulement » a une conséquence que
  // l'effet ci-dessus ne peut pas rattraper seul : une fois `diffusion`
  // ÉVINCÉ par une autre choroplèthe (cocher IRIS depuis le panneau Calques),
  // rien ne le rallume — décocher IRIS ne repasse pas par
  // `onDegrade('diffusion', true)`, et la barre de contexte continue
  // d'afficher « Diffusion » sélectionné devant une carte vide. Le geste
  // naturel — recliquer « Diffusion » alors qu'on y est déjà — ne change
  // AUCUN état de session : il arrive donc par cet événement.
  useEffect(() => {
    const onRearm = () => {
      if (!diffusionActifRef.current) return;
      onDegrade('diffusion', true);
    };
    window.addEventListener(DIFFUSION_REARM_EVENT, onRearm);
    return () => window.removeEventListener(DIFFUSION_REARM_EVENT, onRearm);
  }, [onDegrade]);

  const handleFermerCampagneActive = useCallback(() => {
    window.dispatchEvent(new Event(SUIVI_MAP_CLEAR_EVENT));
  }, []);

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
  } = useMapDirectActions(mapRef, mapLayers, setZoneData, setError, filtre);

  // ── Voronoï du panneau Analyse par la route directe (cf _hooks/useVoronoiDirect)
  const { lancerVoronoi, voronoiChargement } = useVoronoiDirect(mapLayers.applyVoronoi, setZoneData, setError);

  // ── Marqueurs POI + cadrage (cf _hooks/useMapMarkers) ─────────────────────
  useMapMarkers(mapRef, markersRef, mapReady, zoneData, densityMode, poiStyles, setSelectedBillboard);

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

    // Couches tuiles vectorielles (visibilité) et couches de la carte
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
    // Dégradé de couleur actif (Tâche 6) — reset direct, jamais via
    // `onDegrade` : un « tout effacer » n'a pas à afficher de toast d'éviction.
    mapLayers.setDegradeActif(null);
    window.dispatchEvent(new Event(SUIVI_MAP_CLEAR_EVENT));
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

  // Table de routage des quatre panneaux du rail (+ Réglages, + Aide) : plus
  // aucun ternaire `entreeActive === 'x' && (...)` dans le JSX de rendu — un
  // id se résout en un composant, un point c'est tout. « Campagne » n'y
  // figure pas : `handleEntree` (ci-dessus) ne la laisse jamais devenir
  // `entreeActive`.
  const PANNEAUX: Partial<Record<EntreeId, () => ReactNode>> = {
    filtre: () => (
      <PanneauFiltre
        filtre={filtre}
        onFiltre={setFiltre}
        scope={perimeterScope}
        onScopeChange={setPerimeterScope}
      />
    ),
    calques: () => (
      <PanneauCalques
        onAnalyserPopulation={() => setAnalysePopulation(true)}
        risqueIndustriel={risqueIndustriel}
        degradeActif={mapLayers.degradeActif}
        onDegrade={onDegrade}
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
        setIrisVisible={mapLayers.setIrisVisible}
        setIrisIndicateur={mapLayers.setIrisIndicateur}
        setIrisPalette={mapLayers.setIrisPalette}
        setIrisOpacity={mapLayers.setIrisOpacity}
        setIrisTrueOnly={mapLayers.setIrisTrueOnly}
        campagneActive={campagneActive}
        onFermerCampagneActive={handleFermerCampagneActive}
        selectedPOI={selectedPOI}
        onSelectedPOIChange={setSelectedPOI}
        onDirectSearch={handleDirectSearch}
        onPOIStylesChange={setPoiStyles}
        densityMode={densityMode}
        onDensityModeChange={(v) => { setDensityMode(v); localStorage.setItem('genesis_density_mode', String(v)); }}
        scope={perimeterScope}
        selectedRegions={perimeterSelectedRegions}
        selectedDepts={perimeterSelectedDepts}
        ville={perimeterVille}
        onDirectOOH={handleDirectOOH}
        onLoadTransport={handleLoadTransport}
        onLoadTMJA={handleLoadTMJA}
        tmjaVisible={!!tmjaGeoJSON}
        onClearTMJA={() => setTmjaGeoJSON(null)}
        tmjaHideLowTraffic={tmjaHideLowTraffic}
        onToggleTmjaHideLowTraffic={setTmjaHideLowTraffic}
        radioVisible={radioVisible}
        onToggleRadio={() => setRadioVisible(v => !v)}
        radioHeatmapMode={radioHeatmapMode}
        onToggleRadioHeatmap={() => setRadioHeatmapMode(v => !v)}
        radioCoverageMode={radioCoverageMode}
        onToggleRadioCoverage={() => setRadioCoverageMode(v => !v)}
        radioLoading={radioLoading}
        radioSystemeFilter={radioSystemeFilter}
        onRadioSystemeChange={v => setRadioSystemeFilter(v)}
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
        civicVariableCode={civicVariableCode}
        onCivicVariableChange={setCivicVariableCode}
        selectedIrisCommuneCode={selectedIrisData?.code_commune ?? null}
        selectedIrisCommuneName={selectedIrisData?.nom_commune ?? null}
        civicHealthLayer={civicHealthLayer}
        onCivicHealthLayerChange={layer => {
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
        onOpenMeteo={() => setMeteoPanelOpen(true)}
        onClearMeteo={() => { onDegrade('meteo', false); handleMeteoClear(); }}
        meteoVisible={meteoVisible}
        meteoLabel={meteo.meta ? METEO_LABEL[meteo.meta.variable] : null}
      />
    ),
    analyse: () => (
      <PanneauAnalyse
        scope={perimeterScope}
        onScopeChange={setPerimeterScope}
        selectedRegions={perimeterSelectedRegions}
        onSelectedRegionsChange={setPerimeterSelectedRegions}
        selectedDepts={perimeterSelectedDepts}
        onSelectedDeptsChange={setPerimeterSelectedDepts}
        ville={perimeterVille}
        onVilleChange={setPerimeterVille}
        filtre={filtre}
        selectedPOI={selectedPOI}
        onDirectVoronoi={lancerVoronoi}
        voronoiChargement={voronoiChargement}
        onDirectBattle={handleDirectBattle}
        onDirectBattleV2={handleDirectBattleV2}
        onFillIsochroneCache={handleFillIsochroneCache}
        onApplyBattle={handleApplyBattle}
        voronoiVisible={mapLayers.voronoiVisible}
        setVoronoiVisible={mapLayers.setVoronoiVisible}
        battleVisible={mapLayers.battleVisible}
        setBattleVisible={mapLayers.setBattleVisible}
        battleOuterFillVisible={mapLayers.battleOuterFillVisible}
        setBattleOuterFillVisible={mapLayers.setBattleOuterFillVisible}
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
        onFlyTo={handleFlyTo}
      />
    ),
    zones: () => (
      <PanneauZones
        mapRef={mapRef}
        onLoadedZonesChange={handleLoadedZonesChange}
        onOuvrirJeu={ouvrirJeuDeZones}
      />
    ),
    reglages: () => (
      <SettingsOverlay
        mapStyles={MAP_STYLES as unknown as { id: string; label: string; url: string }[]}
        currentMapStyleUrl={mapStyleUrl}
        onMapStyleChange={handleMapStyleChange}
      />
    ),
    aide: () => <HelpOverlay />,
  };

  // Définition de l'entrée active — source unique pour savoir OÙ elle
  // s'affiche (round de correction 1, Tâche 8) : lire `type` depuis
  // `ENTREES_NAVIGATION` au lieu de comparer un id en dur.
  const entreeActiveDef = entreeActive ? ENTREES_NAVIGATION.find(e => e.id === entreeActive) : undefined;

  // Décalage horizontal des boutons flottants de la carte (immersif, tout
  // effacer, script bidding, rouvrir le plan média) : ils s'écartent du
  // plan média (`PANEL_WIDTH`, ancré `right: 0`). Plafonné à
  // `calc(100vw - 60px)` (round de correction 1) pour un écran étroit. Le
  // tiroir droit de l'Assistant, qui s'y ajoutait, est retiré (2026-10-12).
  const railBoutonsRight = `min(${
    10
    + (planPanelOpen && planZones.length ? PANEL_WIDTH + 10 : 0)
  }px, calc(100vw - 60px))`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', background: 'var(--bg-primary)',
      paddingLeft: railMasque ? 0 : LARGEUR_RAIL,
      paddingTop: railMasque ? 0 : MAP_TOPBAR_HEIGHT,
      transition: 'padding-left 200ms var(--ease-out), padding-top 200ms var(--ease-out)',
    }}>
      {!railMasque && <MapTopBar />}
      {/* Barre de contexte commune aux deux vues de Suivi V2 (Tâche 15) — ne
          se montre qu'en vue carte : en vue suivi, la MÊME barre vit en tête
          de `SuiviV2`, dans l'overlay MAGELIAN. `zIndex` au-dessus de
          `CampagneActiveCard` (34) : les deux s'ancrent au même endroit
          (top-gauche sous la top bar) — `CampagneActiveCard` est donc masquée
          ci-dessous tant que cette barre est affichée, plutôt que de laisser
          son texte disparaître derrière un panneau opaque (constaté à
          l'écran, Tâche 15). `FiltreChip` (z 35, sous la top bar) reste
          affiché, mais DÉCALÉ vers le bas de la hauteur réelle de cette barre
          (`hauteurBarreContexte`, mesurée) : la collision était réelle — le
          chip passait intégralement dessous et sa croix « Retirer le filtre »
          devenait inatteignable (constat 4 de la relecture d'interface). */}
      {monte && campagneSession.vue === 'carte' && (
        <div ref={barreContexteRef} style={{
          position: 'fixed', top: railMasque ? 0 : MAP_TOPBAR_HEIGHT,
          left: railMasque ? 0 : LARGEUR_RAIL, right: 0, zIndex: 46,
        }}>
          <BarreContexteCampagne />
        </div>
      )}
      <RailNavigation
        entreeActive={entreeActive}
        onEntree={handleEntree}
        masque={railMasque}
        badgeAlertes={0 /* source du compte d'alertes : viendra avec l'onglet Suivi */}
        pastille={filtre !== null}
      />
      <FiltreChip
        filtre={filtre}
        onRetirer={() => setFiltre(retirerFiltre())}
        decalageHaut={monte && campagneSession.vue === 'carte' ? hauteurBarreContexte : 0}
      />
      {!(monte && campagneSession.vue === 'carte') && <CampagneActiveCard />}
      {entreeActive && entreeActiveDef?.type === 'panneau-gauche' && (
        <OverlayPanel
          topOffset={railMasque ? 0 : MAP_TOPBAR_HEIGHT}
          category={entreeActive}
          title={entreeActiveDef.label}
          dotColor={DOT_PAR_ENTREE[entreeActive] ?? 'var(--text-tertiary)'}
          onClose={() => setEntreeActive(null)}
        >
          {PANNEAUX[entreeActive]?.()}
        </OverlayPanel>
      )}
      <CivicIndicatorsLayer mapRef={mapRef} variableCode={civicVariableCode} />
      <RisqueIndustrielLayer
        mapRef={mapRef}
        actif={risqueIndustriel.actif}
        filtres={risqueIndustriel.filtres}
        onCompte={risqueIndustriel.setCompte}
      />
      {/* Perimetres PPRT : couche INDEPENDANTE du rayon calcule ci-dessus.
          Une servitude opposable et un cercle de notre invention ne se
          pilotent pas par le meme interrupteur. */}
      {/* Overlay plein ecran : monte ICI et non dans le panneau Calques, pour
          qu'il survive a la fermeture de celui-ci. Il herite des filtres deja
          coches — on ne redemande pas ce a quoi l'utilisateur vient de
          repondre dans le panneau. */}
      {analysePopulation && (
      <AnalysePopulationOverlay
        onFermer={() => setAnalysePopulation(false)}
        gravites={risqueIndustriel.niveaux}
        typesRisque={risqueIndustriel.typesRisque}
      />
      )}

      <PprtLayer
        mapRef={mapRef}
        actif={risqueIndustriel.pprtActif}
        typesZone={risqueIndustriel.pprtTypes}
        onEtat={risqueIndustriel.setPprtEtat}
      />
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
            right: railBoutonsRight,
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
        filtre={filtre}
        onProgress={(done, total) => setCivicProgress({ done, total })}
        onCpDataStatus={(status, date) => { setCivicCpStatus(status); setCivicCpDate(date); }}
        onLoadingChange={setCivicLoading}
      />
      <SuiviMapLayer mapRef={mapRef} />
      <DiffusionMapLayer
        mapRef={mapRef}
        mapReady={mapReady}
        visible={diffusionActif && mapLayers.degradeActif === 'diffusion'}
      />
      <ScoreMapLayer mapRef={mapRef} />
      {/* Les zones de risque s'allument par CustomEvent depuis l'overlay, qui
          vit dans une autre branche de l'arbre React — meme chemin que
          ScoreMapLayer ci-dessus. */}
      <ZonesRisqueLayer mapRef={mapRef} />
      <LegendeCarte
        degradeActif={mapLayers.degradeActif}
        carreauxIndicateur={mapLayers.carreauxIndicateur}
        carreauxPalette={mapLayers.carreauxPalette}
        carreauxRange={mapLayers.carreauxRange}
        carreauxSelectedBucket={mapLayers.carreauxSelectedBucket}
        setCarreauxSelectedBucket={mapLayers.setCarreauxSelectedBucket}
        irisPalette={mapLayers.irisPalette}
        irisBornes={mapLayers.irisBornes}
        civicVariableCode={civicVariableCode}
        civicHealthLayer={civicHealthLayer}
        civicMinLevel={civicMinLevel}
        meteoLabel={meteo.meta ? METEO_LABEL[meteo.meta.variable] : null}
        campagneActive={campagneActive}
        selectedPOI={selectedPOI}
        tmjaVisible={!!tmjaGeoJSON}
        tmjaHideLowTraffic={tmjaHideLowTraffic}
        radioVisible={radioVisible}
        radioCoverageColor={radioCoverageColor}
        risquesActif={risqueIndustriel.actif}
        risquesRayonM={risqueIndustriel.rayonM}
        pprtActif={risqueIndustriel.pprtActif}
        risquesCompte={risqueIndustriel.compte}
        zoneData={zoneData}
        activeCats={activeCats}
        isochroneVisible={mapLayers.isochroneVisible}
        isochroneMinutes={mapLayers.isochroneMinutes}
        isochroneMode={mapLayers.isochroneMode}
        voronoiVisible={mapLayers.voronoiVisible}
        voronoiCategory={mapLayers.voronoiCategory}
        voronoiPois={mapLayers.voronoiPois}
        voronoiDataRef={mapLayers.voronoiDataRef}
        battleVisible={mapLayers.battleVisible}
        battleCategory={mapLayers.battleCategory}
        battlePois={mapLayers.battlePois}
        battleMaxPalier={mapLayers.battleMaxPalier}
        setBattleMaxPalier={mapLayers.setBattleMaxPalier}
      />
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

        {/* Erreurs des actions directes et du Voronoï (ex-ChatPanel) */}
        {/* En bas au centre : ni le panneau (en haut à gauche), ni la légende (en bas à gauche), ni les contrôles (à droite) ne le recouvrent. */}
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', width: 'min(560px, calc(100% - 520px))', minWidth: 280, zIndex: 40 }}>
          <BandeauErreur message={error} onFermer={() => setError(null)} />
        </div>

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
              right: railBoutonsRight,
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
              right: railBoutonsRight,
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
                right: railBoutonsRight,
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
        isochroneVisible={mapLayers.isochroneVisible}
        isochroneMinutes={mapLayers.isochroneMinutes}
        isochroneMode={mapLayers.isochroneMode}
        isochroneFromCache={mapLayers.isochroneFromCache}
        isochroneCachedAt={mapLayers.isochroneCachedAt}
        setIsochroneVisible={mapLayers.setIsochroneVisible}
        voronoiVisible={mapLayers.voronoiVisible}
        voronoiCategory={mapLayers.voronoiCategory}
        setVoronoiVisible={mapLayers.setVoronoiVisible}
        battleVisible={mapLayers.battleVisible}
        battleCategory={mapLayers.battleCategory}
        setBattleVisible={mapLayers.setBattleVisible}
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
                if (ok) {
                  // Exclusivité des dégradés (Tâche 6) : la météo devient le
                  // dégradé actif, évince l'ancien (toast) si besoin.
                  onDegrade('meteo', true);
                  setMeteoPanelOpen(false);
                }
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
