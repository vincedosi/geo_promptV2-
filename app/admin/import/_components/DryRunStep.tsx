'use client';

/**
 * Étape 04 du wizard d'import — dry-run sur les 100 premières lignes.
 *
 * Restitue les compteurs valides / sans coordonnées / exclus, les statistiques
 * de géocodage quand il y en a, un aperçu cartographique des points obtenus et
 * le détail des lignes en erreur, avant de laisser lancer l'import réel.
 *
 * JSX repris tel quel de page.tsx (2026-09-03).
 */

import React from 'react';
import type { DryRunResult } from '@/lib/import/types';
import { C, fontInter, fontMono, Spinner } from './shared';
import {
  badgeGreen, btnSuccess,
  card, cardBody, cardHeader, cardTitle, stepNum,
} from './styles';

/**
 * URL d'une carte OSM embarquée cadrée sur les points de l'échantillon.
 * Renvoie une chaîne vide quand il n'y a rien à montrer.
 */
function getMapPreviewUrl(points: { lat: number; lng: number }[]): string {
  if (!points || points.length === 0) return '';
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats) - 0.01;
  const maxLat = Math.max(...lats) + 0.01;
  const minLng = Math.min(...lngs) - 0.01;
  const maxLng = Math.max(...lngs) + 0.01;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${minLng},${minLat},${maxLng},${maxLat}&layer=mapnik`;
}

export interface DryRunStepProps {
  dryRunResult: DryRunResult | null;
  handleDryRun: () => void;
  isDryRunning: boolean;
}

export function DryRunStep({ dryRunResult, handleDryRun, isDryRunning }: DryRunStepProps) {
  return (
    <div style={card}>
      <div style={cardHeader}>
        <span style={stepNum}>04</span>
        <span style={cardTitle}>Test (dry-run)</span>
        {dryRunResult?.success && (
          <span style={{ ...badgeGreen, marginLeft: 'auto' }}>
            {dryRunResult.stats.validRows} valides
          </span>
        )}
      </div>
      <div style={cardBody}>
        <button
          onClick={handleDryRun}
          disabled={isDryRunning}
          style={{ ...btnSuccess, minWidth: 200, opacity: isDryRunning ? 0.6 : 1 }}
        >
          {isDryRunning ? <><Spinner /> Test en cours...</> : '> Tester (100 lignes)'}
        </button>

        {dryRunResult?.success && (
          <div style={{ marginTop: 16 }}>
            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                { label: 'Valides', val: dryRunResult.stats.validRows, color: C.green },
                { label: 'Sans coords', val: dryRunResult.stats.missingCoords, color: C.warn },
                { label: 'Exclus', val: dryRunResult.stats.invalidRows, color: C.red },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: 12 }}>
                  <div style={{ fontFamily: fontInter, fontSize: 8, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>{label}</div>
                  <div style={{ fontFamily: fontInter, fontSize: 22, color, fontWeight: 700 }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Additional geocoding stats */}
            {dryRunResult.stats.geocodedRows !== undefined && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 10 }}>
                {[
                  { label: 'Geocodes', val: dryRunResult.stats.geocodedRows, color: C.accent },
                  { label: 'Echecs geocodage', val: dryRunResult.stats.geocodeErrors, color: C.red },
                  { label: 'Total fichier', val: dryRunResult.stats.totalRows.toLocaleString(), color: C.textDim },
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: 12 }}>
                    <div style={{ fontFamily: fontInter, fontSize: 8, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>{label}</div>
                    <div style={{ fontFamily: fontInter, fontSize: 22, color, fontWeight: 700 }}>{val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Map preview */}
            {dryRunResult.samplePoints.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginBottom: 6 }}>
                  {'// apercu carte — {dryRunResult.samplePoints.length} premiers points'}
                </div>
                <iframe
                  src={getMapPreviewUrl(dryRunResult.samplePoints)}
                  width="100%"
                  height="250"
                  style={{ border: `1px solid ${C.border}`, borderRadius: 2, display: 'block' }}
                  title="Apercu carte"
                />
              </div>
            )}

            {/* Sample points list */}
            {dryRunResult.samplePoints.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, cursor: 'pointer' }}>
                  Points d&apos;apercu ({dryRunResult.samplePoints.length})
                </summary>
                <pre style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: 10, fontFamily: fontMono, fontSize: 10, maxHeight: 150, overflow: 'auto', marginTop: 6, color: C.textDim }}>
                  {JSON.stringify(dryRunResult.samplePoints, null, 2)}
                </pre>
              </details>
            )}

            {/* Errors */}
            {dryRunResult.errors.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.warn, cursor: 'pointer' }}>
                  Erreurs ({dryRunResult.errors.length})
                </summary>
                <pre style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: 10, fontFamily: fontMono, fontSize: 10, maxHeight: 150, overflow: 'auto', marginTop: 6, color: C.warn }}>
                  {dryRunResult.errors.map((e) => `Ligne ${e.row}: [${e.field}] ${e.message}`).join('\n')}
                </pre>
              </details>
            )}
          </div>
        )}

        {dryRunResult && !dryRunResult.success && (
          <div style={{ marginTop: 12, background: C.redDim, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red }}>
            ! {dryRunResult.error}
          </div>
        )}
      </div>
    </div>
  );
}
