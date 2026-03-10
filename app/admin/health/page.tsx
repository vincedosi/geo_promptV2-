'use client';

/**
 * GEO.Prompt — Page Health Check — /admin/health
 * v4.1.0 — Dashboard de diagnostic système complet
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { APP_VERSION, BUILD_DATE } from '@/lib/version';
import type { Check, HealthResponse } from '@/types/admin';

const C = {
  bg:          '#050505',
  bgElevated:  '#0d0d0d',
  bgSurface:   '#111118',
  border:      '#261a35',
  borderLight: 'rgba(168,85,247,0.2)',
  accent:      '#a855f7',
  accentDim:   'rgba(168,85,247,0.12)',
  text:        '#e2e8f0',
  textDim:     '#94a3b8',
  textSec:     '#6b7280',
  muted:       '#4b5563',
  green:       '#3dffa0',
  greenDim:    'rgba(61,255,160,0.12)',
  red:         '#f87171',
  redDim:      'rgba(248,113,113,0.1)',
  warn:        '#fbbf24',
  warnDim:     'rgba(251,191,36,0.1)',
  blue:        '#3b82f6',
};
const fontOrbitron = "'Orbitron', sans-serif";
const fontMichroma = "'Michroma', 'Orbitron', sans-serif";
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

function StatusIcon({ status }: { status: 'OK' | 'WARN' | 'ERROR' | 'loading' }) {
  if (status === 'loading') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  if (status === 'OK') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3dffa0" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === 'WARN') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function statusColor(status: string) {
  if (status === 'OK') return C.green;
  if (status === 'WARN') return C.warn;
  return C.red;
}

function statusBg(status: string) {
  if (status === 'OK') return C.greenDim;
  if (status === 'WARN') return C.warnDim;
  return C.redDim;
}

function CheckCard({ check }: { check: Check }) {
  const color = statusColor(check.status);
  const bg = statusBg(check.status);
  return (
    <div style={{
      padding: '12px 16px',
      background: bg,
      border: `1px solid ${color}44`,
      borderRadius: 2,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
    }}>
      <div style={{ marginTop: 2, flexShrink: 0 }}>
        <StatusIcon status={check.status} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontFamily: fontMono, fontSize: 12, fontWeight: 700, color: C.text }}>
            {check.name}
          </span>
          <span style={{
            fontSize: 8,
            fontWeight: 700,
            fontFamily: fontMichroma,
            color: color,
            background: `${color}22`,
            padding: '1px 6px',
            borderRadius: 2,
            border: `1px solid ${color}44`,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            {check.status}
          </span>
        </div>
        {check.value && (
          <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, marginBottom: 3 }}>
            {check.value}
          </div>
        )}
        <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5, fontFamily: fontInter }}>
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

  const cardStyle: React.CSSProperties = {
    background: C.bgElevated,
    border: `1px solid ${C.border}`,
    borderRadius: 2,
    overflow: 'hidden',
  };
  const cardHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderBottom: `1px solid ${C.border}`,
    background: C.bgSurface,
  };
  const cardTitleStyle: React.CSSProperties = {
    fontFamily: fontMichroma,
    fontSize: 9,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: C.accent,
  };
  const cardBodyStyle: React.CSSProperties = {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  };

  return (
    <div style={{ maxWidth: 900, fontFamily: fontInter }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontFamily: fontOrbitron, fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>
            admin / health
          </h1>
          <span style={{
            fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: C.warn, background: C.warnDim, border: `1px solid ${C.warn}44`,
            padding: '2px 8px', borderRadius: 2,
          }}>SYS</span>
          {!isLoading && health && (
            <span style={{
              fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: statusColor(globalStatus),
              background: statusBg(globalStatus),
              padding: '2px 10px',
              borderRadius: 2,
              border: `1px solid ${statusColor(globalStatus)}44`,
            }}>
              {globalStatus}
            </span>
          )}
        </div>
        <p style={{ color: C.textDim, fontSize: 13, margin: 0, fontFamily: fontInter }}>
          Diagnostic système — variables d&apos;environnement, connectivité Supabase, tables
        </p>
      </div>

      {/* Global Status Card */}
      <div style={{
        padding: '20px 24px',
        background: isLoading ? C.bgElevated : statusBg(globalStatus),
        border: `1px solid ${isLoading ? C.border : statusColor(globalStatus) + '66'}`,
        borderRadius: 2,
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
          <div style={{
            fontSize: 15, fontWeight: 700,
            color: isLoading ? C.textDim : statusColor(globalStatus),
            marginBottom: 4,
            fontFamily: fontMono,
          }}>
            {isLoading ? 'Diagnostic en cours...' : health?.summary || 'Erreur de connexion au serveur'}
          </div>
          {!isLoading && health && (
            <div style={{ display: 'flex', gap: 16, fontSize: 12, fontFamily: fontMono }}>
              <span style={{ color: C.green }}>✓ {okCount} OK</span>
              {warnCount > 0 && <span style={{ color: C.warn }}>! {warnCount} WARN</span>}
              {errCount > 0 && <span style={{ color: C.red }}>✕ {errCount} ERROR</span>}
              <span style={{ color: C.textDim, marginLeft: 'auto' }}>
                {lastFetch?.toLocaleTimeString('fr-FR')}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={fetchHealth}
          disabled={isLoading}
          style={{
            flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 6,
            background: C.accentDim,
            border: `1px solid ${C.borderLight}`,
            borderRadius: 2,
            color: C.accent,
            fontFamily: fontMichroma,
            fontSize: 9,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            padding: '7px 14px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.5 : 1,
          }}
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
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span style={cardTitleStyle}>Variables d&apos;environnement</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textDim, fontFamily: fontMono }}>
              .env.local
            </span>
          </div>
          <div style={cardBodyStyle}>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ height: 60, background: C.bgSurface, borderRadius: 2, animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))
            ) : envChecks.length === 0 ? (
              <div style={{ color: C.textDim, fontSize: 12, textAlign: 'center', padding: 20, fontFamily: fontInter }}>
                Impossible de récupérer les données
              </div>
            ) : (
              envChecks.map((check) => <CheckCard key={check.name} check={check} />)
            )}
          </div>
        </div>

        {/* Connectivité DB */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
            <span style={cardTitleStyle}>Connectivité Supabase</span>
          </div>
          <div style={cardBodyStyle}>
            {isLoading ? (
              <div style={{ height: 60, background: C.bgSurface, borderRadius: 2 }} />
            ) : (
              connChecks.map((check) => <CheckCard key={check.name} check={check} />)
            )}
          </div>
        </div>

        {/* Tables */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M3 15h18M9 3v18" />
            </svg>
            <span style={cardTitleStyle}>Tables Supabase</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textDim, fontFamily: fontMono }}>
              schema: public
            </span>
          </div>
          <div style={cardBodyStyle}>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ height: 60, background: C.bgSurface, borderRadius: 2 }} />
              ))
            ) : (
              tableChecks.map((check) => <CheckCard key={check.name} check={check} />)
            )}
            {!isLoading && tableChecks.some(c => c.status === 'ERROR') && (
              <div style={{
                padding: '10px 14px',
                background: C.redDim,
                borderRadius: 2,
                border: `1px solid ${C.red}33`,
                fontSize: 11,
                fontFamily: fontMono,
                color: C.textDim,
              }}>
                <span style={{ color: C.red }}>// FIX: </span>
                Ouvrir Supabase Dashboard → SQL Editor → executer le script de migration SQL
              </div>
            )}
          </div>
        </div>

        {/* Database Overview */}
        {!isLoading && health?.database && (
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2">
                <path d="M3 3h18v18H3z" />
                <path d="M3 9h18M9 3v18" />
              </svg>
              <span style={cardTitleStyle}>Database Overview</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textDim, fontFamily: fontMono }}>
                {health.database.total_tables} tables · {health.database.total_rows.toLocaleString('fr-FR')} lignes
              </span>
            </div>
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                <div style={{ padding: '12px 16px', background: C.bgSurface, borderRadius: 2, border: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textDim, marginBottom: 6 }}>
                    Tables
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fontMono, color: C.accent }}>
                    {health.database.total_tables}
                  </div>
                </div>
                <div style={{ padding: '12px 16px', background: C.bgSurface, borderRadius: 2, border: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textDim, marginBottom: 6 }}>
                    Lignes totales
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fontMono, color: C.green }}>
                    {health.database.total_rows.toLocaleString('fr-FR')}
                  </div>
                </div>
                <div style={{ padding: '12px 16px', background: C.bgSurface, borderRadius: 2, border: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textDim, marginBottom: 6 }}>
                    Espace tables
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fontMono, color: C.warn }}>
                    {health.database.total_size}
                  </div>
                </div>
              </div>

              {/* Database size bar — Supabase Free = 500 MB, Pro = 8 GB */}
              {health.database.db_size_bytes != null && health.database.db_size_bytes > 0 && (() => {
                const usedBytes = health.database.db_size_bytes!;
                const quotaBytes = usedBytes > 500 * 1024 * 1024 ? 8 * 1024 * 1024 * 1024 : 500 * 1024 * 1024;
                const pct = Math.min(100, (usedBytes / quotaBytes) * 100);
                const quotaLabel = quotaBytes >= 1024 * 1024 * 1024 ? `${(quotaBytes / (1024 * 1024 * 1024)).toFixed(0)} GB` : `${(quotaBytes / (1024 * 1024)).toFixed(0)} MB`;
                const barColor = pct > 90 ? C.red : pct > 70 ? C.warn : C.green;
                return (
                  <div style={{ marginBottom: 16, padding: '12px 16px', background: C.bgSurface, borderRadius: 2, border: `1px solid ${C.border}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textSec }}>
                        Espace base de données
                      </span>
                      <span style={{ fontSize: 11, fontFamily: fontMono, color: barColor, fontWeight: 700 }}>
                        {health.database.db_size} / {quotaLabel}
                        <span style={{ color: C.textDim, fontWeight: 400 }}> ({pct.toFixed(1)}%)</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 2, background: barColor, width: `${pct}%`, transition: 'width 0.4s ease' }} />
                    </div>
                    <div style={{ marginTop: 6, fontSize: 10, color: C.textDim, fontFamily: fontMono }}>
                      {pct > 90 ? '! Espace critique — pensez à upgrader ou purger des données'
                       : pct > 70 ? '! Espace élevé — surveillez la consommation'
                       : '✓ Espace suffisant'}
                      {' · '}quota estimé {quotaBytes > 500 * 1024 * 1024 ? 'Pro (8 GB)' : 'Free (500 MB)'}
                    </div>
                  </div>
                );
              })()}

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 11, fontFamily: fontMono, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {(['Table', 'Lignes', 'Taille totale', 'Table', 'Index'] as const).map((h, i) => (
                        <th key={i} style={{
                          textAlign: i === 0 ? 'left' : 'right',
                          padding: '8px 12px',
                          fontFamily: fontMichroma,
                          fontSize: 8,
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                          color: C.textDim,
                          fontWeight: 700,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {health.database.tables.map((table, idx) => (
                      <tr
                        key={table.table_name}
                        style={{
                          borderBottom: idx < health.database.tables.length - 1 ? `1px solid ${C.border}` : 'none',
                          background: idx % 2 === 0 ? 'transparent' : C.bgSurface,
                        }}
                      >
                        <td style={{ padding: '10px 12px', color: C.text, fontWeight: 600 }}>
                          {table.table_name}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: C.textSec }}>
                          {table.row_count.toLocaleString('fr-FR')}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: C.accent }}>
                          {table.total_size}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: C.textDim }}>
                          {table.table_size}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: C.textDim }}>
                          {table.indexes_size}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {health.database.total_size === 'N/A' && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: C.warnDim, borderRadius: 2, border: `1px solid ${C.warn}33`, fontSize: 11, fontFamily: fontMono, color: C.textDim }}>
                  <span style={{ color: C.warn }}>! </span>
                  Tailles indisponibles — configurez <span style={{ color: C.accent }}>SUPABASE_DB_URL</span> dans .env.local ou exécutez <span style={{ color: C.accent }}>sql/004_get_table_sizes_function.sql</span> dans Supabase SQL Editor
                </div>
              )}
              {health.database.total_size?.startsWith('~') && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(59,130,246,0.07)', borderRadius: 2, border: `1px solid ${C.blue}33`, fontSize: 11, fontFamily: fontMono, color: C.textDim }}>
                  <span style={{ color: C.blue }}>i </span>
                  Tailles estimées (~200-500 bytes/ligne). Pour les tailles exactes : configurez <span style={{ color: C.accent }}>SUPABASE_DB_URL</span> dans .env.local
                </div>
              )}

            </div>
          </div>
        )}

        {/* Build info */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span style={cardTitleStyle}>Build info</span>
          </div>
          <div style={{ padding: '16px' }}>
            <div style={{
              fontFamily: fontMono,
              fontSize: 11,
              background: C.bgSurface,
              border: `1px solid ${C.border}`,
              borderRadius: 2,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              lineHeight: 1.7,
            }}>
              <div><span style={{ color: C.textDim }}>app:     </span><span style={{ color: C.accent }}>GEO.Prompt</span></div>
              <div><span style={{ color: C.textDim }}>version: </span><span style={{ color: C.green }}>v{APP_VERSION}</span></div>
              <div><span style={{ color: C.textDim }}>build:   </span><span style={{ color: C.text }}>{BUILD_DATE}</span></div>
              <div><span style={{ color: C.textDim }}>stack:   </span><span style={{ color: C.text }}>Next.js 14 · Supabase · PostGIS · Mapbox</span></div>
              <div><span style={{ color: C.textDim }}>checked: </span><span style={{ color: C.text }}>{lastFetch?.toLocaleString('fr-FR') || '—'}</span></div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
