'use client';

/**
 * Étape 05 du wizard d'import — insertion réelle en base.
 *
 * Nommage de la source, choix de l'organisation, puis lancement du stream SSE
 * avec barre de progression, rapport final et journal en direct.
 *
 * JSX repris tel quel de page.tsx (2026-09-03).
 */

import React from 'react';
import type { ImportProgress, ImportReport, ParseResult } from '@/lib/import/types';
import { C, fontInter, fontMono, Spinner } from './shared';
import {
  badgeGreen, btnDanger,
  card, cardBody, cardHeader, cardTitle,
  inputStyle, sLabel, stepNum,
} from './styles';
import { ImportLogPanel, type LogLine } from './ImportLogPanel';

/** Organisation par défaut quand la liste n'est pas encore chargée. */
const ORG_GLOBALE_FALLBACK = '00000000-0000-0000-0000-000000000001';

export interface ImportStepProps {
  parseResult: ParseResult | null;

  sourceName: string;
  setSourceName: (v: string) => void;
  organizationId: string;
  setOrganizationId: (v: string) => void;
  organizations: { id: string; name: string }[];

  handleImport: () => void;
  isImporting: boolean;
  importProgress: ImportProgress | null;
  importReport: ImportReport | null;

  logLines: LogLine[];
  logContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function ImportStep({
  parseResult,
  sourceName,
  setSourceName,
  organizationId,
  setOrganizationId,
  organizations,
  handleImport,
  isImporting,
  importProgress,
  importReport,
  logLines,
  logContainerRef,
}: ImportStepProps) {
  return (
    <div style={card}>
      <div style={cardHeader}>
        <span style={stepNum}>05</span>
        <span style={cardTitle}>Import reel</span>
        {importReport && (
          <span style={{ ...badgeGreen, marginLeft: 'auto' }}>
            {importReport.inserted.toLocaleString()} inseres
          </span>
        )}
      </div>
      <div style={cardBody}>
        {/* Source metadata */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={sLabel}>Nom de la source (optionnel)</label>
            <input
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder={`Import POI — ${new Date().toLocaleDateString('fr-FR')}`}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={sLabel}>Organisation</label>
            <select
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              style={inputStyle}
            >
              {organizations.length > 0 ? (
                organizations.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))
              ) : (
                <option value={ORG_GLOBALE_FALLBACK}>GENESIS (Global)</option>
              )}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={handleImport}
            disabled={isImporting}
            style={{ ...btnDanger, minWidth: 200, opacity: isImporting ? 0.6 : 1 }}
          >
            {isImporting ? <><Spinner /> Import en cours...</> : 'LANCER L\'IMPORT REEL'}
          </button>
          <span style={{ fontFamily: fontMono, fontSize: 11, color: C.red }}>
            ! Insertion en base Supabase ({parseResult?.totalRows.toLocaleString()} lignes)
          </span>
        </div>

        {/* Progress bar */}
        {importProgress && importProgress.total && importProgress.total > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, height: 6, overflow: 'hidden', marginBottom: 8 }}>
              <div
                style={{
                  height: '100%',
                  background: C.accent,
                  borderRadius: 2,
                  width: `${((importProgress.processed || 0) / importProgress.total) * 100}%`,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 16, fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
              <span>traites: <span style={{ color: C.text }}>{(importProgress.processed || 0).toLocaleString()}/{importProgress.total.toLocaleString()}</span></span>
              {importProgress.inserted !== undefined && <span>inseres: <span style={{ color: C.green }}>{importProgress.inserted.toLocaleString()}</span></span>}
              {importProgress.ignored !== undefined && importProgress.ignored > 0 && <span>ignores: <span style={{ color: C.warn }}>{importProgress.ignored.toLocaleString()}</span></span>}
              {importProgress.errors !== undefined && importProgress.errors > 0 && <span>erreurs: <span style={{ color: C.red }}>{importProgress.errors.toLocaleString()}</span></span>}
            </div>
          </div>
        )}

        {/* Geocoding progress */}
        {importProgress?.type === 'geocode' && (
          <div style={{ marginTop: 8, fontFamily: fontMono, fontSize: 11, color: C.accent }}>
            {importProgress.message}
          </div>
        )}

        {/* Error message */}
        {importProgress?.type === 'error' && (
          <div style={{ marginTop: 12, background: C.redDim, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red }}>
            ! {importProgress.message}
          </div>
        )}

        {/* Final report */}
        {importReport && (
          <div style={{ marginTop: 16 }}>
            {importReport.errors > 0 && importReport.inserted === 0 ? (
              <div style={{ background: C.redDim, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red, marginBottom: 10 }}>
                ! Import echoue — {importReport.errors} erreurs, 0 inseres
              </div>
            ) : importReport.errors > 0 ? (
              <div style={{ background: C.warnDim, border: `1px solid rgba(251,191,36,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.warn, marginBottom: 10 }}>
                ! Import partiel — {importReport.inserted} inseres, {importReport.errors} erreurs
              </div>
            ) : (
              <div style={{ background: C.greenDim, border: `1px solid rgba(61,255,160,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.green, marginBottom: 10 }}>
                [OK] Import termine avec succes
              </div>
            )}
            <div style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: 12, fontFamily: fontMono, fontSize: 11, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <div><span style={{ color: C.muted }}>total: </span><span style={{ color: C.text }}>{importReport.total.toLocaleString()}</span></div>
              <div><span style={{ color: C.muted }}>inseres: </span><span style={{ color: C.green }}>{importReport.inserted.toLocaleString()}</span></div>
              <div><span style={{ color: C.muted }}>ignores: </span><span style={{ color: C.warn }}>{importReport.ignored.toLocaleString()}</span></div>
              <div><span style={{ color: C.muted }}>erreurs: </span><span style={{ color: importReport.errors > 0 ? C.red : C.text }}>{importReport.errors.toLocaleString()}</span></div>
            </div>
            {/* Afficher le message d erreur SQL si present */}
            {importProgress?.firstError && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: C.redDim, border: `1px solid rgba(248,113,113,0.4)`, borderRadius: 2, fontFamily: fontMono, fontSize: 11, color: C.red }}>
                <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, marginBottom: 6, color: C.red }}>! Erreur SQL detectee</div>
                <div style={{ wordBreak: 'break-all', lineHeight: 1.6 }}>{importProgress.firstError}</div>
                <div style={{ marginTop: 8, color: C.muted, fontSize: 9 }}>
                  → Si &quot;column does not exist&quot;: executer le SQL ALTER TABLE dans Supabase Dashboard
                </div>
              </div>
            )}
          </div>
        )}

        {logLines.length > 0 && (
          <ImportLogPanel
            logLines={logLines}
            containerRef={logContainerRef}
            isImporting={isImporting}
          />
        )}
      </div>
    </div>
  );
}
