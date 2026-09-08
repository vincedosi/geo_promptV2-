'use client';

import { useState, useEffect, useRef } from 'react';
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


// ── Page principale ───────────────────────────────────────────────────────────
// NOTE 2026-07 : l'onglet « Crawler auto » (discover/download/upload avec
// staging disque local) a été supprimé — incompatible serverless.
// NOTE 2026-09 : l'onglet « Import INSEE » (one-shot via /api/iris-import/insee)
// a été supprimé à son tour. Il n'écrivait rien dans iris_import_history — aucun
// des 8 imports IRIS de la base ne vient de lui, tous sont des CSV Filosofi
// déposés ici. Il ne reste donc qu'un seul chemin, et plus d'onglets.
export default function IrisCrawlerPage() {

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

      <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
        <LocalFileUploadTab />
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

