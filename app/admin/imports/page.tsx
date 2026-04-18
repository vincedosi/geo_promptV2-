'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

const C = {
  bg: 'var(--bg-primary)', bgElevated: 'var(--bg-surface)', bgSurface: 'var(--bg-level-2)',
  border: 'var(--border-subtle)', borderLight: 'var(--brand-teal-30)',
  accent: 'var(--brand-teal)', accentDim: 'var(--brand-teal-10)',
  text: 'var(--text-primary)', textDim: 'var(--text-secondary)', textSec: 'var(--text-tertiary)',
  green: 'var(--success)', greenDim: 'rgba(61,255,160,0.12)',
  red: '#f87171', redDim: 'rgba(248,113,113,0.1)',
  warn: '#fbbf24', warnDim: 'rgba(251,191,36,0.1)',
  blue: '#3b82f6', blueDim: 'rgba(59,130,246,0.12)',
};
const fontMono = "'JetBrains Mono', monospace";
const fontInter = "'Inter', system-ui, sans-serif";

interface ImportRow {
  id: string;
  kind: 'ooh' | 'source';
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  total: number;
  inserted: number;
  updated: number;
  duplicates: number;
  errors: number;
  type?: string;
  org_name: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const s = status?.toLowerCase();
  const color = s === 'success' || s === 'active' || s === 'termine' ? C.green
    : s === 'error' || s === 'deleted' ? C.red
    : s === 'running' || s === 'pending' ? C.warn
    : C.textDim;
  const bg = s === 'success' || s === 'active' || s === 'termine' ? C.greenDim
    : s === 'error' || s === 'deleted' ? C.redDim
    : s === 'running' || s === 'pending' ? C.warnDim
    : C.bgSurface;
  return (
    <span style={{ fontFamily: fontMono, fontSize: 10, color, background: bg, border: `1px solid ${color}`, borderRadius: 2, padding: '2px 6px' }}>
      {status ?? '—'}
    </span>
  );
}

function KindBadge({ kind, type }: { kind: string; type?: string }) {
  const label = kind === 'ooh' ? 'OOH' : (type ?? 'source').toUpperCase();
  const color = kind === 'ooh' ? C.accent : C.blue;
  const bg = kind === 'ooh' ? C.accentDim : C.blueDim;
  const bd = kind === 'ooh' ? C.borderLight : 'rgba(59,130,246,0.3)';
  return (
    <span style={{ fontFamily: fontMono, fontSize: 10, color, background: bg, border: `1px solid ${bd}`, borderRadius: 2, padding: '2px 6px' }}>
      {label}
    </span>
  );
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('fr-FR');
}

export default function ImportsPage() {
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'ooh' | 'source'>('all');

  const fetchImports = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/imports');
      const data = await res.json();
      if (data.success) setImports(data.imports || []);
      else setError(data.error || 'Erreur');
    } catch (e: unknown) { setError(String(e)); }
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchImports(); }, [fetchImports]);

  const filtered = filter === 'all' ? imports : imports.filter(i => i.kind === filter);

  const totalInserted = filtered.reduce((a, i) => a + (i.inserted ?? 0), 0);
  const totalErrors = filtered.reduce((a, i) => a + (i.errors ?? 0), 0);
  const totalRuns = filtered.length;

  return (
    <div style={{ maxWidth: 1100, padding: '24px 20px', fontFamily: fontInter, color: C.text, background: C.bg, minHeight: '100vh' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontFamily: fontInter, fontSize: 18, fontWeight: 500, color: C.text, margin: 0 }}>
            Historique des imports
          </h1>
        </div>
        <p style={{ fontFamily: fontInter, fontSize: 12, color: C.textDim, margin: 0 }}>
          Historique global de tous les imports — OOH ArcGIS + sources CSV/Shapefile
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Runs', value: fmt(totalRuns), color: C.textDim },
          { label: 'Enregistrements importés', value: fmt(totalInserted), color: C.green },
          { label: 'Erreurs', value: fmt(totalErrors), color: totalErrors > 0 ? C.red : C.textDim },
        ].map(s => (
          <div key={s.label} style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '12px 20px', flex: 1 }}>
            <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontFamily: fontMono, fontSize: 20, color: s.color, fontWeight: 700 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['all', 'ooh', 'source'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 14px', borderRadius: 2, border: `1px solid ${filter === f ? C.accent : C.border}`,
            background: filter === f ? C.accentDim : 'none', color: filter === f ? C.accent : C.textDim,
            fontFamily: fontInter, fontSize: 12, cursor: 'pointer',
          }}>
            {f === 'all' ? 'Tous' : f.toUpperCase()}
          </button>
        ))}
        <button onClick={fetchImports} style={{
          marginLeft: 'auto', padding: '6px 14px', borderRadius: 2, border: `1px solid ${C.border}`,
          background: 'none', color: C.textDim, fontFamily: fontInter, fontSize: 12, cursor: 'pointer',
        }}>
          Rafraîchir
        </button>
      </div>

      {/* Table */}
      <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2 }}>
        {error && (
          <div style={{ padding: '12px 16px', color: C.red, fontFamily: fontMono, fontSize: 11, borderBottom: `1px solid ${C.border}` }}>
            ! {error}
          </div>
        )}
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.textDim, fontFamily: fontMono, fontSize: 12 }}>chargement...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.textDim, fontFamily: fontMono, fontSize: 12 }}>Aucun import</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Type', 'Source', 'Workspace', 'Démarré le', 'Statut', 'Total', 'Insérés', 'MAJ', 'Erreurs'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontFamily: fontInter, fontSize: 11, color: C.textDim, fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(imp => (
                <tr key={imp.id} style={{ borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.bgSurface)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '10px 12px' }}>
                    <KindBadge kind={imp.kind} type={imp.type} />
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 11, color: C.text, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {imp.source}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 11, color: C.textDim }}>
                    {imp.org_name ?? <span style={{ color: C.textSec }}>global</span>}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 11, color: C.textDim }}>
                    {imp.started_at ? new Date(imp.started_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <StatusBadge status={imp.status} />
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 12, color: C.textDim, textAlign: 'right' }}>{fmt(imp.total)}</td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 12, color: C.green, textAlign: 'right' }}>{fmt(imp.inserted)}</td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 12, color: C.warn, textAlign: 'right' }}>{fmt(imp.updated)}</td>
                  <td style={{ padding: '10px 12px', fontFamily: fontMono, fontSize: 12, color: imp.errors > 0 ? C.red : C.textDim, textAlign: 'right' }}>{fmt(imp.errors)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
