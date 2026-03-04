'use client';

/**
 * GEO.Prompt — Page Health Check — /admin/health
 * v4.1.0 — Dashboard de diagnostic système complet
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { APP_VERSION, BUILD_DATE } from '@/lib/version';
import type { Check, HealthResponse } from '@/types/admin';

function StatusIcon({ status }: { status: 'OK' | 'WARN' | 'ERROR' | 'loading' }) {
  if (status === 'loading') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  if (status === 'OK') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === 'WARN') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="2.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function statusColor(status: string) {
  if (status === 'OK') return 'var(--green)';
  if (status === 'WARN') return 'var(--orange)';
  return 'var(--red, #ef4444)';
}

function statusBg(status: string) {
  if (status === 'OK') return 'rgba(34, 197, 94, 0.08)';
  if (status === 'WARN') return 'rgba(251, 146, 60, 0.08)';
  return 'rgba(239, 68, 68, 0.08)';
}

function CheckCard({ check }: { check: Check }) {
  return (
    <div style={{
      padding: '12px 16px',
      background: statusBg(check.status),
      border: `1px solid ${statusColor(check.status)}44`,
      borderRadius: 8,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
    }}>
      {/* Status icon */}
      <div style={{ marginTop: 2, flexShrink: 0 }}>
        <StatusIcon status={check.status} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
            {check.name}
          </span>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'JetBrains Mono, monospace',
            color: statusColor(check.status),
            background: `${statusColor(check.status)}22`,
            padding: '1px 6px',
            borderRadius: 3,
            border: `1px solid ${statusColor(check.status)}44`,
          }}>
            {check.status}
          </span>
        </div>
        {check.value && (
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-dim)', marginBottom: 3 }}>
            {check.value}
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {check.message}
        </div>
      </div>
    </div>
  );
}

export default function HealthPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminFetch('/api/admin/health');
      const data = await res.json();
      setHealth(data);
      setLastFetch(new Date());
    } catch {
      setHealth(null);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const globalStatus = health?.status || 'ERROR';
  const envChecks = health?.checks.filter(c => !c.name.startsWith('SUPABASE_CONNEXION') && !c.name.startsWith('TABLE_')) || [];
  const connChecks = health?.checks.filter(c => c.name === 'SUPABASE_CONNEXION') || [];
  const tableChecks = health?.checks.filter(c => c.name.startsWith('TABLE_')) || [];

  const errCount = health?.checks.filter(c => c.status === 'ERROR').length || 0;
  const warnCount = health?.checks.filter(c => c.status === 'WARN').length || 0;
  const okCount = health?.checks.filter(c => c.status === 'OK').length || 0;

  return (
    <div className="genesis-content" style={{ maxWidth: 900 }}>

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h1 className="page-title">admin / health</h1>
          <span className="g-badge g-badge-orange">SYS</span>
          {!isLoading && health && (
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'JetBrains Mono, monospace',
              color: statusColor(globalStatus),
              background: statusBg(globalStatus),
              padding: '2px 10px',
              borderRadius: 4,
              border: `1px solid ${statusColor(globalStatus)}44`,
            }}>
              {globalStatus}
            </span>
          )}
        </div>
        <p className="page-subtitle">Diagnostic système — variables d&apos;environnement, connectivité Supabase, tables</p>
      </div>

      {/* Global Status Card */}
      <div style={{
        padding: '20px 24px',
        background: isLoading ? 'var(--bg-card)' : statusBg(globalStatus),
        border: `1px solid ${isLoading ? 'var(--border)' : statusColor(globalStatus) + '66'}`,
        borderRadius: 10,
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        {isLoading ? (
          <StatusIcon status="loading" />
        ) : (
          <StatusIcon status={globalStatus} />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: isLoading ? 'var(--text-dim)' : statusColor(globalStatus), marginBottom: 4 }}>
            {isLoading ? 'Diagnostic en cours...' : health?.summary || 'Erreur de connexion au serveur'}
          </div>
          {!isLoading && health && (
            <div style={{ display: 'flex', gap: 16, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
              <span style={{ color: 'var(--green)' }}>✓ {okCount} OK</span>
              {warnCount > 0 && <span style={{ color: 'var(--orange)' }}>⚠ {warnCount} WARN</span>}
              {errCount > 0 && <span style={{ color: 'var(--red)' }}>✗ {errCount} ERROR</span>}
              <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>
                {lastFetch?.toLocaleTimeString('fr-FR')}
              </span>
            </div>
          )}
        </div>
        <button
          className="g-btn"
          onClick={fetchHealth}
          disabled={isLoading}
          style={{ flexShrink: 0 }}
        >
          {isLoading ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          )}
          Re-tester
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Env vars */}
        <div className="g-card">
          <div className="g-card-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="g-card-title">Variables d&apos;environnement</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
              .env.local
            </span>
          </div>
          <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ height: 60, background: 'var(--bg-hover)', borderRadius: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))
            ) : envChecks.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: 20 }}>
                Impossible de récupérer les données
              </div>
            ) : (
              envChecks.map((check) => <CheckCard key={check.name} check={check} />)
            )}
          </div>
        </div>

        {/* Connectivité DB */}
        <div className="g-card">
          <div className="g-card-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
            <span className="g-card-title">Connectivité Supabase</span>
          </div>
          <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isLoading ? (
              <div style={{ height: 60, background: 'var(--bg-hover)', borderRadius: 8 }} />
            ) : (
              connChecks.map((check) => <CheckCard key={check.name} check={check} />)
            )}
          </div>
        </div>

        {/* Tables */}
        <div className="g-card">
          <div className="g-card-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M3 15h18M9 3v18" />
            </svg>
            <span className="g-card-title">Tables Supabase</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
              schema: public
            </span>
          </div>
          <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ height: 60, background: 'var(--bg-hover)', borderRadius: 8 }} />
              ))
            ) : (
              tableChecks.map((check) => <CheckCard key={check.name} check={check} />)
            )}
            {!isLoading && tableChecks.some(c => c.status === 'ERROR') && (
              <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.06)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)' }}>
                <span style={{ color: 'var(--red)' }}>// FIX: </span>
                Ouvrir Supabase Dashboard → SQL Editor → executer le script de migration SQL
              </div>
            )}

          </div>
        </div>

        {/* Database Overview */}
        {!isLoading && health?.database && (
          <div className="g-card">
            <div className="g-card-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                <path d="M3 3h18v18H3z" />
                <path d="M3 9h18M9 3v18" />
              </svg>
              <span className="g-card-title">Database Overview</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
                {health.database.total_tables} tables · {health.database.total_rows.toLocaleString('fr-FR')} lignes
              </span>
            </div>
            <div className="g-card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                <div style={{ padding: '12px 16px', background: 'var(--bg-subtle)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Tables
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>
                    {health.database.total_tables}
                  </div>
                </div>
                <div style={{ padding: '12px 16px', background: 'var(--bg-subtle)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Lignes totales
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--green)' }}>
                    {health.database.total_rows.toLocaleString('fr-FR')}
                  </div>
                </div>
                <div style={{ padding: '12px 16px', background: 'var(--bg-subtle)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Espace total
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--orange)' }}>
                    {health.database.total_size}
                  </div>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 700 }}>Table</th>
                      <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 700 }}>Lignes</th>
                      <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 700 }}>Taille totale</th>
                      <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 700 }}>Table</th>
                      <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 700 }}>Index</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.database.tables.map((table, idx) => (
                      <tr
                        key={table.table_name}
                        style={{
                          borderBottom: idx < health.database.tables.length - 1 ? '1px solid var(--border)' : 'none',
                          background: idx % 2 === 0 ? 'transparent' : 'var(--bg-subtle)',
                        }}
                      >
                        <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontWeight: 600 }}>
                          {table.table_name}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {table.row_count.toLocaleString('fr-FR')}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--accent)' }}>
                          {table.total_size}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-dim)' }}>
                          {table.table_size}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-dim)' }}>
                          {table.indexes_size}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {health.database.total_size === 'N/A' && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(251,146,60,0.06)', borderRadius: 8, border: '1px solid rgba(251,146,60,0.2)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)' }}>
                  <span style={{ color: 'var(--orange)' }}>💡 INFO: </span>
                  Pour afficher les tailles, executez le script <span style={{ color: 'var(--accent)' }}>sql/004_get_table_sizes_function.sql</span> dans Supabase SQL Editor
                </div>
              )}

            </div>
          </div>
        )}

        {/* Build info */}
        <div className="g-card">
          <div className="g-card-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span className="g-card-title">Build info</span>
          </div>
          <div className="g-card-body">
            <div className="g-code" style={{ fontSize: 11 }}>
              <div><span style={{ color: 'var(--text-dim)' }}>app:     </span><span style={{ color: 'var(--accent)' }}>GEO.Prompt</span></div>
              <div><span style={{ color: 'var(--text-dim)' }}>version: </span><span style={{ color: 'var(--green)' }}>v{APP_VERSION}</span></div>
              <div><span style={{ color: 'var(--text-dim)' }}>build:   </span><span style={{ color: 'var(--text-primary)' }}>{BUILD_DATE}</span></div>
              <div><span style={{ color: 'var(--text-dim)' }}>stack:   </span><span style={{ color: 'var(--text-primary)' }}>Next.js 14 · Supabase · PostGIS · Mapbox</span></div>
              <div><span style={{ color: 'var(--text-dim)' }}>checked: </span><span style={{ color: 'var(--text-primary)' }}>{lastFetch?.toLocaleString('fr-FR') || '—'}</span></div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
