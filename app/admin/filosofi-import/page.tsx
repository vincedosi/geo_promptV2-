'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:          '#050505',
  bgElevated:  '#0d0d0d',
  bgSurface:   '#111118',
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

interface LogLine {
  id:   number;
  text: string;
  kind: 'info' | 'ok' | 'error' | 'progress';
}

const fmtNum = (n: number) => n.toLocaleString('fr-FR');

// ─── Composant ────────────────────────────────────────────────────────────────
export default function FilosofiImportPage() {
  const [step, setStep]             = useState<Step>(1);

  // Step 1
  const [file, setFile]             = useState<File | null>(null);
  const [resolution, setResolution] = useState('200m');
  const [millesime, setMillesime]   = useState('2021');
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing]   = useState(false);
  const [parseError, setParseError] = useState('');

  // Step 2
  const [parsed, setParsed]         = useState<ParseResult | null>(null);
  const [idcarCol, setIdcarCol]     = useState('');

  // Step 3
  const [logs, setLogs]             = useState<LogLine[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importDone, setImportDone]   = useState(false);
  const [stats, setStats]             = useState<{ inserted: number; errors: number; skipped: number } | null>(null);
  const [progress, setProgress]       = useState<{ done: number; total: number } | null>(null);

  const logRef  = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  let   logId   = useRef(0);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const addLog = useCallback((text: string, kind: LogLine['kind'] = 'info') => {
    setLogs(prev => [...prev, { id: logId.current++, text, kind }]);
  }, []);

  // ─── Step 1 : Analyse du fichier ─────────────────────────────────────────
  const analyseFile = useCallback(async (f: File) => {
    if (!f.name.endsWith('.parquet')) {
      setParseError('Seuls les fichiers .parquet sont acceptés');
      return;
    }
    setFile(f);
    setIsParsing(true);
    setParseError('');

    // Auto-detect millésime + résolution depuis le nom du fichier
    const nameMatch = f.name.match(/(\d{4})/);
    if (nameMatch) setMillesime(nameMatch[1]);
    if (/1km/i.test(f.name)) setResolution('1km');
    else if (/200m/i.test(f.name)) setResolution('200m');

    try {
      const form = new FormData();
      form.append('file', f);

      const res = await adminFetch('/api/admin/import-filosofi/parse', {
        method: 'POST',
        body:   form,
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'Erreur serveur' }));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }

      const data: ParseResult = await res.json();
      setParsed(data);
      setIdcarCol(data.idcarColumn ?? '');
      setStep(2);
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setIsParsing(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) analyseFile(f);
  }, [analyseFile]);

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) analyseFile(f);
  }, [analyseFile]);

  // ─── Step 3 : Import ──────────────────────────────────────────────────────
  const runImport = useCallback(async () => {
    if (!file || !parsed) return;
    setStep(3);
    setIsImporting(true);
    setImportDone(false);
    setLogs([]);
    setStats(null);
    setProgress(null);

    try {
      const form = new FormData();
      form.append('file',       file);
      form.append('idcar_col',  idcarCol);
      form.append('resolution', resolution);
      form.append('millesime',  millesime);

      const res = await adminFetch('/api/admin/import-filosofi/execute', {
        method: 'POST',
        body:   form,
      });

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
              addLog(`> ${ev.message}`, 'info');
            } else if (ev.type === 'progress') {
              const pct = Math.round((ev.done / ev.total) * 100);
              addLog(`  [${String(pct).padStart(3)}%] ${fmtNum(ev.done)}/${fmtNum(ev.total)} — insérés: ${fmtNum(ev.inserted)} — erreurs: ${ev.errors} — ignorés: ${ev.skipped}`, 'progress');
              setProgress({ done: ev.done, total: ev.total });
            } else if (ev.type === 'done') {
              addLog(``, 'info');
              addLog(`[OK] Import terminé — ${fmtNum(ev.inserted)} carreaux insérés / ${fmtNum(ev.errors)} erreurs / ${fmtNum(ev.skipped)} ignorés`, 'ok');
              setStats({ inserted: ev.inserted, errors: ev.errors, skipped: ev.skipped });
              setImportDone(true);
            } else if (ev.type === 'error') {
              addLog(`! ${ev.message}`, 'error');
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e: unknown) {
      addLog(`! ${e instanceof Error ? e.message : 'Erreur réseau'}`, 'error');
    } finally {
      setIsImporting(false);
    }
  }, [file, parsed, idcarCol, resolution, millesime, addLog]);

  // ─── Render ───────────────────────────────────────────────────────────────
  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: fontInter, color: C.text }}>

      {/* Header */}
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <a href="/dashboard" style={{ color: C.textSec, fontFamily: fontMono, fontSize: 10, textDecoration: 'none' }}>←</a>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: fontOrbitron, fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: '0.08em' }}>
            <span style={{ color: C.textDim }}>geo</span><span style={{ color: C.accent }}>.</span><span>prompt</span>
          </span>
          <span style={{ fontFamily: fontMichroma, fontSize: 9, color: C.textDim, letterSpacing: '0.14em' }}>
            FILOSOFI_IMPORT
          </span>
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
            {step === 1 ? 'UPLOAD' : step === 2 ? 'PREVIEW' : 'IMPORT'}
          </span>
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>

        {/* ── STEP 1 : Upload ─────────────────────────────────────────────── */}
        {step === 1 && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.18em', marginBottom: 6 }}>DATA_SOURCE</div>
              <h1 style={{ fontFamily: fontOrbitron, fontSize: 18, fontWeight: 700, letterSpacing: '0.08em', margin: 0, color: C.text }}>
                Import Filosofi Parquet
              </h1>
              <p style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, marginTop: 8, lineHeight: 1.6 }}>
                Importe les carreaux INSEE Filosofi (200m / 1km) depuis un fichier .parquet.<br />
                La géométrie est reconstruite automatiquement depuis l'identifiant idcar (Lambert 93 → WGS84).
              </p>
            </div>

            {/* Drop zone */}
            <div
              onDrop={onDrop}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => fileRef.current?.click()}
              style={{
                border:        `2px dashed ${isDragging ? C.accent : C.border}`,
                borderRadius:  2,
                background:    isDragging ? C.accentDim : C.bgElevated,
                padding:       '40px 24px',
                textAlign:     'center',
                cursor:        'pointer',
                transition:    'all 0.15s',
                marginBottom:  20,
              }}
            >
              <input ref={fileRef} type="file" accept=".parquet" style={{ display: 'none' }} onChange={onFileInput} />

              {isParsing ? (
                <>
                  <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.14em', marginBottom: 8 }}>ANALYSE_EN_COURS</div>
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>Lecture du fichier Parquet...</div>
                </>
              ) : file ? (
                <>
                  <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.green, letterSpacing: '0.14em', marginBottom: 8 }}>FICHIER_SELECTIONNE</div>
                  <div style={{ fontFamily: fontMono, fontSize: 11, color: C.text, marginBottom: 4 }}>{file.name}</div>
                  <div style={{ fontFamily: fontMono, fontSize: 9, color: C.textDim }}>{(file.size / 1024 / 1024).toFixed(2)} Mo</div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.textSec, letterSpacing: '0.14em', marginBottom: 10 }}>DROP_ZONE</div>
                  <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, marginBottom: 6 }}>
                    Déposer un fichier <span style={{ color: C.accent }}>.parquet</span> ici
                  </div>
                  <div style={{ fontFamily: fontMono, fontSize: 9, color: C.textSec }}>ou cliquer pour sélectionner</div>
                </>
              )}
            </div>

            {parseError && (
              <div style={{ background: 'rgba(248,113,113,0.08)', border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '10px 14px', fontFamily: fontMono, fontSize: 10, color: C.red, marginBottom: 16 }}>
                ! {parseError}
              </div>
            )}

            {/* Params */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.12em', marginBottom: 6 }}>RESOLUTION</div>
                <select
                  value={resolution}
                  onChange={e => setResolution(e.target.value)}
                  style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, padding: '8px 10px', color: C.text, fontFamily: fontMono, fontSize: 10 }}
                >
                  <option value="200m">200m (carreaux fins)</option>
                  <option value="1km">1km (carreaux larges)</option>
                </select>
              </div>
              <div>
                <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.12em', marginBottom: 6 }}>MILLESIME</div>
                <select
                  value={millesime}
                  onChange={e => setMillesime(e.target.value)}
                  style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, padding: '8px 10px', color: C.text, fontFamily: fontMono, fontSize: 10 }}
                >
                  {['2021', '2019', '2017', '2015'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ fontFamily: fontMono, fontSize: 9, color: C.textSec, lineHeight: 1.7 }}>
              Données disponibles sur <span style={{ color: C.accent }}>data.gouv.fr</span> — rechercher &quot;Filosofi carreaux&quot;.<br />
              Formats supportés : carreaux_filosofi_200m_*.parquet / carreaux_filosofi_1km_*.parquet
            </div>
          </div>
        )}

        {/* ── STEP 2 : Preview ────────────────────────────────────────────── */}
        {step === 2 && parsed && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.18em', marginBottom: 6 }}>ANALYSE_COMPLETE</div>
              <h1 style={{ fontFamily: fontOrbitron, fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', margin: 0 }}>
                {file?.name}
              </h1>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'CARREAUX',    val: fmtNum(parsed.rowCount),          color: C.accent },
                { label: 'COLONNES',    val: String(parsed.columns.length),     color: C.blue   },
                { label: 'INDICATEURS', val: String(parsed.indicatorColumns.length), color: C.green  },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '12px 14px' }}>
                  <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.12em', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontFamily: fontOrbitron, fontSize: 20, fontWeight: 800, color }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Colonne idcar */}
            <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.12em', marginBottom: 8 }}>COLONNE_IDCAR</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <select
                  value={idcarCol}
                  onChange={e => setIdcarCol(e.target.value)}
                  style={{ background: C.bg, border: `1px solid ${C.accent}`, borderRadius: 2, padding: '7px 10px', color: C.text, fontFamily: fontMono, fontSize: 10, flexGrow: 1 }}
                >
                  <option value="">— sélectionner —</option>
                  {parsed.columns.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {idcarCol && (
                  <div style={{ fontFamily: fontMono, fontSize: 9, color: C.green }}>
                    [OK] géométrie décodée depuis idcar (Lambert 93)
                  </div>
                )}
              </div>
            </div>

            {/* Config résolution/millésime */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.12em', marginBottom: 8 }}>RESOLUTION</div>
                <select value={resolution} onChange={e => setResolution(e.target.value)}
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, padding: '7px 10px', color: C.text, fontFamily: fontMono, fontSize: 10, width: '100%' }}>
                  <option value="200m">200m</option>
                  <option value="1km">1km</option>
                </select>
              </div>
              <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.12em', marginBottom: 8 }}>MILLESIME</div>
                <select value={millesime} onChange={e => setMillesime(e.target.value)}
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, padding: '7px 10px', color: C.text, fontFamily: fontMono, fontSize: 10, width: '100%' }}>
                  {['2021', '2019', '2017', '2015'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {/* Indicateurs détectés */}
            <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.12em', marginBottom: 10 }}>INDICATEURS_DETECTES ({parsed.indicatorColumns.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {parsed.indicatorColumns.slice(0, 60).map(col => (
                  <span key={col} style={{
                    background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)',
                    borderRadius: 2, padding: '2px 7px',
                    fontFamily: fontMono, fontSize: 9, color: C.blue,
                  }}>{col}</span>
                ))}
                {parsed.indicatorColumns.length > 60 && (
                  <span style={{ fontFamily: fontMono, fontSize: 9, color: C.textSec, padding: '2px 4px' }}>
                    +{parsed.indicatorColumns.length - 60} autres
                  </span>
                )}
              </div>
            </div>

            {/* Aperçu */}
            {parsed.preview.length > 0 && (
              <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.12em', padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>APERCU (5 premieres lignes)</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontMono, fontSize: 9 }}>
                    <thead>
                      <tr>
                        {parsed.columns.slice(0, 8).map(col => (
                          <th key={col} style={{ padding: '6px 10px', textAlign: 'left', fontFamily: fontMichroma, fontSize: 7, color: C.textDim, letterSpacing: '0.1em', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                            {col.toUpperCase()}
                          </th>
                        ))}
                        {parsed.columns.length > 8 && <th style={{ padding: '6px 10px', fontFamily: fontMichroma, fontSize: 7, color: C.textSec }}>+{parsed.columns.length - 8}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.preview.map((row, ri) => (
                        <tr key={ri} style={{ borderBottom: `1px solid rgba(38,26,53,0.5)` }}>
                          {parsed.columns.slice(0, 8).map(col => (
                            <td key={col} style={{ padding: '5px 10px', color: col === idcarCol ? C.accent : C.textDim, whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {String(row[col] ?? '—')}
                            </td>
                          ))}
                          {parsed.columns.length > 8 && <td style={{ padding: '5px 10px', color: C.textSec }}>...</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setStep(1); setFile(null); setParsed(null); setParseError(''); }}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 2, padding: '9px 18px', color: C.textDim, cursor: 'pointer', fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em' }}
              >
                RETOUR
              </button>
              <button
                onClick={runImport}
                disabled={!idcarCol}
                style={{
                  background:   idcarCol ? C.accent : 'rgba(168,85,247,0.2)',
                  border:       `1px solid ${idcarCol ? C.accent : C.border}`,
                  borderRadius: 2, padding: '9px 24px',
                  color:        idcarCol ? '#fff' : C.textSec,
                  cursor:       idcarCol ? 'pointer' : 'not-allowed',
                  fontFamily:   fontMichroma, fontSize: 9, letterSpacing: '0.12em',
                  fontWeight:   700,
                }}
              >
                LANCER_IMPORT — {fmtNum(parsed.rowCount)} carreaux
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3 : Import ─────────────────────────────────────────────── */}
        {step === 3 && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.18em', marginBottom: 6 }}>IMPORT_EN_COURS</div>
              <h1 style={{ fontFamily: fontOrbitron, fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', margin: 0 }}>
                {file?.name}
              </h1>
            </div>

            {/* Stats finales */}
            {stats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'INSERES',  val: fmtNum(stats.inserted), color: C.green  },
                  { label: 'ERREURS',  val: fmtNum(stats.errors),   color: stats.errors > 0  ? C.red    : C.textSec },
                  { label: 'IGNORES',  val: fmtNum(stats.skipped),  color: stats.skipped > 0 ? C.yellow : C.textSec },
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '12px 14px' }}>
                    <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.12em', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontFamily: fontOrbitron, fontSize: 22, fontWeight: 800, color }}>{val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Progress bar */}
            {progress && !importDone && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fontMono, fontSize: 9, color: C.textDim, marginBottom: 4 }}>
                  <span>{fmtNum(progress.done)} / {fmtNum(progress.total)}</span>
                  <span>{pct}%</span>
                </div>
                <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: C.accent, borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
              </div>
            )}

            {/* Log terminal */}
            <div
              ref={logRef}
              style={{
                background:   C.bgElevated,
                border:       `1px solid ${C.border}`,
                borderRadius: 2,
                height:       360,
                overflowY:    'auto',
                padding:      '12px 14px',
                fontFamily:   fontMono,
                fontSize:     10,
                lineHeight:   1.7,
                marginBottom: 16,
              }}
            >
              {logs.length === 0 && (
                <span style={{ color: C.textSec }}>Démarrage...</span>
              )}
              {logs.map(l => (
                <div key={l.id} style={{
                  color: l.kind === 'ok'       ? C.green
                       : l.kind === 'error'    ? C.red
                       : l.kind === 'progress' ? C.textDim
                       : C.text,
                }}>
                  {l.text}
                </div>
              ))}
              {isImporting && !importDone && (
                <div style={{ color: C.accent }}>_</div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              {importDone && (
                <button
                  onClick={() => { setStep(1); setFile(null); setParsed(null); setStats(null); setProgress(null); setLogs([]); setImportDone(false); }}
                  style={{ background: C.accentDim, border: `1px solid ${C.borderLight}`, borderRadius: 2, padding: '9px 20px', color: C.accent, cursor: 'pointer', fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em' }}
                >
                  NOUVEL_IMPORT
                </button>
              )}
              <a
                href="/admin/carreaux-import"
                style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 2, padding: '9px 18px', color: C.textDim, cursor: 'pointer', fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em', textDecoration: 'none', display: 'inline-block' }}
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
