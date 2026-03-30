'use client';

import { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ImportRun {
  id:          string;
  source:      string;
  url:         string;
  lance_le:    string;
  termine_le:  string | null;
  statut:      'running' | 'done' | 'error';
  nb_total:    number;
  nb_inseres:  number;
  nb_maj:      number;
  nb_doublons: number;
  nb_erreurs:  number;
  erreurs:     string[];
}

interface SourceConfig {
  label:     string;
  arcgisUrl: string;
}

type StreamEvent =
  | { type: 'status';   message: string }
  | { type: 'progress'; page: number; fetched: number; inserted: number; updated: number; errors: number }
  | { type: 'done';     run_id: string; nb_total: number; nb_inseres: number; nb_maj: number; nb_doublons: number; nb_erreurs: number }
  | { type: 'error';    message: string };

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:          '#050505',
  bgElevated:  '#0a0a0a',
  bgSurface:   '#111111',
  border:      '#1a1a1a',
  borderLight: 'rgba(78,205,196,0.2)',
  accent:      '#4ecdc4',
  accentDim:   'rgba(78,205,196,0.08)',
  text:        '#f0f0f0',
  textDim:     '#a0a0a0',
  textSec:     '#666666',
  muted:       '#505050',
  green:       '#3dffa0',
  greenDim:    'rgba(61,255,160,0.12)',
  red:         '#f87171',
  redDim:      'rgba(248,113,113,0.1)',
  warn:        '#fbbf24',
  warnDim:     'rgba(251,191,36,0.1)',
};
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function StatutBadge({ statut }: { statut: string }) {
  const cfg: Record<string, { color: string; bg: string; border: string }> = {
    running: { color: C.warn,  bg: C.warnDim,  border: 'rgba(251,191,36,0.3)'  },
    done:    { color: C.green, bg: C.greenDim, border: 'rgba(61,255,160,0.3)'  },
    error:   { color: C.red,   bg: C.redDim,   border: 'rgba(248,113,113,0.3)' },
  };
  const s = cfg[statut] ?? { color: C.textDim, bg: 'transparent', border: C.border };
  return (
    <span style={{ fontFamily: fontMono, fontSize: 9, color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 2, padding: '2px 7px' }}>
      {statut}
    </span>
  );
}

function fmt(n: number) { return n.toLocaleString('fr-FR'); }
function relDate(iso: string) { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OohImportPage() {
  const [sources,     setSources]     = useState<Record<string, SourceConfig>>({});
  const [runs,        setRuns]        = useState<ImportRun[]>([]);
  const [selected,    setSelected]    = useState('custom');
  const [customUrl,   setCustomUrl]   = useState('');
  const [logs,        setLogs]        = useState<string[]>([]);
  const [running,     setRunning]     = useState(false);
  const [stats,       setStats]       = useState<StreamEvent & { type: 'done' } | null>(null);
  const [replace,     setReplace]     = useState(false);
  const [datasetName, setDatasetName] = useState('');
  const [nameSaved,   setNameSaved]   = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/admin/import-ooh/arcgis')
      .then(r => r.json())
      .then(d => { setSources(d.sources ?? {}); setRuns(d.runs ?? []); });
  }, []);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  async function startImport() {
    setRunning(true); setLogs([]); setStats(null); setDatasetName(''); setNameSaved(false);
    try {
      const body: Record<string, string | boolean> = { source: selected, replace };
      if (customUrl.trim())  body.arcgisUrl = customUrl.trim();
      if (selected === 'custom' && customUrl.trim()) body.source = 'custom';

      const resp = await fetch('/api/admin/import-ooh/arcgis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!resp.body) throw new Error('Pas de stream');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as StreamEvent;
            if (evt.type === 'status')   setLogs(p => [...p, `  ${evt.message}`]);
            if (evt.type === 'progress') setLogs(p => [...p, `  page ${evt.page} — ${fmt(evt.fetched)} récupérés / ${fmt(evt.inserted)} insérés`]);
            if (evt.type === 'error')    setLogs(p => [...p, `! ${evt.message}`]);
            if (evt.type === 'done') {
              setStats(evt);
              setLogs(p => [...p, `> import terminé — ${fmt(evt.nb_total)} panneaux / ${fmt(evt.nb_inseres)} insérés`]);
              fetch('/api/admin/import-ooh/arcgis').then(r => r.json()).then(d => setRuns(d.runs ?? []));
            }
          } catch { /* JSON invalide */ }
        }
      }
    } catch (err) {
      setLogs(p => [...p, `! ${err instanceof Error ? err.message : String(err)}`]);
    } finally { setRunning(false); }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: fontInter, padding: '32px 24px', maxWidth: 860, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: fontInter, fontSize: 18, fontWeight: 500, color: C.text, margin: '0 0 4px' }}>
          OOH Import
        </h1>
        <p style={{ fontFamily: fontInter, fontSize: 13, color: C.textSec, margin: 0 }}>
          ArcGIS REST → <span style={{ fontFamily: fontMono, color: C.accent }}>global_ooh</span>
        </p>
      </div>

      {/* ── Formulaire ── */}
      <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: 20, marginBottom: 16 }}>
        <div style={{ fontFamily: fontInter, fontWeight: 500, fontSize: 12, color: C.text, marginBottom: 16 }}>Nouvelle importation</div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontFamily: fontInter, fontSize: 12, color: C.textDim, display: 'block', marginBottom: 6 }}>
            URL ArcGIS REST <span style={{ color: C.red }}>*</span>
          </label>
          <input
            type="url"
            value={customUrl}
            onChange={e => setCustomUrl(e.target.value)}
            disabled={running}
            placeholder="https://geo.example.fr/arcgis/rest/services/.../MapServer/0"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2,
              padding: '9px 12px', color: C.text, fontSize: 11, fontFamily: fontMono,
              outline: 'none', letterSpacing: '0.04em',
            }}
            autoFocus
          />
          <div style={{ fontFamily: fontMono, fontSize: 9, color: C.muted, marginTop: 5 }}>
            // Doit se terminer par <span style={{ color: C.accent }}>/MapServer/N</span>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
          <div
            onClick={() => !running && setReplace(v => !v)}
            style={{
              width: 14, height: 14, border: `1px solid ${replace ? C.accent : C.border}`,
              borderRadius: 2, background: replace ? C.accentDim : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer',
            }}
          >
            {replace && <span style={{ color: C.accent, fontSize: 10, lineHeight: 1 }}>✓</span>}
          </div>
          <span style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
            Remplacer les données existantes <span style={{ color: C.muted }}>(supprime et réimporte)</span>
          </span>
        </label>

        <button
          onClick={startImport}
          disabled={running || !customUrl.trim()}
          style={{
            background: running || !customUrl.trim() ? C.muted : C.accent,
            border: 'none', borderRadius: 2, padding: '9px 20px',
            color: '#050505', cursor: running || !customUrl.trim() ? 'not-allowed' : 'pointer',
            fontSize: 12, fontFamily: fontInter, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s',
          }}
        >
          {running && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
          {running ? 'Import en cours...' : 'Lancer'}
        </button>
      </div>

      {/* ── Terminal logs ── */}
      {logs.length > 0 && (
        <div style={{ background: '#020202', border: `1px solid ${C.border}`, borderRadius: 2, padding: '12px 16px', marginBottom: 16, fontFamily: fontMono, fontSize: 10, color: C.textDim, maxHeight: 220, overflowY: 'auto', lineHeight: 1.7 }}>
          <div style={{ fontFamily: fontInter, fontSize: 11, color: C.accent, marginBottom: 8 }}>Sortie</div>
          {logs.map((l, i) => (
            <div key={i} style={{ color: l.startsWith('!') ? C.red : l.startsWith('>') ? C.green : C.textDim }}>
              {l}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* ── Stats ── */}
      {stats && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'TOTAL',    value: fmt(stats.nb_total),   color: C.text   },
              { label: 'INSÉRÉS',  value: fmt(stats.nb_inseres),  color: C.green  },
              { label: 'DOUBLONS', value: fmt(stats.nb_doublons), color: C.warn   },
              { label: 'ERREURS',  value: fmt(stats.nb_erreurs),  color: C.red    },
            ].map(s => (
              <div key={s.label} style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontFamily: fontMono, fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Nommage dataset */}
          <div style={{ background: C.accentDim, border: `1px solid ${C.borderLight}`, borderRadius: 2, padding: '14px 16px' }}>
            <div style={{ fontFamily: fontInter, fontWeight: 500, fontSize: 12, color: C.text, marginBottom: 10 }}>Nommer ce dataset</div>
            {nameSaved ? (
              <div style={{ fontFamily: fontMono, fontSize: 10, color: C.green }}>
                ✓ Enregistré : <span style={{ color: C.text }}>{datasetName}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={datasetName}
                  onChange={e => setDatasetName(e.target.value)}
                  placeholder="ex. Brest Métropole 2026, JCDecaux Paris..."
                  style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, padding: '8px 12px', color: C.text, fontSize: 11, fontFamily: fontInter, outline: 'none' }}
                />
                <button
                  onClick={async () => {
                    if (!datasetName.trim()) return;
                    await fetch('/api/admin/import-ooh/arcgis', {
                      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: stats.run_id, label: datasetName.trim() }),
                    });
                    setNameSaved(true);
                    setRuns(prev => prev.map(r => r.id === stats.run_id ? { ...r, source: datasetName.trim() } : r));
                  }}
                  disabled={!datasetName.trim()}
                  style={{ background: datasetName.trim() ? C.accent : C.muted, border: 'none', borderRadius: 2, padding: '8px 16px', color: '#050505', cursor: datasetName.trim() ? 'pointer' : 'not-allowed', fontSize: 12, fontFamily: fontInter, fontWeight: 500, whiteSpace: 'nowrap' }}
                >
                  Enregistrer
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Historique ── */}
      <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, flexShrink: 0 }} />
          <span style={{ fontFamily: fontInter, fontWeight: 500, fontSize: 12, color: C.text }}>Historique des imports ({runs.length})</span>
        </div>
        {runs.length === 0 ? (
          <div style={{ padding: '20px 16px', fontFamily: fontMono, fontSize: 10, color: C.muted }}>// Aucun import réalisé.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Source', 'Date', 'Statut', 'Total', 'Insérés', 'Err', ''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: fontInter, fontSize: 11, color: C.textDim, fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: i < runs.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                  <td style={{ padding: '9px 12px', fontFamily: fontMono, fontSize: 10, color: C.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.source}</td>
                  <td style={{ padding: '9px 12px', fontFamily: fontMono, fontSize: 10, color: C.textDim, whiteSpace: 'nowrap' }}>{relDate(r.lance_le)}</td>
                  <td style={{ padding: '9px 12px' }}><StatutBadge statut={r.statut} /></td>
                  <td style={{ padding: '9px 12px', fontFamily: fontMono, fontSize: 10, color: C.text }}>{fmt(r.nb_total)}</td>
                  <td style={{ padding: '9px 12px', fontFamily: fontMono, fontSize: 10, color: C.green }}>{fmt(r.nb_inseres)}</td>
                  <td style={{ padding: '9px 12px', fontFamily: fontMono, fontSize: 10, color: r.nb_erreurs > 0 ? C.red : C.muted }}>{r.nb_erreurs > 0 ? fmt(r.nb_erreurs) : '—'}</td>
                  <td style={{ padding: '9px 12px' }}>
                    <button
                      onClick={async () => {
                        await fetch('/api/admin/import-ooh/arcgis', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id }) });
                        setRuns(prev => prev.filter(x => x.id !== r.id));
                      }}
                      style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12, padding: 4, transition: 'color 0.15s' }}
                      title="Supprimer"
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
