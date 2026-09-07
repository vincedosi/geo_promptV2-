'use client';

/**
 * Étape 01 du wizard d'import — dépôt du fichier et aperçu du parsing.
 *
 * Zone de drag & drop multi-fichiers (un bundle Shapefile se sélectionne en
 * une fois), puis restitution du résultat de `/api/admin/import-poi/parse` :
 * format, encodage, séparateur, aperçu des 5 premières lignes.
 *
 * JSX repris tel quel de page.tsx (2026-09-03).
 */

import React from 'react';
import type { ParseResult } from '@/lib/import/types';
import { C, fontInter, fontMono, Spinner } from './shared';
import {
  badgeGreen,
  card, cardBody, cardHeader, cardTitle, stepNum,
} from './styles';

export interface UploadStepProps {
  file: File | null;
  parseResult: ParseResult | null;
  isParsing: boolean;
  isDragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;

  handleFileUpload: (files: File | File[]) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: () => void;
}

export function UploadStep({
  file,
  parseResult,
  isParsing,
  isDragging,
  fileInputRef,
  handleFileUpload,
  handleDrop,
  handleDragOver,
  handleDragLeave,
}: UploadStepProps) {
  return (
    <div style={card}>
      <div style={cardHeader}>
        <span style={stepNum}>01</span>
        <span style={cardTitle}>Upload fichier</span>
        {parseResult?.success && (
          <span style={{ ...badgeGreen, marginLeft: 'auto' }}>
            {parseResult.totalRows.toLocaleString()} lignes
          </span>
        )}
      </div>
      <div style={cardBody}>
        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragging ? C.accent : C.border}`,
            borderRadius: 2,
            padding: '28px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            backgroundColor: isDragging ? C.accentDim : 'transparent',
            transition: 'all 0.15s ease',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.xlsx,.geojson,.json,.txt,.tsv,.shp,.dbf,.prj,.shx"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) handleFileUpload(files);
            }}
            style={{ display: 'none' }}
          />
          {isParsing ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.accent, fontFamily: fontMono, fontSize: 12 }}>
              <Spinner size={16} /> Analyse du fichier...
            </div>
          ) : file ? (
            <div>
              <div style={{ fontFamily: fontMono, fontSize: 13, fontWeight: 600, color: C.green, marginBottom: 4 }}>
                {file.name}
              </div>
              <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim }}>
                {parseResult?.format === 'shapefile' ? (
                  <span>Shapefile bundle — {parseResult.totalRows?.toLocaleString()} enregistrements</span>
                ) : (
                  <>{(file.size / 1024 / 1024).toFixed(2)} MB — Cliquez pour changer</>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontFamily: fontInter, fontSize: 13, color: C.text, marginBottom: 6 }}>
                Glissez un ou plusieurs fichiers ici ou cliquez pour selectionner
              </div>
              <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
                {'// formats: .csv .xlsx .geojson | Shapefile (.shp+.dbf+.prj+.shx)'}
              </div>
            </div>
          )}
        </div>

        {/* Parse result info */}
        {parseResult?.success && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontFamily: fontMono, fontSize: 10, color: C.textDim, marginBottom: 10 }}>
              <span>format: <span style={{ color: C.accent }}>{parseResult.format}</span></span>
              <span>encoding: <span style={{ color: C.accent }}>{parseResult.encoding}</span></span>
              {parseResult.format === 'csv' && <span>separator: <span style={{ color: C.accent }}>{parseResult.separator === '\t' ? 'TAB' : `"${parseResult.separator}"`}</span></span>}
              <span>colonnes: <span style={{ color: C.accent }}>{parseResult.columns.length}</span></span>
              <span>lignes: <span style={{ color: C.green }}>{parseResult.totalRows.toLocaleString()}</span></span>
            </div>

            {/* Shapefile info box */}
            {parseResult.format === 'shapefile' && (
              <div style={{ background: C.greenDim, border: `1px solid rgba(61,255,160,0.25)`, borderRadius: 2, padding: '8px 12px', marginBottom: 10, fontFamily: fontMono, fontSize: 11, color: C.green }}>
                [OK] Shapefile detecte et parse avec succes. Les attributs du fichier .dbf sont maintenant disponibles.
              </div>
            )}

            {/* Preview table */}
            {parseResult.preview.length > 0 && (
              <details>
                <summary style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, cursor: 'pointer', marginBottom: 6 }}>
                  Apercu — 5 premieres lignes
                </summary>
                <div style={{ overflow: 'auto', maxHeight: 200, marginTop: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontMono, fontSize: 10 }}>
                    <thead>
                      <tr style={{ background: C.bgSurface }}>
                        {parseResult.columns.slice(0, 8).map((col) => (
                          <th key={col.name} style={{ padding: '5px 8px', borderBottom: `1px solid ${C.border}`, color: C.accent, textAlign: 'left', whiteSpace: 'nowrap', fontFamily: fontInter, fontSize: 11, fontWeight: 500 }}>
                            {col.name}
                          </th>
                        ))}
                        {parseResult.columns.length > 8 && <th style={{ padding: '5px 8px', color: C.muted }}>...</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {parseResult.preview.map((row, idx) => (
                        <tr key={idx} style={{ background: idx % 2 === 0 ? 'transparent' : C.bgSurface }}>
                          {parseResult.columns.slice(0, 8).map((col) => (
                            <td key={col.name} style={{ padding: '4px 8px', borderBottom: `1px solid ${C.border}`, color: C.textDim, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>
                              {row[col.name] ?? <span style={{ color: C.muted }}>null</span>}
                            </td>
                          ))}
                          {parseResult.columns.length > 8 && <td style={{ color: C.muted }}>...</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}

        {/* Shapefile tips */}
        {!file && (
          <div style={{ marginTop: 12, padding: 12, background: C.bgSurface, borderRadius: 2, border: `1px solid ${C.border}`, fontFamily: fontInter, fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>
            <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.text, marginBottom: 8 }}>Formats supportes</div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              <li><strong style={{ color: C.textDim }}>Fichier unique :</strong> CSV, XLSX, TSV, GeoJSON</li>
              <li><strong style={{ color: C.textDim }}>Shapefile :</strong> Selectionnez les fichiers .shp, .dbf, .prj, .shx ensemble (meme nom de base).</li>
              <li><strong style={{ color: C.textDim }}>Carreaux INSEE :</strong> Le systeme detecte automatiquement les colonnes.</li>
            </ul>
          </div>
        )}

        {parseResult && !parseResult.success && (
          <div style={{ marginTop: 12, background: C.redDim, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red }}>
            ! {parseResult.error}
          </div>
        )}
      </div>
    </div>
  );
}
