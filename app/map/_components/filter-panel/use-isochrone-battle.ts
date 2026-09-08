/**
 * @file filter-panel/use-isochrone-battle.ts — outils isochrones et bataille
 *
 * Extrait de FilterPanel.tsx (2026-09-08). Regroupe l'etat et les actions des
 * trois outils d'analyse spatiale batis sur les isochrones ORS :
 *   - verification du cache (partagee ORS et V2) ;
 *   - remplissage du cache manquant, puis enchainement automatique sur V2 ;
 *   - bataille V1 (isochrones multi-paliers) et V2 (decoupe sans chevauchement).
 *
 * Les journaux sont volontairement mis a jour "en place" : la ligne de
 * progression ORS et la ligne de comptage d'anneaux sont remplacees plutot
 * qu'empilees, sinon un import long noie l'ecran sous des milliers de lignes.
 *
 * Le ticker de `handleBattle` (1 s) n'est pas cosmetique : l'appel ORS peut
 * durer 30 a 120 s sans aucun retour intermediaire, et l'utilisateur doit voir
 * que le traitement avance. Il est toujours nettoye dans le `finally`.
 *
 * Regle metier conservee : quand TOUTES les regions sont selectionnees, aucun
 * filtre region n'est envoye — sinon la comparaison en base ne matche pas.
 */
import { useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import type { DirectBattleParams, FilterPanelProps } from './types';

export interface CacheStatusValue {
  total_pois: number;
  total_combos: number;
  cached_combos: number;
  missing_combos: number;
  missing_pois: number;
  cached_pois: number;
}
export type CacheStatus = CacheStatusValue | null;

export interface IsochroneBattleParams {
  /** Categories POI selectionnees — les outils exigent une seule categorie. */
  selectedPOI: string[];
  exactlyOnePOI: boolean;
  ville: string;
  selectedRegions: string[];
  selectedDepts: string[];
  /** Referentiel regions, pour le libelle de territoire et la regle "toutes". */
  refRegions: { code_region: string; nom_region: string }[];
  onDirectBattle: FilterPanelProps['onDirectBattle'];
  onDirectBattleV2: FilterPanelProps['onDirectBattleV2'];
  onFillIsochroneCache: FilterPanelProps['onFillIsochroneCache'];
}

export function useIsochroneBattle({
  selectedPOI, exactlyOnePOI, ville, selectedRegions, selectedDepts,
  refRegions: REF_REGIONS,
  onDirectBattle, onDirectBattleV2, onFillIsochroneCache,
}: IsochroneBattleParams) {
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

  const toggleDuration = (d: number) => {
    setOrsCacheStatus(null);
    setIsoDurations(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b));
  };

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

  return {
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
  };
}
