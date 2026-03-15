'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type { ZoneData } from '@/types/spatial';
import { CoverageProgress } from '@/app/components/CoverageProgress';

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
  muted:     '#4b5563',
  textDim:   '#6b7280',
  text:      '#e2e8f0',
};
const fMono     = "'JetBrains Mono','Fira Mono',monospace";
const fMichroma = "'Michroma','Orbitron',sans-serif";
const fOrbitron = "'Orbitron',sans-serif";

// ─── Données géographiques ─────────────────────────────────────────────────────
import {
  REGIONS_ADMIN as REGIONS, ALL_DEPTS,
  POI_TYPES, AUDIENCE_METRICS,
  ISO_MODES, ISO_DURATIONS,
} from '@/lib/geo/france-admin';

type Tab = 'territoire' | 'audience' | 'analyses';

// ─── Props ────────────────────────────────────────────────────────────────────
export interface DirectPOISearchParams {
  poi_types: string[];
  scope: 'metro' | 'all' | null;
  regions: string[];
  depts: string[];
  ville: string;
  rayon_poi: string | null;
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


export interface FilterPanelProps {
  sendMessage: (text: string) => void;
  onDirectSearch:  (params: DirectPOISearchParams) => Promise<void>;
  onDirectBattle:  (params: DirectBattleParams, onProgress?: (msg: string) => void) => Promise<{ geometry: string; nb_pois: number }>;
  isLoading: boolean;
  error: string | null;
  zoneData: ZoneData | null;
  loadCarreauxFromAI: (cd: import('@/types/spatial').CarreauxData) => Promise<void>;
  carreauxVisible: boolean;
  carreauxLoaded: boolean;
  carreauxLabel: string;
  setCarreauxVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  voronoiVisible: boolean;
  setVoronoiVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  battleVisible: boolean;
  setBattleVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  isochroneVisible: boolean;
  setIsochroneVisible: (v: boolean) => void;
  setShowSavePanel: (v: boolean | ((p: boolean) => boolean)) => void;
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
  sendMessage, onDirectSearch, onDirectBattle, isLoading, error, zoneData, loadCarreauxFromAI,
  carreauxVisible, carreauxLoaded, carreauxLabel, setCarreauxVisible,
  voronoiVisible, setVoronoiVisible,
  battleVisible, setBattleVisible,
  isochroneVisible, setIsochroneVisible,
  setShowSavePanel,
}: FilterPanelProps) {

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('territoire');

  // ── Territoire state ──────────────────────────────────────────────────────
  const [scope,           setScope]           = useState<'metro' | 'all' | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDepts,   setSelectedDepts]   = useState<string[]>([]);
  const [ville,           setVille]           = useState('');
  const [codePostal,      setCodePostal]      = useState('');

  // ── Audience state ────────────────────────────────────────────────────────
  const [audienceActive, setAudienceActive] = useState(false);
  const [audienceMetric, setAudienceMetric] = useState('ind_18_24');
  const [resolution,     setResolution]     = useState<'200m' | '1km'>('200m');

  // ── Analyses state ────────────────────────────────────────────────────────
  const [selectedPOI,   setSelectedPOI]   = useState<string[]>([]);
  const [poisRayon,     setPoisRayon]     = useState<string | null>(null);
  const [showVoronoi,      setShowVoronoi]      = useState(false);
  const [showBattle,       setShowBattle]       = useState(false);
  const [transportMode,    setTransportMode]    = useState('driving-car');
  const [isoDurations,     setIsoDurations]     = useState<number[]>([10, 30]);

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

  const toggleDuration = (d: number) =>
    setIsoDurations(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b));

  const modeLabel = (id: string) => ISO_MODES.find(m => m.id === id)?.label ?? id;

  // ── Actions ───────────────────────────────────────────────────────────────
  const send = (text: string) => { if (!isLoading) sendMessage(text); };

  const handleAudienceApply = () => {
    const metric = AUDIENCE_METRICS.find(m => m.id === audienceMetric);
    const label  = metric?.label ?? audienceMetric;
    if (zoneData?.coordonnees) {
      loadCarreauxFromAI({ action: 'afficher_carreaux', indicateur: audienceMetric, indicateur_label: label, coordonnees: zoneData.coordonnees, resolution });
    } else {
      send(`Montre les ${label} ${territoire}${resolution === '1km' ? ' en résolution 1km' : ''}`);
    }
  };

  const [searchLoading,    setSearchLoading]    = useState(false);
  const [battleLoading,    setBattleLoading]    = useState(false);
  const [battleLog,        setBattleLog]        = useState<string[]>([]);
  const [battleGeometry,   setBattleGeometry]   = useState<string>('');
  const [battleMeta,       setBattleMeta]       = useState<{ categorie: string; mode: string } | null>(null);
  const [battlePoiGroups,  setBattlePoiGroups]  = useState<{ id: string; nom: string; geometries: string[] }[]>([]);
  const [coverageJobId,    setCoverageJobId]    = useState<string | null>(null);
  const [coverageLoading,  setCoverageLoading]  = useState(false);
  const [coverageError,    setCoverageError]    = useState<string | null>(null);
  const [breakdown,        setBreakdown]        = useState<{ id: string; nom: string; coverage: number }[] | null>(null);
  const [breakdownMetric,  setBreakdownMetric]  = useState<string>('');
  const battleTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const battleStartRef   = useRef<number>(0);

  const launchCoverageCalculation = async (metric: string) => {
    if (!battleGeometry || !battleMeta || coverageLoading) return;
    setCoverageJobId(null);
    setCoverageError(null);
    setBreakdown(null);
    setBreakdownMetric(metric);
    setCoverageLoading(true);
    try {
      // Calcul total dédupliqué — lit isochrones depuis isochrones_cache en DB
      const res = await fetch('/api/coverage-jobs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          categorie:          battleMeta.categorie,
          mode:               battleMeta.mode,
          target_column:      metric,
          poi_count:          battlePoiGroups.length,
          isochrone_duration: isoDurations.length > 0 ? Math.max(...isoDurations) : 30,
        }),
      });
      const data = await res.json();
      if (data.jobId) {
        setCoverageJobId(data.jobId);
      } else {
        setCoverageError(data.error ?? 'Erreur inconnue');
      }
      // Calcul détail par POI (en parallèle, résultat indépendant)
      if (battlePoiGroups.length > 0) {
        fetch('/api/coverage-breakdown', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ poiGroups: battlePoiGroups, metric }),
        })
          .then(r => r.json())
          .then(d => { if (d.results) setBreakdown(d.results); })
          .catch(() => {});
      }
    } catch (e: any) {
      setCoverageError(e.message ?? 'Erreur réseau');
    } finally {
      setCoverageLoading(false);
    }
  };

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

  const handleBattle = async (force = false) => {
    if (!exactlyOnePOI || isoDurations.length === 0 || battleLoading) return;
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
      const { geometry: mergedGeometry, nb_pois } = await onDirectBattle(params, (msg: string) => {
        setBattleLog(prev => {
          // Remplacer la dernière ligne de progression en-place, sinon ajouter
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].includes('POIs traités') || prev[i].includes('POIs trouvés')) {
              return [...prev.slice(0, i), msg, ...prev.slice(i + 1)];
            }
          }
          return [...prev, msg];
        });
      });
      const elapsed = ((Date.now() - battleStartRef.current) / 1000).toFixed(1);
      setBattleLog(prev => [...prev, `> ✓ ${nb_pois} POIs — isochrones affichés (${elapsed}s)`]);
      setBattleGeometry(mergedGeometry);
      setBattleMeta({ categorie: params.category, mode: params.mode });
      setBattlePoiGroups([]);
      setCoverageJobId(null);
      setBreakdown(null);
    } catch (e: any) {
      const msg = e?.message ?? 'erreur inconnue';
      setBattleLog(prev => [...prev, `> ✕ ${msg}`]);
    } finally {
      if (battleTimerRef.current) { clearInterval(battleTimerRef.current); battleTimerRef.current = null; }
      setBattleLoading(false);
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
    color: C.textDim, marginBottom: 6, textTransform: 'uppercase' as const,
  };

  const inputStyle = {
    fontFamily: fMono, fontSize: 11, background: C.bgInput,
    border: `1px solid ${C.border}`, borderRadius: 2,
    color: C.text, padding: '7px 10px', outline: 'none', width: '100%',
  };

  // ── Tab config ────────────────────────────────────────────────────────────
  const TABS: { id: Tab; label: string; shortLabel: string; color: string; badge?: number }[] = [
    { id: 'territoire', label: 'TERRITOIRE', shortLabel: 'ZONE',     color: C.green,  badge: hasTerritoire ? 1 : 0 },
    { id: 'audience',   label: 'AUDIENCE',   shortLabel: 'DATA',     color: C.amber,  badge: audienceActive ? 1 : 0 },
    { id: 'analyses',   label: 'ANALYSES',   shortLabel: 'POI',      color: C.accent, badge: selectedPOI.length },
  ];

  return (
    <div style={{
      width: 300, minWidth: 300, height: '100%',
      background: C.bgPanel, borderRight: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 16px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: fOrbitron, fontSize: 13, letterSpacing: '0.08em' }}>
          <span style={{ color: C.muted }}>geo</span>
          <span style={{ color: C.accent }}>.</span>
          <span style={{ color: C.text }}>filter</span>
        </div>
        <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.muted, letterSpacing: '0.18em', marginTop: 2 }}>
          MEDIA PLANNING — FILTRES AVANCES
        </div>
      </div>

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

      {/* ── Tab navigation ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: '10px 4px 9px',
                background: active ? `rgba(${hexToRgb(tab.color)},0.07)` : 'none',
                border: 'none',
                borderBottom: active ? `2px solid ${tab.color}` : '2px solid transparent',
                cursor: 'pointer', position: 'relative',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.14em', color: active ? tab.color : C.muted, transition: 'color 0.15s' }}>
                {tab.label}
              </div>
              {(tab.badge ?? 0) > 0 && (
                <div style={{
                  position: 'absolute', top: 6, right: 8,
                  width: 5, height: 5, borderRadius: '50%',
                  background: tab.color,
                  boxShadow: `0 0 6px ${tab.color}`,
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ════════════════════════════════════════
            ONGLET 1 — TERRITOIRE
        ════════════════════════════════════════ */}
        {activeTab === 'territoire' && (
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
            ONGLET 2 — AUDIENCE
        ════════════════════════════════════════ */}
        {activeTab === 'audience' && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Toggle population */}
            <button
              onClick={() => setAudienceActive(a => !a)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '11px 13px', cursor: 'pointer',
                background: audienceActive ? C.amberDim : C.bgInput,
                border: `1px solid ${audienceActive ? C.amber : C.border}`, borderRadius: 2,
                transition: 'all 0.2s',
              }}
            >
              {/* Toggle switch */}
              <div style={{ width: 32, height: 17, borderRadius: 9, background: audienceActive ? C.amber : C.muted, position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 2.5, borderRadius: '50%', width: 12, height: 12, background: '#fff', left: audienceActive ? 17 : 3, transition: 'left 0.2s' }} />
              </div>
              <div>
                <div style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.1em', color: audienceActive ? C.amber : C.textDim }}>
                  POPULATION (CARREAUX INSEE)
                </div>
                <div style={{ fontFamily: fMono, fontSize: 10, color: C.muted, marginTop: 2 }}>
                  Grille Filosofi — 200m / 1km
                </div>
              </div>
            </button>

            {/* Options (visible when active) */}
            {audienceActive && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Résolution */}
                <div>
                  <div style={labelStyle}>RESOLUTION DE LA GRILLE</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['200m', '1km'] as const).map(r => (
                      <button key={r} style={{ ...pill(resolution === r, C.amber), flex: 1, textAlign: 'center' }} onClick={() => setResolution(r)}>
                        {r === '200m' ? '200m — Precis' : '1km — Large'}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, marginTop: 5, fontStyle: 'italic' }}>
                    {resolution === '200m' ? 'Ideal zones urbaines denses' : 'Ideal zones rurales / regionales'}
                  </div>
                </div>

                <div style={{ height: 1, background: C.border }} />

                {/* Métrique */}
                <div>
                  <div style={labelStyle}>METRIQUE DEMOGRAPHIQUE</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {AUDIENCE_METRICS.map(m => (
                      <button key={m.id}
                        onClick={() => setAudienceMetric(m.id)}
                        style={{
                          width: '100%', textAlign: 'left', padding: '8px 11px',
                          background: audienceMetric === m.id ? C.amberDim : 'none',
                          border: `1px solid ${audienceMetric === m.id ? C.amber : C.border}`,
                          borderRadius: 2, cursor: 'pointer', fontFamily: fMono, fontSize: 11,
                          color: audienceMetric === m.id ? C.amber : C.textDim,
                          display: 'flex', alignItems: 'center', gap: 9, transition: 'all 0.12s',
                        }}
                      >
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: audienceMetric === m.id ? C.amber : C.muted, flexShrink: 0, transition: 'background 0.15s' }} />
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Apply button */}
                <button style={primaryBtn(C.amber, isLoading)} disabled={isLoading} onClick={handleAudienceApply}>
                  {isLoading ? 'CHARGEMENT...' : 'AFFICHER LA COUCHE'}
                </button>

                {carreauxLoaded && (
                  <button
                    style={pill(carreauxVisible, C.amber)}
                    onClick={() => setCarreauxVisible(v => !v)}
                  >
                    {carreauxVisible ? '✓ Couche visible' : 'Couche masquee'} — {carreauxLabel}
                  </button>
                )}

                {!hasTerritoire && (
                  <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, fontStyle: 'italic' }}>
                    Sans territoire — centré sur la derniere zone visitée
                  </div>
                )}
              </div>
            )}

            {!audienceActive && (
              <div style={{ padding: '14px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, borderRadius: 2 }}>
                <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.muted, letterSpacing: '0.12em', marginBottom: 6 }}>A PROPOS DE CETTE COUCHE</div>
                <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim, lineHeight: 1.6 }}>
                  Superpose une grille de carreaux 200m ou 1km colorée par densité demographique (source INSEE Filosofi 2021) sur la carte.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════
            ONGLET 3 — ANALYSES & POI
        ════════════════════════════════════════ */}
        {activeTab === 'analyses' && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Sélection POI */}
            <div>
              <div style={labelStyle}>
                TYPES DE POI
                {selectedPOI.length > 0 && <span style={{ color: C.accent }}> — {selectedPOI.length} selectionne{selectedPOI.length > 1 ? 's' : ''}</span>}
              </div>
              <MultiDropdown
                label="Aucun type selectionne"
                items={POI_TYPES.map(p => ({ id: p.id, label: p.label }))}
                selected={selectedPOI}
                onChange={setSelectedPOI}
              />
              {/* Pills sélectionnés */}
              {selectedPOI.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                  {selectedPOI.map(poi => (
                    <button key={poi} onClick={() => setSelectedPOI(prev => prev.filter(p => p !== poi))}
                      style={{ ...pill(true, C.accent), display: 'flex', alignItems: 'center', gap: 5 }}>
                      {poi} <span style={{ color: C.muted, fontSize: 7 }}>✕</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* AFFICHER button */}
            {hasAnyPOI && (
              <button style={primaryBtn(C.green, searchLoading)} disabled={searchLoading} onClick={handleSearchPOI}>
                {searchLoading ? 'CHARGEMENT...' : 'AFFICHER LES POI SUR LA CARTE'}
              </button>
            )}

            {/* Divider */}
            {hasAnyPOI && <div style={{ height: 1, background: C.border }} />}

            {/* ── SPATIAL ANALYSIS SECTION ──────────────────── */}
            <div>
              <div style={labelStyle}>ANALYSE SPATIALE</div>

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

                  {/* Voronoï Géométrique */}
                  <button
                    style={primaryBtn('#a78bfa', isLoading)}
                    disabled={isLoading}
                    onClick={() => { setShowVoronoi(s => !s); setShowBattle(false); }}
                  >
                    {voronoiVisible ? '✓ ' : ''}{showVoronoi ? '▲ ' : '▼ '}VORONOI GEOMETRIQUE
                  </button>
                  {showVoronoi && (
                    <div style={{ padding: '12px', background: 'rgba(167,139,250,0.06)', border: `1px solid rgba(167,139,250,0.22)`, borderRadius: 2, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontFamily: fMono, fontSize: 10, color: C.violet, lineHeight: 1.5 }}>
                        Chaque zone appartient au <span style={{ color: '#fff' }}>{selectedPOI[0]}</span> le plus proche à vol d'oiseau. Instantané, sans API.
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

                  {/* Isochrones Routiers */}
                  <button
                    style={primaryBtn(C.red, battleLoading)}
                    disabled={battleLoading}
                    onClick={() => { setShowBattle(s => !s); setShowVoronoi(false); }}
                  >
                    {battleVisible ? '✓ ' : ''}{showBattle ? '▲ ' : '▼ '}ISOCHRONES ROUTIERS (ORS)
                  </button>
                  {showBattle && (
                    <div style={{ padding: '13px', background: 'rgba(248,113,113,0.05)', border: `1px solid rgba(248,113,113,0.2)`, borderRadius: 2, display: 'flex', flexDirection: 'column', gap: 13 }}>

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

                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          style={primaryBtn(C.red, isoDurations.length === 0 || battleLoading)}
                          disabled={isoDurations.length === 0 || battleLoading}
                          onClick={() => handleBattle(false)}
                        >
                          {battleLoading ? 'CALCUL ORS...' : 'UTILISER LE CACHE'}
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
                        <div style={{
                          background: '#020205', border: `1px solid rgba(248,113,113,0.25)`,
                          borderRadius: 2, padding: '8px 10px', fontFamily: fMono, fontSize: 9,
                          color: '#9ca3af', lineHeight: 1.7, maxHeight: 140, overflowY: 'auto',
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
                      )}

                      {battleVisible && (
                        <button style={pill(false, C.red)} onClick={() => { setBattleVisible(false); setBattleLog([]); }}>
                          Masquer les isochrones
                        </button>
                      )}

                      {/* ── Couverture audience ──────────────────────────── */}
                      {battleGeometry.length > 0 && !battleLoading && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                          <div style={{ fontFamily: fMichroma, fontSize: 8, color: C.amber, letterSpacing: '0.14em' }}>
                            AUDIENCE DÉDUPLIQUÉE
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {[
                              { id: 'ind',       label: 'Population totale' },
                              { id: 'ind_18_24', label: '18-24 ans' },
                              { id: 'ind_25_39', label: '25-39 ans' },
                              { id: 'ind_40_54', label: '40-54 ans' },
                            ].map(m => (
                              <button
                                key={m.id}
                                style={pill(true, C.amber)}
                                onClick={() => launchCoverageCalculation(m.id)}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                          <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, fontStyle: 'italic' }}>
                            {coverageLoading ? 'Envoi du job...' : `${battleGeometry.length} isochrone(s) — calcul PostGIS asynchrone`}
                          </div>
                          {coverageError && (
                            <div style={{ fontFamily: fMono, fontSize: 9, color: C.red }}>
                              ✕ {coverageError}
                            </div>
                          )}
                          {coverageJobId && (
                            <CoverageProgress
                              jobId={coverageJobId}
                              onClose={() => setCoverageJobId(null)}
                            />
                          )}
                          {/* Détail par POI */}
                          {breakdown && breakdown.length > 0 && (
                            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 0 }}>
                              <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.amber, letterSpacing: '0.14em', marginBottom: 6 }}>
                                DÉTAIL PAR POI — {AUDIENCE_METRICS.find(m => m.id === breakdownMetric)?.label ?? breakdownMetric}
                              </div>
                              <div style={{ maxHeight: 220, overflowY: 'auto', scrollbarWidth: 'none' as const }}>
                                {breakdown.map((row, i) => (
                                  <div key={row.id} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '4px 8px',
                                    background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                                    borderLeft: `2px solid ${i === 0 ? C.amber : C.border}`,
                                  }}>
                                    <div style={{ fontFamily: fMono, fontSize: 9, color: i === 0 ? C.text : C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                                      {i === 0 ? '▶ ' : `${i + 1}. `}{row.nom}
                                    </div>
                                    <div style={{ fontFamily: fMono, fontSize: 10, color: i === 0 ? C.amber : C.textDim, flexShrink: 0 }}>
                                      {Math.round(row.coverage).toLocaleString('fr-FR')}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>

          </div>
        )}

      </div>

      {/* ── Footer actions ────────────────────────────────────────────────── */}
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
      `}</style>
    </div>
  );
}
