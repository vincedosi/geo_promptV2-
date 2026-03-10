'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:          '#050505',
  bgElevated:  '#0d0d0d',
  border:      '#261a35',
  borderLight: 'rgba(168,85,247,0.2)',
  accent:      '#a855f7',
  accentDim:   'rgba(168,85,247,0.08)',
  text:        '#e2e8f0',
  textDim:     '#94a3b8',
  textSec:     '#6b7280',
  green:       '#3dffa0',
  red:         '#f87171',
  yellow:      '#f59e0b',
  blue:        '#60a5fa',
  teal:        '#2dd4bf',
};
const fontOrbitron = "'Orbitron', sans-serif";
const fontMichroma = "'Michroma', 'Orbitron', sans-serif";
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3;

interface ParseResult {
  rowCount:         number;
  columns:          string[];
  idcarColumn:      string | null;
  indicatorColumns: string[];
  preview:          Record<string, unknown>[];
}

interface SlotState {
  file:      File | null;
  parsing:   boolean;
  parsed:    ParseResult | null;
  idcarCol:  string;
  error:     string;
}

interface LogLine {
  id:   number;
  text: string;
  kind: 'info' | 'ok' | 'error' | 'progress' | 'head';
}

const fmtNum = (n: number) => n.toLocaleString('fr-FR');

const emptySlot = (): SlotState => ({ file: null, parsing: false, parsed: null, idcarCol: '', error: '' });

// ─── Drop zone component ──────────────────────────────────────────────────────
function DropZone({
  slot, resolution, color,
  onFile,
}: {
  slot: SlotState;
  resolution: string;
  color: string;
  onFile: (f: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0]; if (f) onFile(f);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onClick={() => !slot.parsing && ref.current?.click()}
      style={{
        border:       `2px dashed ${dragging ? color : slot.parsed ? color + '55' : C.border}`,
        borderRadius: 2,
        background:   dragging ? `${color}10` : slot.parsed ? `${color}08` : C.bgElevated,
        padding:      '22px 18px',
        textAlign:    'center',
        cursor:       slot.parsing ? 'wait' : 'pointer',
        transition:   'all 0.15s',
        minHeight:    100,
        display:      'flex',
        flexDirection:'column',
        alignItems:   'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      <input ref={ref} type="file" accept=".parquet" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />

      {/* Resolution badge */}
      <div style={{
        fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.14em',
        color: color, border: `1px solid ${color}55`,
        borderRadius: 2, padding: '2px 8px', marginBottom: 4,
      }}>
        {resolution}
      </div>

      {slot.parsing ? (
        <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>Analyse...</div>
      ) : slot.parsed ? (
        <>
          <div style={{ fontFamily: fontMono, fontSize: 10, color: C.text, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {slot.file?.name}
          </div>
          <div style={{ fontFamily: fontMono, fontSize: 9, color: color }}>
            {fmtNum(slot.parsed.rowCount)} carreaux · {slot.parsed.indicatorColumns.length} indicateurs
          </div>
          <div style={{ fontFamily: fontMono, fontSize: 8, color: C.textSec }}>
            {((slot.file?.size ?? 0) / 1024 / 1024).toFixed(1)} Mo
          </div>
        </>
      ) : (
        <>
          <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
            <span style={{ color }}>carreaux_{resolution}_</span>*.parquet
          </div>
          <div style={{ fontFamily: fontMono, fontSize: 8, color: C.textSec }}>déposer ou cliquer</div>
        </>
      )}

      {slot.error && (
        <div style={{ fontFamily: fontMono, fontSize: 9, color: C.red, marginTop: 4 }}>! {slot.error}</div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function FilosofiImportPage() {
  const [step, setStep]         = useState<Step>(1);
  const [millesime, setMillesime] = useState('2021');

  // Deux slots : 200m et 1km
  const [slot200, setSlot200]   = useState<SlotState>(emptySlot());
  const [slot1km, setSlot1km]   = useState<SlotState>(emptySlot());

  // Step 3 — log
  const [logs, setLogs]         = useState<LogLine[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importDone, setImportDone]   = useState(false);
  const [stats200, setStats200] = useState<{ inserted: number; errors: number; skipped: number } | null>(null);
  const [stats1km, setStats1km] = useState<{ inserted: number; errors: number; skipped: number } | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const logId  = useRef(0);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const addLog = useCallback((text: string, kind: LogLine['kind'] = 'info') => {
    setLogs(prev => [...prev, { id: logId.current++, text, kind }]);
  }, []);

  // ─── Parse un fichier ────────────────────────────────────────────────────
  const parseFile = useCallback(async (
    f: File,
    resolution: string,
    setSlot: React.Dispatch<React.SetStateAction<SlotState>>,
  ) => {
    if (!f.name.endsWith('.parquet')) {
      setSlot(s => ({ ...s, error: 'Seuls les fichiers .parquet sont acceptés' }));
      return;
    }
    setSlot(s => ({ ...s, file: f, parsing: true, error: '', parsed: null }));

    // Auto-detect millésime
    const m = f.name.match(/(\d{4})/);
    if (m) setMillesime(m[1]);

    try {
      const form = new FormData();
      form.append('file', f);
      const res = await adminFetch('/api/admin/import-filosofi/parse', { method: 'POST', body: form });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'Erreur serveur' }));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data: ParseResult = await res.json();
      setSlot(s => ({ ...s, parsing: false, parsed: data, idcarCol: data.idcarColumn ?? '', error: '' }));
    } catch (e: unknown) {
      setSlot(s => ({ ...s, parsing: false, error: e instanceof Error ? e.message : 'Erreur inconnue' }));
    }
  }, []);

  const canProceed = (slot200.parsed && slot200.idcarCol) || (slot1km.parsed && slot1km.idcarCol);

  // ─── Import d'un slot via SSE ────────────────────────────────────────────
  const importSlot = useCallback(async (
    slot: SlotState,
    resolution: string,
    onStats: (s: { inserted: number; errors: number; skipped: number }) => void,
  ) => {
    if (!slot.file || !slot.parsed) return;

    addLog(``, 'info');
    addLog(`── ${resolution} · ${fmtNum(slot.parsed.rowCount)} carreaux ─────────────────`, 'head');

    const form = new FormData();
    form.append('file',       slot.file);
    form.append('idcar_col',  slot.idcarCol);
    form.append('resolution', resolution);
    form.append('millesime',  millesime);

    const res = await adminFetch('/api/admin/import-filosofi/execute', { method: 'POST', body: form });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'status') {
            addLog(`  > ${ev.message}`, 'info');
          } else if (ev.type === 'progress') {
            const pct = Math.round((ev.done / ev.total) * 100);
            addLog(`  [${String(pct).padStart(3)}%] ${fmtNum(ev.done)}/${fmtNum(ev.total)} insérés: ${fmtNum(ev.inserted)}`, 'progress');
          } else if (ev.type === 'done') {
            addLog(`  [OK] ${fmtNum(ev.inserted)} insérés / ${ev.errors} erreurs / ${ev.skipped} ignorés`, 'ok');
            onStats({ inserted: ev.inserted, errors: ev.errors, skipped: ev.skipped });
          } else if (ev.type === 'error') {
            addLog(`  ! ${ev.message}`, 'error');
          }
        } catch { /* skip */ }
      }
    }
  }, [millesime, addLog]);

  // ─── Lancer l'import complet ─────────────────────────────────────────────
  const runImport = useCallback(async () => {
    setStep(3);
    setIsImporting(true);
    setImportDone(false);
    setLogs([]);
    setStats200(null);
    setStats1km(null);

    try {
      if (slot200.parsed && slot200.idcarCol) {
        await importSlot(slot200, '200m', setStats200);
      }
      if (slot1km.parsed && slot1km.idcarCol) {
        await importSlot(slot1km, '1km', setStats1km);
      }
      addLog('', 'info');
      addLog('[OK] Import Filosofi terminé.', 'ok');
      setImportDone(true);
    } catch (e: unknown) {
      addLog(`! ${e instanceof Error ? e.message : 'Erreur réseau'}`, 'error');
    } finally {
      setIsImporting(false);
    }
  }, [slot200, slot1km, importSlot, addLog]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: fontInter, color: C.text }}>

      {/* Header */}
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <a href="/dashboard" style={{ color: C.textSec, fontFamily: fontMono, fontSize: 10, textDecoration: 'none' }}>←</a>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: fontOrbitron, fontSize: 13, fontWeight: 700, letterSpacing: '0.08em' }}>
            <span style={{ color: C.textDim }}>geo</span><span style={{ color: C.accent }}>.</span><span>prompt</span>
          </span>
          <span style={{ fontFamily: fontMichroma, fontSize: 9, color: C.textDim, letterSpacing: '0.14em' }}>FILOSOFI_IMPORT</span>
        </div>

        {/* Step indicator */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {([1, 2, 3] as Step[]).map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: fontMono, fontSize: 9, fontWeight: 700,
                background: step === s ? C.accent : step > s ? 'rgba(61,255,160,0.15)' : 'transparent',
                border: `1px solid ${step === s ? C.accent : step > s ? C.green : C.border}`,
                color: step === s ? '#fff' : step > s ? C.green : C.textSec,
              }}>{s}</div>
              {i < 2 && <div style={{ width: 20, height: 1, background: C.border }} />}
            </div>
          ))}
          <span style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, marginLeft: 8, letterSpacing: '0.1em' }}>
            {step === 1 ? 'UPLOAD' : step === 2 ? 'CONFIG' : 'IMPORT'}
          </span>
        </div>
      </header>

      <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>

        {/* ── STEP 1 : Upload des deux fichiers ──────────────────────────── */}
        {step === 1 && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.18em', marginBottom: 6 }}>DATA_SOURCE</div>
              <h1 style={{ fontFamily: fontOrbitron, fontSize: 18, fontWeight: 700, letterSpacing: '0.08em', margin: 0 }}>
                Import Filosofi Parquet
              </h1>
              <p style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, marginTop: 8, lineHeight: 1.6 }}>
                Déposer les deux fichiers INSEE Filosofi — 200m et 1km sont importés ensemble.<br />
                La géométrie est reconstruite depuis l'identifiant idcar (Lambert 93 → WGS84).
              </p>
            </div>

            {/* Millésime */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.12em', marginBottom: 6 }}>MILLESIME</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['2021', '2019', '2017', '2015'].map(m => (
                  <button
                    key={m}
                    onClick={() => setMillesime(m)}
                    style={{
                      background:   millesime === m ? C.accent : 'transparent',
                      border:       `1px solid ${millesime === m ? C.accent : C.border}`,
                      borderRadius: 2, padding: '5px 14px',
                      color:        millesime === m ? '#fff' : C.textDim,
                      cursor:       'pointer',
                      fontFamily:   fontMono, fontSize: 10,
                    }}
                  >{m}</button>
                ))}
              </div>
            </div>

            {/* Deux drop zones côte à côte */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <DropZone
                slot={slot200}
                resolution="200m"
                color={C.accent}
                onFile={f => parseFile(f, '200m', setSlot200)}
              />
              <DropZone
                slot={slot1km}
                resolution="1km"
                color={C.teal}
                onFile={f => parseFile(f, '1km', setSlot1km)}
              />
            </div>

            {/* Info */}
            <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '10px 14px', marginBottom: 20, fontFamily: fontMono, fontSize: 9, color: C.textSec, lineHeight: 1.7 }}>
              Télécharger sur <span style={{ color: C.accent }}>data.gouv.fr</span> — chercher &quot;Filosofi carreaux&quot;<br />
              Fichiers attendus : <span style={{ color: C.accent }}>carreaux_filosofi_200m_{millesime}.parquet</span> + <span style={{ color: C.teal }}>carreaux_filosofi_1km_{millesime}.parquet</span>
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!canProceed}
              style={{
                background:   canProceed ? C.accent : 'rgba(168,85,247,0.15)',
                border:       `1px solid ${canProceed ? C.accent : C.border}`,
                borderRadius: 2, padding: '10px 28px',
                color:        canProceed ? '#fff' : C.textSec,
                cursor:       canProceed ? 'pointer' : 'not-allowed',
                fontFamily:   fontMichroma, fontSize: 9, letterSpacing: '0.12em', fontWeight: 700,
              }}
            >
              SUIVANT →
            </button>
          </div>
        )}

        {/* ── STEP 2 : Config & confirmation ──────────────────────────────── */}
        {step === 2 && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.18em', marginBottom: 6 }}>CONFIRMATION</div>
              <h1 style={{ fontFamily: fontOrbitron, fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', margin: 0 }}>
                Millésime {millesime}
              </h1>
            </div>

            {/* Récapitulatif des deux slots */}
            {([
              { slot: slot200, res: '200m', color: C.accent,   setSlot: setSlot200 },
              { slot: slot1km, res: '1km',  color: C.teal,     setSlot: setSlot1km },
            ] as const).map(({ slot, res, color, setSlot }) => (
              <div key={res} style={{
                background: C.bgElevated, border: `1px solid ${slot.parsed ? color + '44' : C.border}`,
                borderRadius: 2, padding: '14px 16px', marginBottom: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: slot.parsed ? 10 : 0 }}>
                  <span style={{ fontFamily: fontMichroma, fontSize: 8, color, letterSpacing: '0.14em', border: `1px solid ${color}55`, borderRadius: 2, padding: '2px 8px' }}>{res}</span>
                  {slot.parsed ? (
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: C.text }}>{slot.file?.name}</span>
                  ) : (
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: C.textSec }}>— non fourni (ignoré)</span>
                  )}
                </div>

                {slot.parsed && (
                  <>
                    {/* Stats */}
                    <div style={{ display: 'flex', gap: 20, marginBottom: 10, fontFamily: fontMono, fontSize: 9 }}>
                      <span><span style={{ color: C.textDim }}>carreaux </span><span style={{ color }}>{fmtNum(slot.parsed.rowCount)}</span></span>
                      <span><span style={{ color: C.textDim }}>colonnes </span><span style={{ color: C.text }}>{slot.parsed.columns.length}</span></span>
                      <span><span style={{ color: C.textDim }}>indicateurs </span><span style={{ color: C.blue }}>{slot.parsed.indicatorColumns.length}</span></span>
                    </div>

                    {/* Colonne idcar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.1em', width: 60, flexShrink: 0 }}>IDCAR_COL</span>
                      <select
                        value={slot.idcarCol}
                        onChange={e => setSlot(s => ({ ...s, idcarCol: e.target.value }))}
                        style={{ background: C.bg, border: `1px solid ${color}55`, borderRadius: 2, padding: '5px 8px', color: C.text, fontFamily: fontMono, fontSize: 9 }}
                      >
                        <option value="">— sélectionner —</option>
                        {slot.parsed.columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {slot.idcarCol && <span style={{ fontFamily: fontMono, fontSize: 8, color: C.green }}>[OK]</span>}
                    </div>

                    {/* Indicateurs */}
                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {slot.parsed.indicatorColumns.slice(0, 30).map(col => (
                        <span key={col} style={{
                          background: `${color}10`, border: `1px solid ${color}30`,
                          borderRadius: 2, padding: '1px 6px',
                          fontFamily: fontMono, fontSize: 8, color,
                        }}>{col}</span>
                      ))}
                      {slot.parsed.indicatorColumns.length > 30 && (
                        <span style={{ fontFamily: fontMono, fontSize: 8, color: C.textSec }}>+{slot.parsed.indicatorColumns.length - 30}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Résumé total */}
            <div style={{ background: 'rgba(168,85,247,0.05)', border: `1px solid ${C.borderLight}`, borderRadius: 2, padding: '12px 16px', marginBottom: 20, fontFamily: fontMono, fontSize: 10 }}>
              <span style={{ color: C.textDim }}>Total : </span>
              <span style={{ color: C.accent, fontWeight: 700 }}>
                {fmtNum((slot200.parsed?.rowCount ?? 0) + (slot1km.parsed?.rowCount ?? 0))} carreaux
              </span>
              <span style={{ color: C.textSec }}> · résolution 200m + 1km · millésime {millesime}</span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setStep(1)}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 2, padding: '9px 18px', color: C.textDim, cursor: 'pointer', fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em' }}
              >
                RETOUR
              </button>
              <button
                onClick={runImport}
                disabled={!canProceed}
                style={{
                  background:   C.accent,
                  border:       `1px solid ${C.accent}`,
                  borderRadius: 2, padding: '9px 28px',
                  color:        '#fff',
                  cursor:       'pointer',
                  fontFamily:   fontMichroma, fontSize: 9, letterSpacing: '0.12em', fontWeight: 700,
                }}
              >
                LANCER_IMPORT
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3 : Import ─────────────────────────────────────────────── */}
        {step === 3 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.18em', marginBottom: 6 }}>
                {importDone ? 'IMPORT_TERMINE' : 'IMPORT_EN_COURS'}
              </div>
              <h1 style={{ fontFamily: fontOrbitron, fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', margin: 0 }}>
                Filosofi {millesime}
              </h1>
            </div>

            {/* Stats par résolution */}
            {(stats200 || stats1km) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {[
                  { label: '200m', stats: stats200, color: C.accent },
                  { label: '1km',  stats: stats1km,  color: C.teal  },
                ].map(({ label, stats, color }) => stats && (
                  <div key={label} style={{ background: C.bgElevated, border: `1px solid ${color}44`, borderRadius: 2, padding: '12px 14px' }}>
                    <div style={{ fontFamily: fontMichroma, fontSize: 8, color, letterSpacing: '0.12em', marginBottom: 8 }}>{label}</div>
                    <div style={{ display: 'flex', gap: 16, fontFamily: fontMono, fontSize: 9 }}>
                      <span><span style={{ color: C.textDim }}>insérés </span><span style={{ color: C.green, fontWeight: 700 }}>{fmtNum(stats.inserted)}</span></span>
                      <span><span style={{ color: C.textDim }}>erreurs </span><span style={{ color: stats.errors > 0 ? C.red : C.textSec }}>{stats.errors}</span></span>
                      <span><span style={{ color: C.textDim }}>ignorés </span><span style={{ color: stats.skipped > 0 ? C.yellow : C.textSec }}>{stats.skipped}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Log terminal */}
            <div
              ref={logRef}
              style={{
                background:   C.bgElevated,
                border:       `1px solid ${C.border}`,
                borderRadius: 2,
                height:       380,
                overflowY:    'auto',
                padding:      '12px 14px',
                fontFamily:   fontMono,
                fontSize:     10,
                lineHeight:   1.7,
                marginBottom: 16,
              }}
            >
              {logs.length === 0 && <span style={{ color: C.textSec }}>Démarrage...</span>}
              {logs.map(l => (
                <div key={l.id} style={{
                  color: l.kind === 'head'     ? C.accent
                       : l.kind === 'ok'       ? C.green
                       : l.kind === 'error'    ? C.red
                       : l.kind === 'progress' ? C.textDim
                       : C.text,
                  fontWeight: l.kind === 'head' ? 700 : undefined,
                }}>
                  {l.text}
                </div>
              ))}
              {isImporting && <div style={{ color: C.accent }}>_</div>}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              {importDone && (
                <button
                  onClick={() => { setStep(1); setSlot200(emptySlot()); setSlot1km(emptySlot()); setStats200(null); setStats1km(null); setLogs([]); setImportDone(false); }}
                  style={{ background: C.accentDim, border: `1px solid ${C.borderLight}`, borderRadius: 2, padding: '9px 20px', color: C.accent, cursor: 'pointer', fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em' }}
                >
                  NOUVEL_IMPORT
                </button>
              )}
              <a href="/admin/carreaux-import"
                style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 2, padding: '9px 18px', color: C.textDim, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em', textDecoration: 'none', display: 'inline-block' }}
              >
                IMPORT_SHAPEFILE
              </a>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
