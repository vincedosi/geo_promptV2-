'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { REGIONS_ADMIN } from '@/lib/geo/france-admin';
import {
  FEATURE_THEMES, FEATURE_PRESETS, FEATURE_LABELS,
  ALL_FEATURES, ALL_THEME_IDS, featureSelectionLabel,
  type ThemeId,
} from '@/lib/clustering/feature-themes';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:        '#050505',
  bgPanel:   '#08080f',
  bgInput:   '#0a0a14',
  border:    '#261a35',
  accent:    '#a855f7',
  accentDim: 'rgba(168,85,247,0.10)',
  green:     '#3dffa0',
  greenDim:  'rgba(61,255,160,0.08)',
  amber:     '#f59e0b',
  amberDim:  'rgba(245,158,11,0.08)',
  red:       '#f87171',
  redDim:    'rgba(248,113,113,0.07)',
  muted:     '#8888aa',
  text:      '#e2e8f0',
  textDim:   '#6b7280',
};
const fMono     = "'JetBrains Mono','Fira Mono',monospace";
const fMichroma = "'Michroma','Orbitron',sans-serif";
const fOrbitron = "'Orbitron',sans-serif";

// DROM-COM dept codes → excluded when metropolitaine = true
const DROM_DEPTS = new Set(['971', '972', '973', '974', '975', '976']);

// ─── Types ─────────────────────────────────────────────────────────────────────
interface PoiTypeEntry { type: string; total: number; clustered: number; has_clusters: boolean; }

interface GeoFilter {
  metropolitaine: boolean;
  regions:        string[];   // region IDs
  depts:          string[];   // dept codes derived from selected regions + dep direct
}

interface WizardParams {
  duration:  number;
  transport: 'drive' | 'walk' | 'bike';
  force_k?:  number;
  dry_run:   boolean;
}

export interface ClusteringWizardProps {
  onClose:      () => void;
  onJobStarted: (jobId: string) => void;
  /** Called with POI type codes + bounding box to highlight on map */
  onHighlight?: (poiTypes: string[], metropolitaine: boolean) => void;
}

// ─── Step indicator ─────────────────────────────────────────────────────────────
function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div style={{
      width: 24, height: 24, borderRadius: 2, border: `1px solid ${done ? C.green : active ? C.accent : C.border}`,
      background: done ? C.greenDim : active ? C.accentDim : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: fMono, fontSize: 10, color: done ? C.green : active ? C.accent : C.muted,
      flexShrink: 0,
    }}>
      {done ? '✓' : n}
    </div>
  );
}

// ─── Main Wizard ───────────────────────────────────────────────────────────────
export function ClusteringWizard({ onClose, onJobStarted, onHighlight }: ClusteringWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 — POI types
  const [poiTypes,         setPoiTypes]         = useState<PoiTypeEntry[]>([]);
  const [selectedTypes,    setSelectedTypes]     = useState<string[]>([]);
  const [typesLoading,     setTypesLoading]      = useState(true);

  // Step 2 — Geo filter
  const [metropolitaine,   setMetropolitaine]    = useState(true);
  const [selectedRegions,  setSelectedRegions]   = useState<string[]>([]);  // region IDs

  // Step 3 — Params
  const [duration,         setDuration]          = useState(60);
  const [transport,        setTransport]         = useState<'drive' | 'walk' | 'bike'>('drive');
  const [dryRun,           setDryRun]            = useState(false);

  // Step 3 — Feature selection
  const [selectedFeatures, setSelectedFeatures]  = useState<string[]>([...ALL_FEATURES]);
  const [openThemes,        setOpenThemes]        = useState<Set<ThemeId>>(new Set());

  // Step 4 — Running
  const [poiCount,         setPoiCount]          = useState<number | null>(null);
  const [countLoading,     setCountLoading]      = useState(false);
  const [launching,        setLaunching]         = useState(false);
  const [jobId,            setJobId]             = useState<string | null>(null);
  const [jobStatus,        setJobStatus]         = useState<string>('');
  const [jobLog,           setJobLog]            = useState<string>('');
  const [jobDone,          setJobDone]           = useState(false);
  const [launchError,      setLaunchError]       = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load POI types on mount ──────────────────────────────────────────────
  useEffect(() => {
    setTypesLoading(true);
    fetch('/api/poi-clusters/poi-types')
      .then(r => r.json())
      .then(d => setPoiTypes(d.types ?? []))
      .catch(() => setPoiTypes([]))
      .finally(() => setTypesLoading(false));
  }, []);

  // ── Highlight on map when types/metro change ─────────────────────────────
  useEffect(() => {
    if (selectedTypes.length > 0) {
      onHighlight?.(selectedTypes, metropolitaine);
    }
  }, [selectedTypes, metropolitaine]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Count POIs when entering step 3 ────────────────────────────────────
  const refreshCount = useCallback(async () => {
    if (!selectedTypes.length) return;
    setCountLoading(true);
    try {
      const depts = buildDepts();
      const params = new URLSearchParams({
        poi_types:      selectedTypes.join(','),
        metropolitaine: String(metropolitaine),
        ...(depts.length ? { depts: depts.join(',') } : {}),
      });
      const r = await fetch(`/api/poi-clusters/count?${params}`);
      const d = await r.json();
      setPoiCount(d.count ?? 0);
    } catch {
      setPoiCount(null);
    } finally {
      setCountLoading(false);
    }
  }, [selectedTypes, metropolitaine, selectedRegions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step === 3) refreshCount();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poll job status ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    const poll = () => {
      fetch(`/api/poi-clusters/run?job_id=${jobId}`)
        .then(r => r.json())
        .then(d => {
          setJobStatus(d.status ?? '');
          setJobLog(d.log_tail ?? '');
          if (d.status === 'done' || d.status === 'failed') {
            setJobDone(true);
            if (pollRef.current) clearInterval(pollRef.current);
            if (d.status === 'done') onJobStarted(jobId);
          }
        })
        .catch(() => {});
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──────────────────────────────────────────────────────────────
  function buildDepts(): string[] {
    if (selectedRegions.length === 0) return [];
    return REGIONS_ADMIN
      .filter(r => selectedRegions.includes(r.id))
      .flatMap(r => r.depts.map(d => d.code))
      .filter(c => !metropolitaine || !DROM_DEPTS.has(c));
  }

  function buildGeoFilter(): GeoFilter {
    return { metropolitaine, regions: selectedRegions, depts: buildDepts() };
  }

  const toggleType = (t: string) =>
    setSelectedTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const toggleRegion = (id: string) =>
    setSelectedRegions(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // ── Launch job ───────────────────────────────────────────────────────────
  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await fetch('/api/poi-clusters/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poi_types:  selectedTypes,
          geo_filter: buildGeoFilter(),
          params:     { duration, transport, dry_run: dryRun },
          features:   selectedFeatures.length === ALL_FEATURES.length ? null : selectedFeatures,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setJobId(d.job_id);
      setStep(4);
    } catch (e: any) {
      setLaunchError(e.message ?? 'Erreur lancement');
    } finally {
      setLaunching(false);
    }
  };

  // ── Validation ───────────────────────────────────────────────────────────
  const canGoTo2 = selectedTypes.length > 0;
  const canGoTo3 = canGoTo2;
  const canLaunch = selectedTypes.length > 0 && duration >= 5 && duration <= 120 && !launching && selectedFeatures.length >= 2;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 600,
      background: 'rgba(5,5,5,0.96)',
      backdropFilter: 'blur(4px)',
      display: 'flex', flexDirection: 'column',
      fontFamily: fMono,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px 10px',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: fOrbitron, fontSize: 11, letterSpacing: 3, color: C.accent, textTransform: 'uppercase' }}>
            CLUSTERING
          </span>
          <span style={{ fontSize: 9, color: C.muted, letterSpacing: 1, fontFamily: fMichroma, textTransform: 'uppercase' }}>
            wizard
          </span>
        </div>
        {/* Step indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {[1, 2, 3, 4].map(n => (
            <React.Fragment key={n}>
              <StepDot n={n} active={step === n} done={step > n} />
              {n < 4 && <div style={{ width: 12, height: 1, background: step > n ? C.green : C.border }} />}
            </React.Fragment>
          ))}
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: C.muted, fontSize: 14, padding: '2px 6px', lineHeight: 1,
        }}>✕</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 12px' }}>

        {/* ─── STEP 1 : Types POI ─── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontFamily: fMichroma, textTransform: 'uppercase' }}>
              1 / 4 — Types de POI à clustériser
            </div>
            {typesLoading ? (
              <div style={{ fontSize: 11, color: C.textDim }}>Chargement…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {poiTypes.map(pt => {
                  const sel = selectedTypes.includes(pt.type);
                  return (
                    <button key={pt.type} onClick={() => toggleType(pt.type)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 11px', borderRadius: 2, cursor: 'pointer',
                      background: sel ? C.accentDim : C.bgInput,
                      border: `1px solid ${sel ? C.accent : C.border}`,
                      transition: 'all 0.12s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 12, height: 12, borderRadius: 1,
                          border: `1px solid ${sel ? C.accent : C.muted}`,
                          background: sel ? C.accent : 'transparent',
                          flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 11, color: sel ? C.text : C.muted, fontFamily: fMono }}>
                          {pt.type}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: C.textDim }}>{pt.total.toLocaleString('fr-FR')} POIs</span>
                        {pt.has_clusters && (
                          <span style={{ fontSize: 9, color: C.green, fontFamily: fMichroma, letterSpacing: 1 }}>CLUSTÉRISÉ</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedTypes.length > 0 && (
              <div style={{ fontSize: 10, color: C.accent }}>
                {selectedTypes.length} type{selectedTypes.length > 1 ? 's' : ''} sélectionné{selectedTypes.length > 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}

        {/* ─── STEP 2 : Géographie ─── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontFamily: fMichroma, textTransform: 'uppercase' }}>
              2 / 4 — Périmètre géographique
            </div>

            {/* Toggle métropolitaine */}
            <div style={{
              padding: '10px 12px', borderRadius: 2,
              border: `1px solid ${metropolitaine ? C.accent : C.border}`,
              background: metropolitaine ? C.accentDim : C.bgInput,
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <div
                  onClick={() => setMetropolitaine(m => !m)}
                  style={{
                    width: 36, height: 18, borderRadius: 2, cursor: 'pointer', flexShrink: 0,
                    background: metropolitaine ? C.accent : C.border,
                    position: 'relative', transition: 'background 0.15s',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 2, left: metropolitaine ? 20 : 2,
                    width: 14, height: 14, borderRadius: 1,
                    background: '#fff', transition: 'left 0.15s',
                  }} />
                </div>
                <span style={{ fontSize: 11, color: C.text }}>France métropolitaine uniquement</span>
              </label>
              {!metropolitaine && (
                <div style={{
                  marginTop: 8, padding: '7px 10px', borderRadius: 2,
                  background: C.amberDim, border: `1px solid ${C.amber}44`,
                  fontSize: 10, color: C.amber, lineHeight: 1.5,
                }}>
                  ! Les POI outre-mer (DOM-TOM) n&apos;ont pas de données Filosofi — ils seront ignorés lors du clustering sociodemographique.
                </div>
              )}
            </div>

            {/* Régions */}
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontFamily: fMichroma, textTransform: 'uppercase', marginBottom: 4 }}>
              Régions — laisser vide = toutes
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {REGIONS_ADMIN.filter(r => metropolitaine ? r.id !== 'dom' : true).map(r => {
                const sel = selectedRegions.includes(r.id);
                return (
                  <button key={r.id} onClick={() => toggleRegion(r.id)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 11px', borderRadius: 2, cursor: 'pointer',
                    background: sel ? C.accentDim : C.bgInput,
                    border: `1px solid ${sel ? C.accent : C.border}`,
                    transition: 'all 0.10s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 11, height: 11, borderRadius: 1,
                        border: `1px solid ${sel ? C.accent : C.muted}`,
                        background: sel ? C.accent : 'transparent', flexShrink: 0,
                      }} />
                      <span style={{ fontSize: 11, color: sel ? C.text : C.muted }}>{r.nom}</span>
                    </div>
                    <span style={{ fontSize: 9, color: C.textDim }}>{r.depts.length} dép.</span>
                  </button>
                );
              })}
            </div>

            {selectedRegions.length > 0 && (
              <div style={{ fontSize: 10, color: C.accent }}>
                {selectedRegions.length} région{selectedRegions.length > 1 ? 's' : ''} — {buildDepts().length} départements
              </div>
            )}
            {selectedRegions.length === 0 && (
              <div style={{ fontSize: 10, color: C.textDim }}>Aucune région sélectionnée = toute la France {metropolitaine ? 'métropolitaine' : ''}.</div>
            )}
          </div>
        )}

        {/* ─── STEP 3 : Paramètres ─── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontFamily: fMichroma, textTransform: 'uppercase' }}>
              3 / 4 — Paramètres de calcul
            </div>

            {/* Compteur POIs */}
            <div style={{
              padding: '10px 12px', borderRadius: 2,
              border: `1px solid ${C.border}`, background: C.bgInput,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {countLoading ? (
                <span style={{ fontSize: 11, color: C.textDim }}>Comptage…</span>
              ) : poiCount !== null ? (
                <>
                  <span style={{ fontSize: 18, color: C.green, fontFamily: fOrbitron }}>{poiCount.toLocaleString('fr-FR')}</span>
                  <span style={{ fontSize: 10, color: C.muted }}>POIs dans le périmètre</span>
                </>
              ) : (
                <span style={{ fontSize: 11, color: C.red }}>Erreur comptage</span>
              )}
            </div>

            {/* Variables d'analyse */}
            <div>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1, fontFamily: fMichroma, textTransform: 'uppercase', marginBottom: 8 }}>
                Variables d&apos;analyse
              </div>

              {/* Presets */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {(Object.entries(FEATURE_PRESETS) as [string, typeof FEATURE_PRESETS[keyof typeof FEATURE_PRESETS]][]).map(([key, preset]) => {
                  const presetFeats = preset.themes.flatMap(t => [...FEATURE_THEMES[t].features]);
                  const isActive = presetFeats.length === selectedFeatures.length &&
                    presetFeats.every(f => selectedFeatures.includes(f));
                  return (
                    <button key={key} onClick={() => setSelectedFeatures(presetFeats)} style={{
                      padding: '4px 10px', borderRadius: 2, cursor: 'pointer', fontSize: 9,
                      fontFamily: fMichroma, letterSpacing: '0.08em', textTransform: 'uppercase',
                      background: isActive ? C.accentDim : 'transparent',
                      border: `1px solid ${isActive ? C.accent : C.border}`,
                      color: isActive ? C.accent : C.muted,
                    }}>{preset.label}</button>
                  );
                })}
              </div>

              {/* Thématiques */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {ALL_THEME_IDS.map(tid => {
                  const theme = FEATURE_THEMES[tid];
                  const themeFeats = [...theme.features];
                  const checkedCount = themeFeats.filter(f => selectedFeatures.includes(f)).length;
                  const allChecked   = checkedCount === themeFeats.length;
                  const noneChecked  = checkedCount === 0;
                  const isOpen       = openThemes.has(tid);

                  const toggleTheme = () => {
                    if (allChecked) {
                      setSelectedFeatures(prev => prev.filter(f => !themeFeats.includes(f)));
                    } else {
                      setSelectedFeatures(prev => [...prev.filter(f => !themeFeats.includes(f)), ...themeFeats]);
                    }
                  };
                  const toggleOpen = () => setOpenThemes(prev => {
                    const next = new Set(prev);
                    if (next.has(tid)) next.delete(tid); else next.add(tid);
                    return next;
                  });

                  return (
                    <div key={tid} style={{
                      border: `1px solid ${checkedCount > 0 ? theme.color + '40' : C.border}`,
                      borderRadius: 2, overflow: 'hidden',
                    }}>
                      {/* Header row */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 10px',
                        background: checkedCount > 0 ? theme.color + '0a' : 'transparent',
                      }}>
                        {/* Checkbox */}
                        <div
                          onClick={toggleTheme}
                          style={{
                            width: 14, height: 14, borderRadius: 1, flexShrink: 0, cursor: 'pointer',
                            border: `1px solid ${allChecked ? theme.color : noneChecked ? C.border : theme.color + '80'}`,
                            background: allChecked ? theme.color + '30' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {allChecked && <span style={{ fontSize: 8, color: theme.color, lineHeight: 1 }}>✓</span>}
                          {!allChecked && !noneChecked && <span style={{ fontSize: 8, color: theme.color, lineHeight: 1 }}>–</span>}
                        </div>
                        {/* Color dot */}
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: theme.color, flexShrink: 0 }} />
                        {/* Label */}
                        <span onClick={toggleTheme} style={{ flex: 1, cursor: 'pointer', fontSize: 10, color: checkedCount > 0 ? C.text : C.muted }}>
                          {theme.label}
                        </span>
                        <span style={{ fontSize: 9, fontFamily: fMichroma, color: C.dim }}>
                          {checkedCount}/{themeFeats.length}
                        </span>
                        {/* Chevron */}
                        <button onClick={toggleOpen} style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                          color: C.dim, fontSize: 10, lineHeight: 1,
                        }}>
                          {isOpen ? '▲' : '▼'}
                        </button>
                      </div>

                      {/* Variables détail */}
                      {isOpen && (
                        <div style={{ padding: '4px 10px 8px 32px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {themeFeats.map(feat => {
                            const checked = selectedFeatures.includes(feat);
                            const toggle = () => setSelectedFeatures(prev =>
                              checked ? prev.filter(f => f !== feat) : [...prev, feat]
                            );
                            return (
                              <label key={feat} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                                <div
                                  onClick={toggle}
                                  style={{
                                    width: 11, height: 11, borderRadius: 1, flexShrink: 0,
                                    border: `1px solid ${checked ? theme.color : C.border}`,
                                    background: checked ? theme.color + '30' : 'transparent',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}
                                >
                                  {checked && <span style={{ fontSize: 7, color: theme.color, lineHeight: 1 }}>✓</span>}
                                </div>
                                <span onClick={toggle} style={{ fontSize: 10, color: checked ? C.muted : C.dim }}>
                                  {FEATURE_LABELS[feat] ?? feat}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Status + warnings */}
              <div style={{ marginTop: 8, fontSize: 9, fontFamily: fMono }}>
                {selectedFeatures.length < 2 ? (
                  <span style={{ color: C.red }}>! Minimum 2 variables requises</span>
                ) : selectedFeatures.length < 5 ? (
                  <span style={{ color: C.amber }}>! Peu de variables — clusters moins discriminants</span>
                ) : (
                  <span style={{ color: C.muted }}>{featureSelectionLabel(selectedFeatures)}</span>
                )}
              </div>
            </div>

            {/* Durée isochrone */}
            <div>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1, fontFamily: fMichroma, textTransform: 'uppercase', marginBottom: 6 }}>
                Durée isochrone (minutes)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min={5} max={120} value={duration}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) setDuration(Math.min(120, Math.max(5, v)));
                  }}
                  style={{
                    width: 80, padding: '7px 10px', borderRadius: 2,
                    background: C.bgInput, border: `1px solid ${duration < 5 || duration > 120 ? C.red : C.border}`,
                    color: C.text, fontFamily: fMono, fontSize: 13,
                    outline: 'none',
                  }}
                />
                <span style={{ fontSize: 10, color: C.muted }}>min (5 – 120)</span>
                {/* Raccourcis rapides */}
                {[30, 45, 60, 90].map(v => (
                  <button key={v} onClick={() => setDuration(v)} style={{
                    padding: '4px 8px', borderRadius: 2, cursor: 'pointer', fontSize: 10,
                    background: duration === v ? C.accentDim : 'transparent',
                    border: `1px solid ${duration === v ? C.accent : C.border}`,
                    color: duration === v ? C.accent : C.muted,
                  }}>{v}</button>
                ))}
              </div>
            </div>

            {/* Transport */}
            <div>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1, fontFamily: fMichroma, textTransform: 'uppercase', marginBottom: 6 }}>
                Mode de transport
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['drive', 'walk', 'bike'] as const).map(m => (
                  <button key={m} onClick={() => setTransport(m)} style={{
                    flex: 1, padding: '7px 0', borderRadius: 2, cursor: 'pointer',
                    background: transport === m ? C.accentDim : C.bgInput,
                    border: `1px solid ${transport === m ? C.accent : C.border}`,
                    color: transport === m ? C.accent : C.muted,
                    fontFamily: fMichroma, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
                  }}>
                    {m === 'drive' ? 'Voiture' : m === 'walk' ? 'Marche' : 'Vélo'}
                  </button>
                ))}
              </div>
            </div>

            {/* Dry run */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <div
                onClick={() => setDryRun(d => !d)}
                style={{
                  width: 30, height: 16, borderRadius: 2, flexShrink: 0,
                  background: dryRun ? C.amber : C.border,
                  position: 'relative', transition: 'background 0.15s', cursor: 'pointer',
                }}
              >
                <div style={{
                  position: 'absolute', top: 1, left: dryRun ? 15 : 1,
                  width: 14, height: 14, borderRadius: 1,
                  background: '#fff', transition: 'left 0.15s',
                }} />
              </div>
              <span style={{ fontSize: 10, color: dryRun ? C.amber : C.muted }}>
                Dry-run (simuler sans écrire en base)
              </span>
            </label>

            {launchError && (
              <div style={{
                padding: '8px 11px', borderRadius: 2,
                background: C.redDim, border: `1px solid ${C.red}44`,
                fontSize: 10, color: C.red,
              }}>
                ! {launchError}
              </div>
            )}
          </div>
        )}

        {/* ─── STEP 4 : Exécution ─── */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontFamily: fMichroma, textTransform: 'uppercase' }}>
              4 / 4 — Exécution
            </div>

            {/* Résumé config */}
            <div style={{
              padding: '10px 12px', borderRadius: 2,
              border: `1px solid ${C.border}`, background: C.bgInput,
              fontSize: 10, color: C.muted, lineHeight: 2,
            }}>
              <div><span style={{ color: C.textDim }}>Types    :</span> <span style={{ color: C.text }}>{selectedTypes.join(', ')}</span></div>
              <div><span style={{ color: C.textDim }}>Périmètre:</span> <span style={{ color: C.text }}>
                {metropolitaine ? 'France métro' : 'France entière'}
                {selectedRegions.length > 0 ? ` — ${selectedRegions.length} région(s)` : ''}
              </span></div>
              <div><span style={{ color: C.textDim }}>Variables:</span> <span style={{ color: C.text }}>{featureSelectionLabel(selectedFeatures)}</span></div>
              <div><span style={{ color: C.textDim }}>Durée    :</span> <span style={{ color: C.text }}>{duration} min — {transport}</span></div>
              {dryRun && <div style={{ color: C.amber }}>! Mode dry-run — aucune écriture</div>}
            </div>

            {/* Statut job */}
            {jobId && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: C.textDim }}>Job ID :</span>
                  <span style={{ fontSize: 10, color: C.muted, fontFamily: fMono }}>{jobId.slice(0, 8)}…</span>
                  <span style={{
                    fontSize: 9, padding: '2px 7px', borderRadius: 1, fontFamily: fMichroma, letterSpacing: 1,
                    background: jobStatus === 'done' ? C.greenDim : jobStatus === 'failed' ? C.redDim : C.amberDim,
                    border: `1px solid ${jobStatus === 'done' ? C.green : jobStatus === 'failed' ? C.red : C.amber}44`,
                    color: jobStatus === 'done' ? C.green : jobStatus === 'failed' ? C.red : C.amber,
                    textTransform: 'uppercase',
                  }}>
                    {jobStatus || 'pending'}
                  </span>
                </div>

                {/* Log tail */}
                {jobLog && (
                  <pre style={{
                    margin: 0, padding: '8px 10px', borderRadius: 2,
                    background: '#020205', border: `1px solid ${C.border}`,
                    fontSize: 9, color: '#aaa', lineHeight: 1.6,
                    maxHeight: 220, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    fontFamily: fMono,
                  }}>
                    {jobLog.slice(-3000)}
                  </pre>
                )}

                {jobDone && jobStatus === 'done' && (
                  <div style={{
                    padding: '10px 12px', borderRadius: 2,
                    background: C.greenDim, border: `1px solid ${C.green}44`,
                    fontSize: 11, color: C.green,
                  }}>
                    ✓ Isochrones mis en cache. Lancez <code style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>--mode full-retrain</code> pour entraîner le modèle, puis{' '}
                    <Link href="/clusters" style={{ color: C.green, textDecoration: 'underline' }}>
                      voir les résultats →
                    </Link>
                  </div>
                )}
                {jobDone && jobStatus === 'failed' && (
                  <div style={{
                    padding: '10px 12px', borderRadius: 2,
                    background: C.redDim, border: `1px solid ${C.red}44`,
                    fontSize: 11, color: C.red,
                  }}>
                    ! Clustering échoué — voir les logs ci-dessus.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer — navigation */}
      <div style={{
        padding: '12px 16px', borderTop: `1px solid ${C.border}`,
        display: 'flex', justifyContent: 'space-between', gap: 8, flexShrink: 0,
      }}>
        {/* Back */}
        {step > 1 && step < 4 ? (
          <button onClick={() => setStep((s => (s - 1) as 1 | 2 | 3 | 4)(step))} style={{
            padding: '8px 16px', borderRadius: 2, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${C.border}`,
            color: C.muted, fontFamily: fMichroma, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
          }}>
            ← RETOUR
          </button>
        ) : <div />}

        {/* Next / Launch */}
        {step === 1 && (
          <button
            onClick={() => { if (canGoTo2) setStep(2); }}
            disabled={!canGoTo2}
            style={{
              padding: '8px 20px', borderRadius: 2, cursor: canGoTo2 ? 'pointer' : 'not-allowed',
              background: canGoTo2 ? C.accentDim : 'transparent',
              border: `1px solid ${canGoTo2 ? C.accent : C.border}`,
              color: canGoTo2 ? C.accent : C.muted,
              fontFamily: fMichroma, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
            }}>
            SUIVANT →
          </button>
        )}
        {step === 2 && (
          <button
            onClick={() => { if (canGoTo3) setStep(3); }}
            disabled={!canGoTo3}
            style={{
              padding: '8px 20px', borderRadius: 2, cursor: canGoTo3 ? 'pointer' : 'not-allowed',
              background: canGoTo3 ? C.accentDim : 'transparent',
              border: `1px solid ${canGoTo3 ? C.accent : C.border}`,
              color: canGoTo3 ? C.accent : C.muted,
              fontFamily: fMichroma, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
            }}>
            SUIVANT →
          </button>
        )}
        {step === 3 && (
          <button
            onClick={handleLaunch}
            disabled={!canLaunch}
            style={{
              padding: '8px 20px', borderRadius: 2, cursor: canLaunch ? 'pointer' : 'not-allowed',
              background: canLaunch ? C.greenDim : 'transparent',
              border: `1px solid ${canLaunch ? C.green : C.border}`,
              color: canLaunch ? C.green : C.muted,
              fontFamily: fMichroma, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
            }}>
            {launching ? 'LANCEMENT…' : '▶ LANCER'}
          </button>
        )}
        {step === 4 && jobDone && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{
              padding: '8px 16px', borderRadius: 2, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, fontFamily: fMichroma, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
            }}>
              FERMER
            </button>
            <Link href="/clusters" style={{ textDecoration: 'none' }}>
              <button style={{
                padding: '8px 16px', borderRadius: 2, cursor: 'pointer',
                background: C.greenDim, border: `1px solid ${C.green}44`,
                color: C.green, fontFamily: fMichroma, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
              }}>
                VOIR RÉSULTATS →
              </button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
