'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { ConfirmModal } from '@/components/ui/confirm-modal';

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: '#050505', card: '#0a0a0a', elevated: '#111111',
  border: '#1a1a1a', borderDefault: '#262626',
  teal: '#4ecdc4', tealDim: 'rgba(78,205,196,0.1)',
  green: '#3dffa0', greenDim: 'rgba(61,255,160,0.1)',
  red: '#ff5757', redDim: 'rgba(255,87,87,0.08)',
  warn: '#f7b731', warnDim: 'rgba(247,183,49,0.1)',
  text: '#f0f0f0', textSec: '#a0a0a0', textDim: '#666666',
};
const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

// ── Types ─────────────────────────────────────────────────────────────────────
interface RadioStats {
  total_emetteurs: number; emetteurs_fm: number; emetteurs_dab: number;
  total_radios: number; emetteurs_matches: number; emetteurs_orphelins: number;
  pct_matching: number | null; par_categorie: Record<string, number>;
  par_portee: Record<string, number>; par_genre: Record<string, number>;
  derniere_maj_anfr: string | null; archives_count: number;
}
interface ImportLog {
  id: string; type: string; status: string; started_at: string;
  completed_at: string | null; stats: Record<string, unknown> | null;
  error_message: string | null;
}
interface RadioRow {
  id: string; nom: string; categorie_arcom: string | null; portee: string | null;
  genre: string | null; groupe_media: string | null; audience_data: Record<string, unknown>;
  tarifs_data: Record<string, unknown>; created_at: string;
}

type Tab = 'import' | 'radios' | 'stats';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function daysAgo(d: string | null): number {
  if (!d) return 999;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

// ── Section header ────────────────────────────────────────────────────────────
function SH({ label }: { label: string }) {
  return (
    <div style={{ background: C.elevated, borderTop: `1px solid ${C.border}`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
      <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: C.text }}>{label}</span>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '14px 16px',
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderDefault; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: fMono, fontSize: 22, fontWeight: 500, color: color ?? C.text, marginBottom: 2 }}>{value}</div>
      {sub && <div style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>{sub}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function RadioAdminPage() {
  const { toast: toastApi } = useToast();
  const [tab, setTab] = useState<Tab>('import');

  // ── Stats ─────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState<RadioStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await adminFetch('/api/radio/stats');
      if (res.ok) { const d = await res.json(); setStats(d); }
    } catch { /* ignore */ }
    setStatsLoading(false);
  }, []);

  // ── Import history ────────────────────────────────────────────────────────
  const [imports, setImports] = useState<ImportLog[]>([]);

  const fetchImports = useCallback(async () => {
    try {
      const res = await adminFetch('/api/radio/imports-history');
      if (res.ok) { const d = await res.json(); setImports(d.imports ?? []); }
    } catch { /* ignore */ }
  }, []);

  // ── Radios list ───────────────────────────────────────────────────────────
  const [radios, setRadios] = useState<RadioRow[]>([]);
  const [radiosTotal, setRadiosTotal] = useState(0);
  const [radiosPage, setRadiosPage] = useState(1);
  const [radiosSearch, setRadiosSearch] = useState('');
  const [radiosLoading, setRadiosLoading] = useState(false);

  const fetchRadios = useCallback(async () => {
    setRadiosLoading(true);
    try {
      const params = new URLSearchParams({ page: String(radiosPage), limit: '20' });
      if (radiosSearch) params.set('search', radiosSearch);
      const res = await adminFetch(`/api/radio/stations?${params}`);
      if (res.ok) {
        const d = await res.json();
        setRadios(d.stations ?? []);
        setRadiosTotal(d.total ?? 0);
      }
    } catch { /* ignore */ }
    setRadiosLoading(false);
  }, [radiosPage, radiosSearch]);

  // ── ODS file upload ────────────────────────────────────────────────────────
  const odsFileRef = useRef<HTMLInputElement>(null);

  const handleODSUpload = async () => {
    const file = odsFileRef.current?.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportLogs([{ message: `▶ Import ODS : ${file.name}`, level: 'info', phase: 'INIT' }]);
    setImportPct(0);
    setViewingLogId(null);

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await adminFetch('/api/radio/import-arcom-ods', { method: 'POST', body: form });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setImportLogs(prev => [...prev, { message: `✗ ${err.error ?? res.status}`, level: 'error' }]);
        toastApi.error('Import ODS échoué', err.error);
        setImporting(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            setImportLogs(prev => [...prev, { message: evt.message, level: evt.level ?? 'info', phase: evt.phase }]);
            if (evt.type === 'done') toastApi.success('Import ODS terminé');
            if (evt.type === 'error' && !evt.level) toastApi.error('Erreur', evt.message);
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportLogs(prev => [...prev, { message: `✗ ${msg}`, level: 'error' }]);
      toastApi.error('Import échoué', msg);
    }
    setImporting(false);
    fetchStats();
    fetchImports();
    if (odsFileRef.current) odsFileRef.current.value = '';
  };

  // ── Import streaming + structured logs ──────────────────────────────────────
  interface LogLine { message: string; level?: string; phase?: string; timestamp?: string }
  const [importing, setImporting] = useState(false);
  const [importLogs, setImportLogs] = useState<LogLine[]>([]);
  const [importPct, setImportPct] = useState(0);
  const [logFilter, setLogFilter] = useState<Set<string>>(new Set(['info', 'warn', 'error', 'success']));
  const [viewingLogId, setViewingLogId] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  const logLevelColor: Record<string, string> = {
    debug: '#6b7280', info: '#d1d5db', warn: '#f59e0b', error: '#ef4444', success: '#22c55e',
  };

  const logCounts = importLogs.reduce<Record<string, number>>((acc, l) => {
    const lv = l.level ?? 'info';
    acc[lv] = (acc[lv] ?? 0) + 1;
    return acc;
  }, {});

  const filteredLogs = importLogs.filter(l => logFilter.has(l.level ?? 'info'));

  const copyLogs = () => {
    const text = importLogs.map(l => l.message).join('\n');
    navigator.clipboard.writeText(text).then(() => toastApi.success('Logs copiés'));
  };

  const loadHistoryLogs = async (logId: string) => {
    try {
      const res = await adminFetch(`/api/radio/import-logs/${logId}`);
      if (!res.ok) return;
      const data = await res.json();
      setImportLogs((data.entries ?? []).map((e: { message: string; level: string; phase: string; timestamp: string }) => ({
        message: `[${(e.timestamp ?? '').slice(11, 19)}] [${(e.level ?? 'info').toUpperCase().padEnd(7)}] [${(e.phase ?? '').padEnd(12)}] ${e.message}`,
        level: e.level, phase: e.phase, timestamp: e.timestamp,
      })));
      setViewingLogId(logId);
    } catch { /* ignore */ }
  };

  const launchImport = async (endpoint: string, label: string) => {
    setImporting(true);
    setImportLogs([{ message: `▶ ${label} lancé...`, level: 'info', phase: 'INIT' }]);
    setImportPct(0);
    setViewingLogId(null);
    userScrolledRef.current = false;

    try {
      const res = await adminFetch(endpoint, { method: 'POST' });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setImportLogs(prev => [...prev, { message: `✗ Erreur : ${err.error ?? res.status}`, level: 'error' }]);
        toastApi.error('Import échoué', err.error);
        setImporting(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as { type: string; message: string; percent?: number; level?: string; phase?: string; timestamp?: string };
            setImportLogs(prev => [...prev, { message: evt.message, level: evt.level ?? (evt.type === 'error' ? 'error' : 'info'), phase: evt.phase, timestamp: evt.timestamp }]);
            if (evt.percent) setImportPct(evt.percent);
            if (evt.type === 'done') { toastApi.success('Import terminé'); setImportPct(100); }
            if (evt.type === 'error' && !evt.level) toastApi.error('Erreur', evt.message);
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportLogs(prev => [...prev, { message: `✗ ${msg}`, level: 'error' }]);
      toastApi.error('Import échoué', msg);
    }
    setImporting(false);
    fetchStats();
    fetchImports();
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<'emetteurs' | 'all' | null>(null);
  const [deleteDryRun, setDeleteDryRun] = useState<Record<string, number> | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteDryRun = async (target: 'emetteurs' | 'all') => {
    const res = await adminFetch('/api/radio/data', {
      method: 'DELETE',
      body: JSON.stringify({ target, confirm: false }),
    });
    if (res.ok) {
      const d = await res.json();
      setDeleteDryRun(d.would_delete ?? {});
      setDeleteTarget(target);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await adminFetch('/api/radio/data', {
      method: 'DELETE',
      body: JSON.stringify({ target: deleteTarget, confirm: true }),
    });
    if (res.ok) {
      toastApi.success('Données supprimées');
      fetchStats();
    } else {
      toastApi.error('Erreur suppression');
    }
    setDeleting(false);
    setDeleteTarget(null);
    setDeleteDryRun(null);
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { fetchStats(); fetchImports(); }, [fetchStats, fetchImports]);
  useEffect(() => { if (tab === 'radios') fetchRadios(); }, [tab, fetchRadios]);
  useEffect(() => { if (!userScrolledRef.current) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [importLogs]);

  // ── Render ────────────────────────────────────────────────────────────────
  const days = daysAgo(stats?.derniere_maj_anfr ?? null);
  const freshColor = days < 45 ? C.green : days < 90 ? C.warn : C.red;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', fontFamily: fInter }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: C.text, margin: 0, letterSpacing: '-0.02em' }}>Radio FM/DAB+</h1>
          <span style={{ fontSize: 10, padding: '2px 8px', background: '#181818', border: '0.5px solid #262626', borderRadius: 4, color: C.textDim }}>Admin</span>
        </div>
        <p style={{ fontSize: 13, color: C.textDim, margin: 0 }}>Import, classification, audience et tarifs des émetteurs radio</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `0.5px solid ${C.border}`, marginBottom: 20 }}>
        {(['import', 'radios', 'stats'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 20px', background: 'none', border: 'none', borderBottom: `2px solid ${tab === t ? C.teal : 'transparent'}`,
            color: tab === t ? C.text : C.textDim, fontSize: 13, fontWeight: tab === t ? 500 : 400,
            cursor: 'pointer', fontFamily: fInter, transition: 'all 0.15s',
          }}>
            {t === 'import' ? 'Import' : t === 'radios' ? 'Radios' : 'Statistiques'}
          </button>
        ))}
      </div>

      {/* ═══════════ TAB IMPORT ═══════════ */}
      {tab === 'import' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Action cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '16px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 4 }}>Import ANFR</div>
              <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12, lineHeight: 1.5 }}>
                Télécharger et importer les émetteurs depuis data.gouv.fr (~64 Mo)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: freshColor }} />
                <span style={{ fontSize: 11, fontFamily: fMono, color: freshColor }}>
                  {stats?.derniere_maj_anfr ? `Dernier import : ${fmtDate(stats.derniere_maj_anfr)} (${days}j)` : 'Aucun import'}
                </span>
              </div>
              <button disabled={importing} onClick={() => launchImport('/api/radio/import-anfr', 'Import ANFR')} style={{
                background: 'transparent', border: `0.5px solid ${C.teal}`, borderRadius: 6,
                padding: '8px 16px', fontSize: 12, fontWeight: 500, color: C.teal,
                cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.5 : 1,
                fontFamily: fInter, transition: 'all 0.15s',
              }}>
                {importing ? 'Import en cours...' : 'Lancer l\'import ANFR'}
              </button>
            </div>

            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '16px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 4 }}>Enrichissement radios</div>
              <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12, lineHeight: 1.5 }}>
                Identifier les radios et les associer aux émetteurs
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontFamily: fMono, color: C.textSec }}>
                  {stats ? `${stats.emetteurs_matches} matchés / ${stats.total_emetteurs} total` : '—'}
                </span>
              </div>
              <button disabled={importing} onClick={() => launchImport('/api/radio/crawl-arcom', 'Enrichissement')} style={{
                background: 'transparent', border: `0.5px solid ${C.borderDefault}`, borderRadius: 6,
                padding: '8px 16px', fontSize: 12, color: C.textSec,
                cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.5 : 1,
                fontFamily: fInter, transition: 'all 0.15s',
              }}>
                {importing ? 'En cours...' : 'Lancer l\'enrichissement'}
              </button>
            </div>

            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '16px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 4 }}>Référentiel Arcom (ODS)</div>
              <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12, lineHeight: 1.5 }}>
                Importer le fichier officiel Arcom avec les 1 174 radios et leurs fréquences
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontFamily: fMono, color: C.textSec }}>
                  {stats ? `${stats.total_radios} radios en base` : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  ref={odsFileRef}
                  type="file"
                  accept=".ods,.xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={() => { /* trigger handled by button */ }}
                />
                <button
                  disabled={importing}
                  onClick={() => odsFileRef.current?.click()}
                  style={{
                    background: 'transparent', border: `0.5px solid ${C.borderDefault}`, borderRadius: 6,
                    padding: '8px 12px', fontSize: 11, color: C.textSec,
                    cursor: importing ? 'not-allowed' : 'pointer', fontFamily: fInter,
                  }}
                >
                  Choisir .ods
                </button>
                <button
                  disabled={importing || !odsFileRef.current?.files?.length}
                  onClick={handleODSUpload}
                  style={{
                    background: 'transparent', border: `0.5px solid ${C.teal}`, borderRadius: 6,
                    padding: '8px 12px', fontSize: 11, fontWeight: 500, color: C.teal,
                    cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.5 : 1,
                    fontFamily: fInter,
                  }}
                >
                  Importer
                </button>
              </div>
            </div>
          </div>

          {/* Log viewer — terminal style */}
          {importLogs.length > 0 && (
            <div>
              <SH label={viewingLogId ? `Logs de l'import ${viewingLogId.slice(0, 8)}` : 'Progression'} />
              {importPct > 0 && (
                <div style={{ height: 4, background: C.border, borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${importPct}%`, background: C.teal, transition: 'width 0.3s' }} />
                </div>
              )}
              {/* Level filter + stats + copy */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                {['info', 'warn', 'error', 'success', 'debug'].map(lv => (
                  <button key={lv} onClick={() => setLogFilter(prev => { const n = new Set(prev); n.has(lv) ? n.delete(lv) : n.add(lv); return n; })} style={{
                    padding: '2px 8px', borderRadius: 3, fontSize: 10, fontFamily: fMono,
                    background: logFilter.has(lv) ? `${logLevelColor[lv]}20` : 'transparent',
                    border: `0.5px solid ${logFilter.has(lv) ? logLevelColor[lv] : '#262626'}`,
                    color: logFilter.has(lv) ? logLevelColor[lv] : C.textDim,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                    {lv.toUpperCase()} {logCounts[lv] ? `(${logCounts[lv]})` : ''}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button onClick={copyLogs} style={{
                  padding: '2px 8px', borderRadius: 3, fontSize: 10, fontFamily: fInter,
                  background: 'transparent', border: `0.5px solid ${C.borderDefault}`,
                  color: C.textDim, cursor: 'pointer',
                }}>
                  Copier
                </button>
                {viewingLogId && (
                  <button onClick={() => { setImportLogs([]); setViewingLogId(null); }} style={{
                    padding: '2px 8px', borderRadius: 3, fontSize: 10, fontFamily: fInter,
                    background: 'transparent', border: `0.5px solid ${C.borderDefault}`,
                    color: C.textDim, cursor: 'pointer',
                  }}>
                    Fermer
                  </button>
                )}
              </div>
              {/* Terminal */}
              <div
                style={{
                  background: '#080808', border: `0.5px solid ${C.border}`, borderRadius: 6,
                  padding: 12, height: 360, overflowY: 'auto', fontFamily: fMono, fontSize: 11, lineHeight: 1.7,
                }}
                onScroll={e => {
                  const el = e.currentTarget;
                  userScrolledRef.current = el.scrollTop + el.clientHeight < el.scrollHeight - 30;
                }}
              >
                {filteredLogs.map((log, i) => (
                  <div key={i} style={{ color: logLevelColor[log.level ?? 'info'] ?? '#d1d5db', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {log.message}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {/* Import history */}
          <div>
            <SH label="Historique des imports" />
            {imports.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: C.textDim, fontSize: 12 }}>Aucun import effectué</div>
            ) : (
              <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fInter, fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: C.elevated }}>
                      {['Date', 'Type', 'Statut', 'Durée', 'Détails', 'Logs'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: C.textDim, fontWeight: 500, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map(imp => {
                      const duration = imp.completed_at && imp.started_at
                        ? Math.round((new Date(imp.completed_at).getTime() - new Date(imp.started_at).getTime()) / 1000)
                        : null;
                      const statusColor = imp.status === 'success' ? C.green : imp.status === 'error' ? C.red : C.warn;
                      return (
                        <tr key={imp.id} style={{ borderBottom: `0.5px solid ${C.border}` }}>
                          <td style={{ padding: '8px 12px', color: C.textSec, fontFamily: fMono, fontSize: 11 }}>{fmtDate(imp.started_at)}</td>
                          <td style={{ padding: '8px 12px', color: C.text }}>{imp.type.toUpperCase()}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: `${statusColor}15`, color: statusColor, border: `0.5px solid ${statusColor}30` }}>
                              {imp.status}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', color: C.textDim, fontFamily: fMono, fontSize: 11 }}>
                            {duration !== null ? `${duration}s` : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', color: C.textDim, fontSize: 11 }}>
                            {imp.error_message
                              ? <span style={{ color: C.red }}>{imp.error_message.slice(0, 60)}</span>
                              : imp.stats
                                ? `${(imp.stats as Record<string, number>).inserted ?? 0} insérés, ${(imp.stats as Record<string, number>).updated ?? 0} màj`
                                : '—'}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <button onClick={() => loadHistoryLogs(imp.id)} style={{
                              background: 'none', border: `0.5px solid ${C.borderDefault}`, borderRadius: 4,
                              padding: '3px 8px', fontSize: 10, color: C.textSec, cursor: 'pointer',
                              fontFamily: fInter, transition: 'all 0.15s',
                            }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = '#4ecdc4'; e.currentTarget.style.color = '#4ecdc4'; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderDefault; e.currentTarget.style.color = C.textSec; }}
                            >
                              Voir
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Danger zone */}
          <div>
            <SH label="Gestion des données" />
            <div style={{ background: C.redDim, border: `0.5px solid rgba(255,87,87,0.15)`, borderRadius: 6, padding: 16, display: 'flex', gap: 10 }}>
              <button onClick={() => handleDeleteDryRun('emetteurs')} style={{
                background: 'transparent', border: `0.5px solid rgba(255,87,87,0.3)`, borderRadius: 6,
                padding: '8px 14px', fontSize: 11, color: C.red, cursor: 'pointer', fontFamily: fInter,
              }}>Supprimer les émetteurs</button>
              <button onClick={() => handleDeleteDryRun('all')} style={{
                background: 'transparent', border: `0.5px solid rgba(255,87,87,0.3)`, borderRadius: 6,
                padding: '8px 14px', fontSize: 11, color: C.red, cursor: 'pointer', fontFamily: fInter,
              }}>Supprimer tout (émetteurs + radios + archive)</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ TAB RADIOS ═══════════ */}
      {tab === 'radios' && (
        <div>
          {/* Search */}
          <div style={{ marginBottom: 16 }}>
            <input
              value={radiosSearch}
              onChange={e => { setRadiosSearch(e.target.value); setRadiosPage(1); }}
              placeholder="Rechercher une radio..."
              style={{
                width: '100%', maxWidth: 360, background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6,
                padding: '8px 12px', fontSize: 13, color: C.text, fontFamily: fInter, outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
            />
          </div>

          {/* Table */}
          {radiosLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 12 }}>Chargement...</div>
          ) : radios.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: C.textDim, marginBottom: 8 }}>
                {radiosSearch ? 'Aucune radio trouvée' : 'Aucune radio en base'}
              </div>
              {!radiosSearch && (
                <button onClick={() => setTab('import')} style={{
                  background: 'transparent', border: `0.5px solid ${C.teal}`, borderRadius: 6,
                  padding: '8px 16px', fontSize: 12, color: C.teal, cursor: 'pointer', fontFamily: fInter,
                }}>Lancer un import</button>
              )}
            </div>
          ) : (
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fInter, fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.elevated }}>
                    {['Nom', 'Catégorie', 'Portée', 'Genre', 'Groupe', 'Audience', 'Tarifs'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: C.textDim, fontWeight: 500, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {radios.map(r => (
                    <tr key={r.id} style={{ borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.1s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = C.elevated; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <td style={{ padding: '8px 12px', color: C.text, fontWeight: 500 }}>{r.nom}</td>
                      <td style={{ padding: '8px 12px', color: C.textSec }}>{r.categorie_arcom ?? '—'}</td>
                      <td style={{ padding: '8px 12px', color: C.textSec }}>{r.portee ?? '—'}</td>
                      <td style={{ padding: '8px 12px', color: C.textSec }}>{r.genre ?? '—'}</td>
                      <td style={{ padding: '8px 12px', color: C.textSec }}>{r.groupe_media ?? '—'}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {Object.keys(r.audience_data ?? {}).length > 0
                          ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: C.greenDim, color: C.green, border: `0.5px solid rgba(61,255,160,0.2)` }}>Renseigné</span>
                          : <span style={{ color: C.textDim }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {Object.keys(r.tarifs_data ?? {}).length > 0
                          ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: C.greenDim, color: C.green, border: `0.5px solid rgba(61,255,160,0.2)` }}>Renseigné</span>
                          : <span style={{ color: C.textDim }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Pagination */}
              {radiosTotal > 20 && (
                <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `0.5px solid ${C.border}` }}>
                  <span style={{ fontSize: 11, color: C.textDim }}>{radiosTotal} radios</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button disabled={radiosPage <= 1} onClick={() => setRadiosPage(p => p - 1)} style={{ background: 'none', border: `0.5px solid ${C.borderDefault}`, borderRadius: 4, padding: '4px 10px', fontSize: 11, color: C.textSec, cursor: 'pointer' }}>Précédent</button>
                    <span style={{ padding: '4px 8px', fontSize: 11, color: C.textDim, fontFamily: fMono }}>{radiosPage}</span>
                    <button disabled={radiosPage * 20 >= radiosTotal} onClick={() => setRadiosPage(p => p + 1)} style={{ background: 'none', border: `0.5px solid ${C.borderDefault}`, borderRadius: 4, padding: '4px 10px', fontSize: 11, color: C.textSec, cursor: 'pointer' }}>Suivant</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ TAB STATS ═══════════ */}
      {tab === 'stats' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {statsLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.textDim }}>Chargement...</div>
          ) : !stats || stats.total_emetteurs === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: C.textDim, marginBottom: 8 }}>Aucune donnée radio importée</div>
              <button onClick={() => setTab('import')} style={{
                background: 'transparent', border: `0.5px solid ${C.teal}`, borderRadius: 6,
                padding: '8px 16px', fontSize: 12, color: C.teal, cursor: 'pointer', fontFamily: fInter,
              }}>Lancer un import ANFR</button>
            </div>
          ) : (
            <>
              {/* KPI cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <StatCard label="Total émetteurs" value={stats.total_emetteurs.toLocaleString('fr-FR')} sub={`FM ${stats.emetteurs_fm.toLocaleString('fr-FR')} · DAB+ ${stats.emetteurs_dab.toLocaleString('fr-FR')}`} />
                <StatCard label="Radios identifiées" value={stats.total_radios.toLocaleString('fr-FR')} sub={`${stats.emetteurs_orphelins} orphelins`} />
                <StatCard label="Taux de matching" value={stats.pct_matching !== null ? `${stats.pct_matching}%` : '—'} color={(stats.pct_matching ?? 0) > 80 ? C.green : (stats.pct_matching ?? 0) > 50 ? C.warn : C.red} sub={`${stats.emetteurs_matches} matchés`} />
                <StatCard label="Dernière MAJ ANFR" value={stats.derniere_maj_anfr ? `${days}j` : '—'} color={freshColor} sub={stats.derniere_maj_anfr ? fmtDate(stats.derniere_maj_anfr) : 'Jamais'} />
              </div>

              {/* Distribution charts */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Par catégorie Arcom', data: stats.par_categorie },
                  { label: 'Par portée', data: stats.par_portee },
                  { label: 'Par genre', data: stats.par_genre },
                ].map(chart => (
                  <div key={chart.label} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                    <SH label={chart.label} />
                    <div style={{ padding: '8px 14px' }}>
                      {Object.entries(chart.data).length === 0 ? (
                        <div style={{ color: C.textDim, fontSize: 12, padding: 8 }}>Aucune donnée</div>
                      ) : (
                        Object.entries(chart.data)
                          .sort(([, a], [, b]) => (b as number) - (a as number))
                          .map(([key, val]) => {
                            const max = Math.max(...Object.values(chart.data).map(Number));
                            const pct = max > 0 ? ((val as number) / max) * 100 : 0;
                            return (
                              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ width: 80, fontSize: 11, color: C.textSec, fontFamily: fInter, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{key}</span>
                                <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${pct}%`, background: C.teal, borderRadius: 3 }} />
                                </div>
                                <span style={{ width: 40, textAlign: 'right', fontSize: 11, fontFamily: fMono, color: C.textDim }}>{(val as number).toLocaleString('fr-FR')}</span>
                              </div>
                            );
                          })
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Archive info */}
              <div style={{ fontSize: 11, color: C.textDim, fontFamily: fMono, textAlign: 'right' }}>
                {stats.archives_count} émetteurs en archive
              </div>
            </>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteDryRun(null); }}
        onConfirm={handleDeleteConfirm}
        title={deleteTarget === 'all' ? 'Supprimer toutes les données radio' : 'Supprimer les émetteurs'}
        message={
          deleteDryRun
            ? `${Object.entries(deleteDryRun).map(([k, v]) => `${v} ${k}`).join(', ')} seront supprimés. Cette action est irréversible.`
            : 'Chargement...'
        }
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
