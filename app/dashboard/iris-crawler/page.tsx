'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

// ── Design tokens (GEO.PROMPT terminal dark) ─────────────────────────────────
const C = {
  bg:          'var(--bg-primary)',
  bgElevated:  'var(--bg-level-2)',
  bgSurface:   'var(--bg-level-2)',
  bgRow:       'var(--bg-surface)',
  border:      'var(--border-subtle)',
  borderLight: 'rgba(78,205,196,0.2)',
  accent:      'var(--brand-teal)',
  accentDim:   'rgba(78,205,196,0.1)',
  text:        'var(--text-primary)',
  textDim:     'var(--text-secondary)',
  textSec:     'var(--text-tertiary)',
  muted:       'var(--text-tertiary)',
  green:       '#3dffa0',
  greenDim:    'rgba(61,255,160,0.10)',
  red:         '#ff5757',
  redDim:      'rgba(255,87,87,0.10)',
  warn:        '#f7b731',
  warnDim:     'rgba(247,183,49,0.10)',
  blue:        '#5b9bd5',
  blueDim:     'rgba(91,155,213,0.10)',
} as const;
const fOrbitron = "'Inter', system-ui, sans-serif";
const fMichroma = "'Inter', system-ui, sans-serif";
const fMono     = "'JetBrains Mono', monospace";
const fInter    = "'Inter', system-ui, sans-serif";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ── Page principale ───────────────────────────────────────────────────────────
// NOTE 2026-07 : l'onglet « Crawler auto » (discover/download/upload avec
// staging disque local) a été supprimé — incompatible serverless, supplanté
// par l'import INSEE one-shot et l'upload de fichier local.
export default function IrisCrawlerPage() {
  const [mainTab, setMainTab] = useState<'import' | 'upload'>('import');

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: fInter, color: C.text }}>

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/dashboard" style={{ fontFamily: fOrbitron, fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textDecoration: 'none' }}>
            <span style={{ color: C.textDim }}>geo</span><span style={{ color: C.accent }}>.</span><span style={{ color: C.text }}>prompt</span>
          </a>
          <span style={{ color: C.border }}>›</span>
          <span style={{ fontFamily: fMichroma, fontSize: 9, color: C.textDim, letterSpacing: '0.14em' }}>IMPORT IRIS</span>
        </div>
      </header>

      {/* ─── Onglets ─── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 0, padding: '0 28px', background: C.bgElevated }}>
        {(['import', 'upload'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setMainTab(tab)}
            style={{
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${mainTab === tab ? C.accent : 'transparent'}`,
              color: mainTab === tab ? C.accent : C.textDim,
              fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.12em',
              padding: '10px 18px', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {tab === 'import' ? 'IMPORT INSEE' : 'UPLOAD FICHIER'}
          </button>
        ))}
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
        {mainTab === 'import' && <IrisInseeImportTab />}
        {mainTab === 'upload' && <LocalFileUploadTab />}
      </div>
    </div>
  );
}

// ── Upload fichier local ──────────────────────────────────────────────────────

function LocalFileUploadTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging,     setDragging]     = useState(false);
  const [uploading,    setUploading]    = useState(false);
  const [importing,    setImporting]    = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    sessionId: string; filename: string; totalRows: number;
    headers: string[]; previewRows: Array<Record<string,string>>;
    autoMapResult: { irisKeyCol: string; mapping: Record<string,string>; coreCols: string[]; jsonbCols: string[] };
    parseWarnings: string[];
  } | null>(null);
  const [mapping,  setMapping]  = useState<Record<string,string>>({});
  const [keyCol,   setKeyCol]   = useState('IRIS');
  const [logs,     setLogs]     = useState<Array<{ msg: string; kind: 'log'|'error'|'success' }>>([]);
  const [done,     setDone]     = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const addLog = (msg: string, kind: 'log'|'error'|'success' = 'log') =>
    setLogs(prev => [...prev.slice(-299), { msg, kind }]);

  const handleFile = async (file: File) => {
    setUploadResult(null);
    setLogs([]);
    setDone(false);
    setUploading(true);
    addLog(`Upload de ${file.name} (${(file.size/1024/1024).toFixed(1)} Mo)…`);

    const form = new FormData();
    form.append('file', file);
    form.append('encoding', 'utf-8');
    form.append('separator', 'auto');

    try {
      const res = await adminFetch('/api/iris-crawler/manual-upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { addLog(`! ${data.error ?? 'Erreur upload'}`, 'error'); return; }
      setUploadResult(data);
      setMapping(data.autoMapResult.mapping);
      setKeyCol(data.autoMapResult.irisKeyCol);
      addLog(`✓ ${data.totalRows.toLocaleString('fr-FR')} lignes — ${data.autoMapResult.coreCols.length} colonnes mappées`, 'success');
      if (data.parseWarnings?.length) data.parseWarnings.forEach((w: string) => addLog(`! ${w}`, 'error'));
    } catch (e: unknown) {
      addLog(`! ${String(e)}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleImport = async () => {
    if (!uploadResult) return;
    setImporting(true);
    setDone(false);
    addLog('Lancement de l\'import…');

    try {
      const res = await adminFetch('/api/iris-crawler/manual-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: uploadResult.sessionId, irisKeyCol: keyCol, mapping }),
      });

      if (!res.ok) {
        const err = await res.json();
        addLog(`! ${err.error ?? `HTTP ${res.status}`}`, 'error');
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done: rdone, value } = await reader.read();
        if (rdone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'log')      addLog(evt.message, 'log');
            if (evt.type === 'status')   addLog(evt.message, 'log');
            if (evt.type === 'progress') addLog(evt.message, 'log');
            if (evt.type === 'error')    addLog(`! ${evt.message}`, 'error');
            if (evt.type === 'done') {
              const n = evt.totalInserted ?? 0;
              addLog(`✓ Import terminé — ${n} lignes traitées`, 'success');
              setDone(true);
            }
          } catch { /* skip */ }
        }
      }
    } catch (e: unknown) {
      addLog(`! ${String(e)}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Zone drop */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? C.accent : C.border}`,
          borderRadius: 2,
          padding: '40px 20px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? C.accentDim : C.bgElevated,
          transition: 'all 0.15s',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <div style={{ fontFamily: fMichroma, fontSize: 10, color: dragging ? C.accent : C.textDim, letterSpacing: '0.12em', marginBottom: 8 }}>
          {uploading ? 'UPLOAD EN COURS…' : 'GLISSER UN FICHIER CSV / CLIQUER POUR PARCOURIR'}
        </div>
        <div style={{ fontFamily: fMono, fontSize: 9, color: C.textSec }}>
          Formats acceptés : .csv, .tsv · Taille max : 50 Mo
        </div>
        <div style={{ fontFamily: fMono, fontSize: 9, color: C.textSec, marginTop: 4 }}>
          Ex: BASE_TD_FILO_IRIS_2021_DEC.csv · Séparateur auto-détecté (;  ou ,)
        </div>
      </div>

      {/* Résultat upload + mapping */}
      {uploadResult && (
        <div style={{ border: `1px solid ${C.borderLight}`, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ background: C.bgElevated, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontFamily: fMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.12em' }}>
              {uploadResult.filename}
            </span>
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.textSec }}>
              {uploadResult.totalRows.toLocaleString('fr-FR')} lignes · {uploadResult.headers.length} colonnes
            </span>
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.green }}>
              {uploadResult.autoMapResult.coreCols.length} colonnes IRIS mappées
            </span>
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.textSec }}>
              {uploadResult.autoMapResult.jsonbCols.length} colonnes JSONB
            </span>
          </div>

          {/* Mapping colonnes core */}
          <div style={{ padding: '12px 16px', background: C.bgSurface }}>
            <div style={{ fontFamily: fMichroma, fontSize: 7.5, color: C.textSec, letterSpacing: '0.14em', marginBottom: 8 }}>
              COLONNES MAPPÉES → TABLE IRIS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(mapping)
                .filter(([, v]) => v !== 'ignore' && v !== '')
                .map(([csvCol, dbCol]) => (
                  <div key={csvCol} style={{
                    background: C.bgElevated, border: `1px solid ${C.border}`,
                    borderRadius: 2, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>{csvCol}</span>
                    <span style={{ fontFamily: fMono, fontSize: 9, color: C.muted }}>→</span>
                    <span style={{ fontFamily: fMono, fontSize: 9, color: C.green, fontWeight: 700 }}>{dbCol}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Bouton import */}
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={handleImport}
              disabled={importing || done}
              style={{
                padding: '8px 20px', borderRadius: 2,
                background: done ? C.greenDim : C.accentDim,
                border: `1px solid ${done ? `${C.green}66` : C.borderLight}`,
                color: done ? C.green : C.accent,
                fontFamily: fMichroma, fontSize: 9, letterSpacing: '0.12em',
                cursor: importing || done ? 'not-allowed' : 'pointer',
              }}
            >
              {importing ? 'IMPORT EN COURS…' : done ? '✓ IMPORT TERMINÉ' : `IMPORTER ${Object.entries(mapping).filter(([,v])=>v!=='ignore'&&v!=='').length} COLONNES`}
            </button>
            {done && (
              <button
                onClick={() => { setUploadResult(null); setLogs([]); setDone(false); }}
                style={{ padding: '8px 14px', borderRadius: 2, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.1em', cursor: 'pointer' }}
              >
                NOUVEAU FICHIER
              </button>
            )}
          </div>
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div ref={logRef} style={{ background: '#020205', border: `1px solid ${C.border}`, borderRadius: 2, padding: '10px 14px', height: 180, overflowY: 'auto' }}>
          {logs.map((l, i) => (
            <div key={i} style={{ fontFamily: fMono, fontSize: 9, lineHeight: 1.7, color: l.kind === 'error' ? C.red : l.kind === 'success' ? C.green : C.textSec }}>
              {l.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Import IRIS INSEE ──────────────────────────────────────────────────────────

interface IImportHistoryEntry {
  id:            string;
  created_at:    string;
  filename:      string;
  total_rows:    number;
  inserted_rows: number;
  updated_rows:  number;
  error_rows:    number;
  status:        'pending' | 'processing' | 'success' | 'partial' | 'error';
}

const HISTORY_STATUS_COLORS: Record<string, string> = {
  success: '#3dffa0', partial: '#fbbf24', error: '#f87171', processing: '#60a5fa', pending: '#6b7280',
};
const HISTORY_STATUS_LABELS: Record<string, string> = {
  success: '✓ OK', partial: '! Partiel', error: '✕ Erreur', processing: '⏳ En cours', pending: '○ Attente',
};

const IRIS_SOURCES = [
  { key: 'pop', label: 'POP', desc: "Population · tranches d'âge · CSP" },
  { key: 'men', label: 'MEN', desc: 'Ménages' },
  { key: 'dip', label: 'DIP', desc: 'Diplômes & formation' },
  { key: 'log', label: 'LOG', desc: 'Logement · propriétaires' },
  { key: 'act', label: 'ACT', desc: 'Activité · chômage' },
] as const;

type IrisSourceKey = typeof IRIS_SOURCES[number]['key'];
type RunPhase = 'idle' | 'running' | 'done' | 'error';

interface LogLine { time: string; source?: string; msg: string; kind: 'log' | 'error' | 'success' }
interface SourceStatus { phase: 'waiting' | 'running' | 'done' | 'error'; count?: number }

function IrisInseeImportTab() {
  const [selected,    setSelected]    = useState<Set<IrisSourceKey>>(new Set(['pop','men','dip','log','act']));
  const [year,        setYear]        = useState('2022');
  const [dept,        setDept]        = useState('');
  const [dryRun,      setDryRun]      = useState(false);
  const [phase,       setPhase]       = useState<RunPhase>('idle');
  const [lines,       setLines]       = useState<LogLine[]>([]);
  const [progress,    setProgress]    = useState({ done: 0, total: 0 });
  const [srcStatus,   setSrcStatus]   = useState<Record<string, SourceStatus>>({});
  const [history,     setHistory]     = useState<IImportHistoryEntry[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const logRef   = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLine = (source: string | undefined, msg: string, kind: LogLine['kind'] = 'log') => {
    const time = new Date().toLocaleTimeString('fr-FR');
    setLines(prev => [...prev.slice(-299), { time, source, msg, kind }]);
  };

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await adminFetch('/api/iris-crawler/import-history');
      if (res.ok) {
        const data = await res.json() as { entries: IImportHistoryEntry[] };
        setHistory(data.entries);
      }
    } catch { /* silent */ } finally { setHistLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const toggleSource = (key: IrisSourceKey) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleRun = async () => {
    if (phase === 'running') { abortRef.current?.abort(); setPhase('idle'); return; }
    setPhase('running');
    setLines([]);
    setProgress({ done: 0, total: 0 });
    setSrcStatus({});

    const sources = [...selected];
    const initStatus: Record<string, SourceStatus> = {};
    sources.forEach(s => { initStatus[s] = { phase: 'waiting' }; });
    setSrcStatus(initStatus);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await adminFetch('/api/iris-import/insee', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sources, year, dept: dept.trim() || undefined, dryRun }),
        signal:  ctrl.signal,
      });

      if (!resp.ok) {
        const err = await resp.json() as { error?: string };
        addLine(undefined, err.error ?? `HTTP ${resp.status}`, 'error');
        setPhase('error');
        return;
      }

      const reader  = resp.body!.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n');
        buf = chunks.pop() ?? '';

        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(chunk); } catch { continue; }

          const type = evt.type as string;
          if (type === 'log') {
            const src = evt.source as string | undefined;
            if (src) setSrcStatus(p => ({ ...p, [src]: { ...p[src], phase: 'running' } }));
            addLine(src, evt.message as string, 'log');
          }
          if (type === 'error') {
            const src = evt.source as string | undefined;
            if (src) setSrcStatus(p => ({ ...p, [src]: { ...p[src], phase: 'error' } }));
            addLine(src, evt.message as string, 'error');
          }
          if (type === 'source_done') {
            const src = evt.source as string;
            setSrcStatus(p => ({ ...p, [src]: { phase: 'done', count: evt.count as number } }));
          }
          if (type === 'progress') {
            setProgress({ done: evt.done as number, total: evt.total as number });
          }
          if (type === 'done') {
            const total = evt.total as number;
            const dry   = evt.dryRun as boolean;
            addLine(undefined, `✓ ${total.toLocaleString('fr-FR')} IRIS${dry ? ' [DRY RUN — aucune écriture]' : ' mis à jour'}`, 'success');
            setPhase('done');
            if (!dry) loadHistory();
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        addLine(undefined, 'Import annulé', 'log');
        setPhase('idle');
      } else {
        addLine(undefined, String(e), 'error');
        setPhase('error');
      }
    }
  };

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Titre ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 style={{ fontFamily: fOrbitron, fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', margin: 0, color: C.text }}>
          Import IRIS INSEE
        </h1>
        <p style={{ fontFamily: fMono, fontSize: 10, color: C.textDim, margin: '6px 0 0', letterSpacing: '0.04em' }}>
          Données démographiques INSEE · téléchargement automatique · ~51 000 IRIS · France métropolitaine
        </p>
      </div>

      {/* ── Panneau principal ─────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>

        {/* Sources */}
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 18px' }}>
          <div style={{ fontFamily: fMichroma, fontSize: 8, color: C.textSec, letterSpacing: '0.14em', marginBottom: 12 }}>
            SOURCES À IMPORTER
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {IRIS_SOURCES.map(src => {
              const st  = srcStatus[src.key];
              const sel = selected.has(src.key);
              const statusColor = st?.phase === 'done' ? C.green : st?.phase === 'error' ? C.red : st?.phase === 'running' ? C.warn : C.textSec;
              return (
                <label key={src.key} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={() => toggleSource(src.key)}
                    disabled={phase === 'running'}
                    style={{ accentColor: C.accent, cursor: 'pointer', width: 13, height: 13 }}
                  />
                  <span style={{ fontFamily: fMono, fontSize: 10, fontWeight: 700, color: sel ? C.accent : C.muted, width: 36, letterSpacing: '0.06em' }}>
                    {src.label}
                  </span>
                  <span style={{ fontFamily: fInter, fontSize: 11, color: sel ? C.text : C.textSec, flex: 1 }}>
                    {src.desc}
                  </span>
                  {st && (
                    <span style={{ fontFamily: fMono, fontSize: 8, color: statusColor, letterSpacing: '0.05em' }}>
                      {st.phase === 'done'    ? `✓ ${(st.count ?? 0).toLocaleString('fr-FR')} IRIS`
                       : st.phase === 'error'   ? '✕ erreur'
                       : st.phase === 'running' ? '⏳ …'
                       : '○ attente'}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* Config */}
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: fMichroma, fontSize: 8, color: C.textSec, letterSpacing: '0.12em' }}>MILLÉSIME</span>
            <select
              value={year}
              onChange={e => setYear(e.target.value)}
              disabled={phase === 'running'}
              style={{ background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 2, padding: '4px 8px', fontFamily: fMono, fontSize: 10, color: C.text, outline: 'none', cursor: 'pointer' }}
            >
              <option value="2022">2022</option>
              <option value="2021">2021</option>
              <option value="2020">2020</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: fMichroma, fontSize: 8, color: C.textSec, letterSpacing: '0.12em' }}>DÉPARTEMENT</span>
            <input
              type="text"
              value={dept}
              onChange={e => setDept(e.target.value)}
              disabled={phase === 'running'}
              placeholder="tous"
              maxLength={3}
              style={{ background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 2, padding: '4px 8px', fontFamily: fMono, fontSize: 10, color: C.text, outline: 'none', width: 60 }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={e => setDryRun(e.target.checked)}
              disabled={phase === 'running'}
              style={{ accentColor: C.warn, cursor: 'pointer' }}
            />
            <span style={{ fontFamily: fMichroma, fontSize: 8, color: dryRun ? C.warn : C.textSec, letterSpacing: '0.1em' }}>DRY RUN</span>
          </label>
        </div>

        {/* Action */}
        <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleRun}
            disabled={selected.size === 0}
            style={{
              background: phase === 'running' ? C.redDim : C.accentDim,
              border: `1px solid ${phase === 'running' ? 'rgba(248,113,113,0.4)' : C.borderLight}`,
              borderRadius: 2, padding: '8px 20px', cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
              fontFamily: fMichroma, fontSize: 9, letterSpacing: '0.12em',
              color: phase === 'running' ? C.red : C.accent,
            }}
          >
            {phase === 'running'
              ? '✕ ANNULER'
              : phase === 'done'
              ? '↺ RELANCER'
              : `⬇ LANCER L'IMPORT${dryRun ? ' (DRY RUN)' : ''}`}
          </button>

          {phase === 'running' && progress.total > 0 && (
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>
              {pct}% · {progress.done.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')} IRIS
            </span>
          )}
          {phase === 'done' && (
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.green }}>✓ Import terminé</span>
          )}
          {phase === 'error' && (
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.red }}>✕ Erreur — voir le log</span>
          )}
        </div>

        {/* Barre de progression */}
        {(phase === 'running' || phase === 'done') && progress.total > 0 && (
          <div style={{ padding: '0 18px 12px' }}>
            <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: phase === 'done' ? C.green : C.accent,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Log ───────────────────────────────────────────────────────────── */}
      {lines.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ background: C.bgElevated, borderBottom: `1px solid ${C.border}`, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: fMichroma, fontSize: 8, color: C.textSec, letterSpacing: '0.14em' }}>LOG</span>
            <span style={{ fontFamily: fMono, fontSize: 8, color: C.muted }}>{lines.length} lignes</span>
            <button onClick={() => setLines([])} style={btnSmall(C.muted, 'transparent', C.border)}>✕ Vider</button>
          </div>
          <div
            ref={logRef}
            style={{ background: '#020205', maxHeight: 280, overflowY: 'auto', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            {lines.map((l, i) => (
              <div key={i} style={{ fontFamily: fMono, fontSize: 9, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                color: l.kind === 'error' ? C.red : l.kind === 'success' ? C.green : C.textSec }}>
                <span style={{ color: C.muted, marginRight: 6 }}>{l.time}</span>
                {l.source && <span style={{ color: C.accent, marginRight: 6 }}>[{l.source}]</span>}
                {l.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Historique ────────────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ background: C.bgElevated, borderBottom: `1px solid ${C.border}`, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: fMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.14em' }}>HISTORIQUE DES IMPORTS</span>
          <button onClick={loadHistory} disabled={histLoading} style={btnSmall(C.textSec, 'transparent', C.border)}>
            {histLoading ? '…' : '↻'}
          </button>
        </div>
        {history.length === 0 && !histLoading ? (
          <div style={{ padding: '20px', fontFamily: fMono, fontSize: 9, color: C.textSec }}>Aucun import pour l&apos;instant</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 9, fontFamily: fMono }}>
              <thead>
                <tr style={{ background: '#0d0d18' }}>
                  {['DATE', 'FICHIER', 'TOTAL', 'INSÉRÉES', 'ERREURS', 'STATUT'].map(h => (
                    <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.1em', color: C.textDim, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((entry, i) => (
                  <tr key={entry.id} style={{ background: i % 2 === 0 ? C.bg : C.bgRow, borderBottom: `1px solid rgba(38,26,53,0.4)` }}>
                    <td style={{ padding: '5px 12px', color: C.textSec, whiteSpace: 'nowrap' }}>{fmtDate(entry.created_at)}</td>
                    <td style={{ padding: '5px 12px', color: C.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.filename}</td>
                    <td style={{ padding: '5px 12px', color: C.textDim }}>{entry.total_rows.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '5px 12px', color: C.green }}>{entry.inserted_rows.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '5px 12px', color: entry.error_rows > 0 ? C.red : C.muted }}>{entry.error_rows > 0 ? entry.error_rows : '—'}</td>
                    <td style={{ padding: '5px 12px' }}>
                      <span style={{ fontFamily: fMono, fontSize: 8, color: HISTORY_STATUS_COLORS[entry.status] ?? C.textSec }}>
                        {HISTORY_STATUS_LABELS[entry.status] ?? entry.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function btnSmall(color: string, bg: string, border: string): React.CSSProperties {
  return {
    background: bg, border: `1px solid ${border}`, borderRadius: 2,
    color, padding: '3px 8px', cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace", fontSize: 8, whiteSpace: 'nowrap',
  };
}
