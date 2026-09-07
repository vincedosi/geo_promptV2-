'use client';

/**
 * Étape 03 de l'import shapefile — insertion en base et suivi en direct.
 *
 * Récapitulatif de ce qui va partir, barre de progression avec débit et ETA,
 * terminal de logs horodatés, puis retour au mapping ou nouvel import.
 *
 * JSX repris tel quel de page.tsx (2026-09-07) ; `pct`, `speed` et `eta`,
 * calculés dans la page mais lus ici seulement, ont suivi.
 */

import React from 'react';
import type { Feature } from '../_lib/shapefile';
import {
  C, fontInter, fontMono, fmtNum, fmtTime,
  type ColumnMapping, type WizardStep,
} from './shared';

export interface ImportStepProps {
  features: Feature[];
  mappings: ColumnMapping[];
  resolution: string;
  millesime: string;

  processImport: () => void;
  isImporting: boolean;
  importDone: boolean;
  importError: string;

  progress: { current: number; total: number } | null;
  elapsed: number;
  logs: string[];
  logRef: React.RefObject<HTMLDivElement>;

  setStep: (n: WizardStep) => void;
  onReset: () => void;
}

export function ImportStep({
  features,
  mappings,
  resolution,
  millesime,
  processImport,
  isImporting,
  importDone,
  importError,
  progress,
  elapsed,
  logs,
  logRef,
  setStep,
  onReset,
}: ImportStepProps) {
  const pct = progress ? Math.round(progress.current / progress.total * 100) : 0;
  const speed = progress && elapsed > 0 ? Math.round(progress.current / elapsed) : 0;
  const eta = progress && speed > 0 ? Math.ceil((progress.total - progress.current) / speed) : 0;

  return (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

    {/* Summary card */}
    <div style={{
      background: C.bgElevated,
      border: `1px solid ${C.border}`,
      borderRadius: 2,
      padding: 20,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
        {[
          { label: 'Features', value: fmtNum(features.length), accent: false },
          { label: 'Colonnes', value: String(mappings.filter(m => m.target !== '__skip__').length), accent: false },
          { label: 'Résolution', value: resolution, accent: true },
          { label: 'Millésime', value: millesime, accent: true },
        ].map(({ label, value, accent }) => (
          <div key={label}>
            <p style={{
              fontFamily: fontInter,
              fontSize: 12,
              fontWeight: 500,
              color: C.textSec,
              margin: 0,
            }}>{label}</p>
            <p style={{
              fontFamily: fontMono,
              fontSize: 22,
              fontWeight: 700,
              color: accent ? C.green : C.text,
              margin: '4px 0 0',
            }}>{value}</p>
          </div>
        ))}
      </div>
    </div>

    {/* Start button */}
    {!isImporting && !importDone && (
      <button
        onClick={processImport}
        style={{
          width: '100%',
          padding: '16px 0',
          borderRadius: 2,
          background: C.green,
          border: 'none',
          color: '#000',
          fontFamily: fontInter,
          fontWeight: 500,
          fontSize: 13,
          cursor: 'pointer',
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      >
        Lancer l&apos;insertion ({fmtNum(features.length)} features)
      </button>
    )}

    {/* Progress bar */}
    {(isImporting || importDone) && progress && (
      <div style={{
        background: C.bgElevated,
        border: `1px solid ${C.border}`,
        borderRadius: 2,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isImporting && (
              <svg
                width="15" height="15" viewBox="0 0 24 24"
                fill="none" stroke={C.green} strokeWidth="2.5"
                className="spin"
                style={{ display: 'inline-block' }}
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            )}
            <span style={{
              fontFamily: fontMono,
              fontSize: 12,
              fontWeight: 700,
              color: importDone ? (importError ? C.red : C.green) : C.warn,
            }}>
              {importDone
                ? (importError ? `! ${importError}` : '✓ Import terminé')
                : `Insertion en cours — ${fmtNum(progress.current)} / ${fmtNum(progress.total)}`
              }
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: fontMono, fontSize: 12, color: C.textDim }}>
            {speed > 0 && <span>{fmtNum(speed)}/s</span>}
            {isImporting && eta > 0 && <span>ETA ~{fmtTime(eta)}</span>}
            <span style={{ fontWeight: 700, color: C.text }}>
              {fmtTime(elapsed)}
            </span>
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{ height: 18, borderRadius: 2, background: C.bgSurface, overflow: 'hidden', border: `1px solid ${C.border}` }}>
            <div
              style={{
                height: '100%',
                borderRadius: 2,
                transition: 'width 0.3s',
                width: `${pct}%`,
                background: importDone
                  ? (importError
                    ? `linear-gradient(90deg, ${C.red}, #fb8a8a)`
                    : `linear-gradient(90deg, ${C.green}, ${C.blue})`)
                  : `linear-gradient(90deg, ${C.warn}, #f97316)`,
                boxShadow: `0 0 10px ${importDone ? (importError ? 'rgba(248,113,113,0.25)' : 'rgba(61,255,160,0.25)') : 'rgba(251,191,36,0.25)'}`,
              }}
            />
          </div>
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{
              fontFamily: fontMono,
              fontSize: 10,
              fontWeight: 700,
              color: '#fff',
              textShadow: '0 1px 3px rgba(0,0,0,0.9)',
            }}>
              {pct}%
            </span>
          </div>
        </div>
      </div>
    )}

    {/* Terminal logs */}
    <div style={{
      background: '#020202',
      border: `1px solid ${C.border}`,
      borderRadius: 2,
      overflow: 'hidden',
    }}>
      {/* Terminal bar */}
      <div style={{
        padding: '8px 14px',
        background: C.bgElevated,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {['#ff5f56', '#ffbd2e', '#27c93f'].map((col, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: col }} />
          ))}
        </div>
        <span style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: C.textSec, marginLeft: 6 }}>
          Import logs
        </span>
        <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginLeft: 'auto' }}>
          {logs.length} lignes
        </span>
      </div>

      {/* Log output */}
      <div
        ref={logRef}
        style={{
          padding: '14px 16px',
          height: 300,
          overflowY: 'auto',
          fontFamily: fontMono,
          fontSize: 11,
          lineHeight: 1.7,
        }}
      >
        {logs.length === 0 ? (
          <p style={{ color: C.muted, margin: 0 }}>En attente du lancement…</p>
        ) : (
          logs.map((line, i) => {
            let color = C.textDim;
            if (line.includes('✕') || line.includes('! ') || line.includes('Exception')) color = C.red;
            else if (line.includes('✓')) color = C.green;
            else if (line.includes('RAPPORT') || line.includes('═')) color = C.blue;
            return (
              <div key={i} style={{ color }}>
                {line}
              </div>
            );
          })
        )}
      </div>
    </div>

    {/* Back / Reset */}
    <div style={{ display: 'flex', gap: 10 }}>
      <button
        onClick={() => setStep(2)}
        disabled={isImporting}
        style={{
          padding: '10px 20px',
          borderRadius: 2,
          background: C.bgElevated,
          border: `1px solid ${C.border}`,
          color: C.textDim,
          fontFamily: fontInter,
          fontSize: 12,
          fontWeight: 500,
          cursor: isImporting ? 'not-allowed' : 'pointer',
          opacity: isImporting ? 0.3 : 1,
        }}
      >
        Retour au mapping
      </button>
      {importDone && (
        <button
          onClick={onReset}
          style={{
            padding: '10px 20px',
            borderRadius: 2,
            background: 'rgba(59,130,246,0.1)',
            border: `1px solid rgba(59,130,246,0.3)`,
            color: C.blue,
            fontFamily: fontInter,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.18)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
        >
          Nouvel import
        </button>
      )}
    </div>
  </div>
  );
}
