'use client';

/**
 * Journal d'import en direct — compteurs OK/SKIP/ERR et flux de lignes
 * remontées par le stream SSE de /api/admin/import-poi/execute.
 *
 * Le conteneur est scrollé par la page parente via `containerRef` (auto-scroll
 * en bas à chaque nouvelle ligne).
 *
 * JSX repris tel quel de page.tsx (2026-09-03).
 */

import React from 'react';
import { C, fontMono } from './shared';

export interface LogLine {
  level: string;
  line: string;
  ts: number;
}

export interface ImportLogPanelProps {
  logLines: LogLine[];
  containerRef: React.RefObject<HTMLDivElement>;
  isImporting: boolean;
}

export function ImportLogPanel({ logLines, containerRef, isImporting }: ImportLogPanelProps) {
  return (
    <div style={{ marginTop: 16 }}>
      {/* Log header with counters */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 6,
        fontFamily: fontMono,
        fontSize: 10,
      }}>
        <span style={{ color: C.muted, fontWeight: 700 }}>{'// JOURNAL EN DIRECT'}</span>
        <span style={{ color: C.green }}>
          OK {logLines.filter(l => l.level === 'info' && l.line.startsWith('[OK]')).length}
        </span>
        <span style={{ color: C.warn }}>
          SKIP {logLines.filter(l => l.level === 'warn' && l.line.startsWith('[SKIP]')).length}
        </span>
        <span style={{ color: C.red }}>
          ERR {logLines.filter(l => l.level === 'error' && l.line.startsWith('[ERR]')).length}
        </span>
        <span style={{ color: C.muted, marginLeft: 'auto' }}>
          {logLines.length} lignes
        </span>
      </div>

      {/* Scrollable log container */}
      <div
        ref={containerRef}
        style={{
          background: 'var(--bg-primary)',
          border: `1px solid ${C.border}`,
          borderRadius: 2,
          padding: '8px 12px',
          maxHeight: 350,
          overflowY: 'auto',
          fontFamily: fontMono,
          fontSize: 10,
          lineHeight: 1.7,
        }}
      >
        {logLines.map((log, idx) => (
          <div key={idx} style={{
            color: log.level === 'error'
              ? C.red
              : log.level === 'warn'
                ? C.warn
                : log.line.startsWith('[OK]')
                  ? C.green
                  : C.muted,
            borderBottom: log.line.startsWith('---') ? `1px solid ${C.border}` : 'none',
            paddingBottom: log.line.startsWith('---') ? 2 : 0,
            marginBottom: log.line.startsWith('---') ? 2 : 0,
          }}>
            {log.line}
          </div>
        ))}
        {isImporting && (
          <div style={{ color: C.accent }}>
            {'>'} en cours...
          </div>
        )}
      </div>
    </div>
  );
}
