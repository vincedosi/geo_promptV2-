'use client';

/**
 * Étape 01 de l'import shapefile — dépôt du bundle et résultat du parsing.
 *
 * Le .shp et le .dbf sont obligatoires, le .prj et le .shx facultatifs. Le
 * parsing tourne dans le navigateur avec sa propre barre de progression, puis
 * l'étape restitue le CRS détecté, la taille des fichiers et un aperçu des
 * colonnes lues dans le .dbf.
 *
 * JSX repris tel quel de page.tsx (2026-09-07).
 */

import React from 'react';
import type { DbfField, Feature, ShapefileBundle } from '../_lib/shapefile';
import { C, fontInter, fontMono, fmtBytes, fmtNum, type WizardStep } from './shared';

export interface FilesStepProps {
  bundle: ShapefileBundle | null;
  features: Feature[];
  fields: DbfField[];
  crs: string;
  parseError: string;
  isParsing: boolean;
  parseProgress: { label: string; pct: number } | null;

  dropRef: React.RefObject<HTMLDivElement>;
  inputRef: React.RefObject<HTMLInputElement>;
  isDragging: boolean;

  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;

  setStep: (n: WizardStep) => void;
}

export function FilesStep({
  bundle,
  features,
  fields,
  crs,
  parseError,
  isParsing,
  parseProgress,
  dropRef,
  inputRef,
  isDragging,
  onDrop,
  onDragOver,
  onDragLeave,
  onFileInput,
  setStep,
}: FilesStepProps) {
  return (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    {/* Dropzone */}
    <div
      ref={dropRef}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${isDragging ? C.green : C.border}`,
        borderRadius: 2,
        padding: '48px 24px',
        textAlign: 'center',
        cursor: 'pointer',
        background: isDragging ? C.greenDim : C.bgElevated,
        transition: 'all 0.15s',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".shp,.dbf,.prj,.shx"
        onChange={onFileInput}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: 2,
          background: C.bgSurface,
          border: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={isDragging ? C.green : C.muted} strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div>
          <p style={{ fontFamily: fontInter, fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>
            Glissez vos fichiers Shapefile ici
          </p>
          <p style={{ fontFamily: fontMono, fontSize: 11, color: C.textSec, marginTop: 6 }}>
            .shp + .dbf + .prj + .shx — sélection multiple obligatoire
          </p>
        </div>
      </div>
    </div>

    {/* Parse progress */}
    {isParsing && parseProgress && (
      <div style={{
        background: C.bgElevated,
        border: `1px solid ${C.border}`,
        borderRadius: 2,
        padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontFamily: fontMono, fontSize: 12, color: C.warn, display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg
              width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke={C.warn} strokeWidth="2.5"
              className="spin"
              style={{ display: 'inline-block' }}
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            {parseProgress.label}
          </span>
          <span style={{ fontFamily: fontMono, fontSize: 12, color: C.warn, fontWeight: 700 }}>{parseProgress.pct}%</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: C.bgSurface, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            borderRadius: 2,
            background: `linear-gradient(90deg, ${C.warn}, #f97316)`,
            width: `${parseProgress.pct}%`,
            transition: 'width 0.3s',
          }} />
        </div>
      </div>
    )}

    {/* Parse error */}
    {parseError && (
      <div style={{
        background: C.redDim,
        border: `1px solid rgba(248,113,113,0.25)`,
        borderRadius: 2,
        padding: '12px 16px',
      }}>
        <p style={{ fontFamily: fontMono, fontSize: 12, color: C.red, margin: 0 }}>
          ! {parseError}
        </p>
      </div>
    )}

    {/* File summary (when parsed) */}
    {bundle && features.length > 0 && (
      <div style={{
        background: C.bgElevated,
        border: `1px solid rgba(61,255,160,0.25)`,
        borderRadius: 2,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 2,
            background: C.greenDim,
            border: `1px solid rgba(61,255,160,0.2)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p style={{ fontFamily: fontMono, fontWeight: 700, color: C.green, margin: 0, fontSize: 13 }}>{bundle.fileName}</p>
            <p style={{ fontFamily: fontMono, fontSize: 11, color: C.textSec, marginTop: 2 }}>
              {fmtNum(features.length)} features · {fields.length} colonnes · CRS: {crs}
            </p>
          </div>
        </div>

        {/* File sizes */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { ext: '.shp', size: bundle.shp.byteLength },
            { ext: '.dbf', size: bundle.dbf.byteLength },
            ...(bundle.prj ? [{ ext: '.prj', size: bundle.prj.length }] : []),
            ...(bundle.shx ? [{ ext: '.shx', size: bundle.shx.byteLength }] : []),
          ].map(f => (
            <span key={f.ext} style={{
              padding: '3px 10px',
              borderRadius: 2,
              background: C.bgSurface,
              border: `1px solid ${C.border}`,
              fontFamily: fontMono,
              fontSize: 11,
              color: C.textDim,
            }}>
              {f.ext} <span style={{ color: C.textSec }}>{fmtBytes(f.size)}</span>
            </span>
          ))}
        </div>

        {/* Column preview */}
        <div>
          <p style={{
            fontFamily: fontInter,
            fontSize: 12,
            fontWeight: 500,
            color: C.text,
            marginBottom: 8,
          }}>Colonnes détectées</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {fields.map(f => (
              <span key={f.name} style={{
                padding: '2px 8px',
                borderRadius: 2,
                background: C.bgSurface,
                border: `1px solid ${C.border}`,
                fontFamily: fontMono,
                fontSize: 11,
                color: C.text,
              }}>
                {f.name}
                <span style={{ color: C.muted, marginLeft: 4 }}>{f.type === 'N' || f.type === 'F' ? '123' : 'abc'}</span>
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={() => setStep(2)}
          style={{
            width: '100%',
            padding: '12px 0',
            borderRadius: 2,
            background: C.green,
            color: '#000',
            fontFamily: fontInter,
            fontWeight: 500,
            fontSize: 12,
            border: 'none',
            cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          Continuer — Mapping des colonnes
        </button>
      </div>
    )}
  </div>
  );
}
