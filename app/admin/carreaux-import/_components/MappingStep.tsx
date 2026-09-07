'use client';

/**
 * Étape 02 de l'import shapefile — résolution, millésime, colonne d'identité
 * et mapping des colonnes du .dbf vers les colonnes cibles.
 *
 * Chaque colonne source peut être renommée, ignorée, ou laissée en metadata ;
 * la colonne d'identité sert de clé d'upsert côté base.
 *
 * JSX repris tel quel de page.tsx (2026-09-07).
 */

import React from 'react';
import type { DbfField, Feature } from '../_lib/shapefile';
import {
  C, fontInter, fontMono, fmtNum,
  type ColumnMapping, type WizardStep,
} from './shared';

export interface MappingStepProps {
  features: Feature[];
  fields: DbfField[];

  mappings: ColumnMapping[];
  setMappings: (m: ColumnMapping[]) => void;

  resolution: string;
  setResolution: (v: string) => void;
  millesime: string;
  setMillesime: (v: string) => void;
  idColumn: string;
  setIdColumn: (v: string) => void;

  setStep: (n: WizardStep) => void;
}

export function MappingStep({
  features,
  fields,
  mappings,
  setMappings,
  resolution,
  setResolution,
  millesime,
  setMillesime,
  idColumn,
  setIdColumn,
  setStep,
}: MappingStepProps) {
  return (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

    {/* Config cards */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
      {/* Resolution */}
      <div style={{
        background: C.bgElevated,
        border: `1px solid ${C.border}`,
        borderRadius: 2,
        padding: 16,
      }}>
        <label style={{
          display: 'block',
          fontFamily: fontInter,
          fontSize: 12,
          fontWeight: 500,
          color: C.text,
          marginBottom: 8,
        }}>Résolution</label>
        <select
          value={resolution}
          onChange={e => setResolution(e.target.value)}
          style={{
            width: '100%',
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 2,
            padding: '8px 10px',
            fontFamily: fontMono,
            fontSize: 12,
            color: C.text,
            outline: 'none',
          }}
        >
          <option value="200m">200m × 200m</option>
          <option value="1km">1km × 1km</option>
        </select>
      </div>

      {/* Millesime */}
      <div style={{
        background: C.bgElevated,
        border: `1px solid ${C.border}`,
        borderRadius: 2,
        padding: 16,
      }}>
        <label style={{
          display: 'block',
          fontFamily: fontInter,
          fontSize: 12,
          fontWeight: 500,
          color: C.text,
          marginBottom: 8,
        }}>Millésime</label>
        <input
          value={millesime}
          onChange={e => setMillesime(e.target.value)}
          style={{
            width: '100%',
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 2,
            padding: '8px 10px',
            fontFamily: fontMono,
            fontSize: 12,
            color: C.text,
            outline: 'none',
            boxSizing: 'border-box',
          }}
          placeholder="2021"
        />
      </div>

      {/* ID column */}
      <div style={{
        background: C.bgElevated,
        border: `1px solid ${C.border}`,
        borderRadius: 2,
        padding: 16,
      }}>
        <label style={{
          display: 'block',
          fontFamily: fontInter,
          fontSize: 12,
          fontWeight: 500,
          color: C.text,
          marginBottom: 8,
        }}>Colonne ID (idcar)</label>
        <select
          value={idColumn}
          onChange={e => setIdColumn(e.target.value)}
          style={{
            width: '100%',
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 2,
            padding: '8px 10px',
            fontFamily: fontMono,
            fontSize: 12,
            color: C.text,
            outline: 'none',
          }}
        >
          <option value="">— Auto-index —</option>
          {fields.map(f => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
        </select>
      </div>
    </div>

    {/* Column mapping table */}
    <div style={{
      background: C.bgElevated,
      border: `1px solid ${C.border}`,
      borderRadius: 2,
      overflow: 'hidden',
    }}>
      {/* Table header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <p style={{
            fontFamily: fontInter,
            fontSize: 12,
            fontWeight: 500,
            color: C.text,
            margin: 0,
          }}>Mapping des colonnes</p>
          <p style={{ fontFamily: fontMono, fontSize: 11, color: C.textSec, marginTop: 4 }}>
            Sélectionnez les colonnes à inclure dans les metadata JSONB. Décochez celles à ignorer.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setMappings(mappings.map(m => ({ ...m, target: '' })))}
            style={{
              padding: '5px 12px',
              borderRadius: 2,
              background: C.bgSurface,
              border: `1px solid ${C.border}`,
              fontFamily: fontInter,
              fontSize: 12,
              fontWeight: 500,
              color: C.textDim,
              cursor: 'pointer',
            }}
          >
            Tout inclure
          </button>
          <button
            onClick={() => setMappings(mappings.map(m => ({ ...m, target: '__skip__' })))}
            style={{
              padding: '5px 12px',
              borderRadius: 2,
              background: C.bgSurface,
              border: `1px solid ${C.border}`,
              fontFamily: fontInter,
              fontSize: 12,
              fontWeight: 500,
              color: C.textDim,
              cursor: 'pointer',
            }}
          >
            Tout exclure
          </button>
        </div>
      </div>

      {/* Table rows */}
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '36px 1fr 160px 148px',
          gap: 0,
          padding: '6px 20px',
          borderBottom: `1px solid ${C.border}`,
          background: C.bgSurface,
        }}>
          {['', 'Colonne source', 'Valeur exemple', 'Nom cible'].map((h, i) => (
            <span key={i} style={{
              fontFamily: fontInter,
              fontSize: 11,
              color: C.textSec,
            }}>{h}</span>
          ))}
        </div>

        {mappings.map((m, idx) => {
          const field = fields[idx];
          const sample = features.length > 0 ? features[0].properties[m.source] : null;
          const isIncluded = m.target !== '__skip__';

          return (
            <div
              key={m.source}
              style={{
                display: 'grid',
                gridTemplateColumns: '36px 1fr 160px 148px',
                gap: 0,
                padding: '8px 20px',
                borderBottom: `1px solid ${C.border}`,
                alignItems: 'center',
                opacity: isIncluded ? 1 : 0.4,
                background: isIncluded ? 'transparent' : C.bgSurface,
                transition: 'opacity 0.15s',
              }}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={isIncluded}
                onChange={e => {
                  const next = [...mappings];
                  next[idx] = { ...m, target: e.target.checked ? '' : '__skip__' };
                  setMappings(next);
                }}
                style={{
                  width: 14,
                  height: 14,
                  accentColor: C.accent,
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
              />

              {/* Source column name */}
              <div>
                <span style={{ fontFamily: fontMono, fontSize: 12, color: C.text, fontWeight: 500 }}>{m.source}</span>
                <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginLeft: 8 }}>
                  {field?.type === 'N' || field?.type === 'F' ? 'numérique' : 'texte'}
                </span>
              </div>

              {/* Sample value */}
              <div style={{ overflow: 'hidden' }}>
                <span style={{
                  fontFamily: fontMono,
                  fontSize: 11,
                  color: C.textSec,
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {sample != null ? String(sample) : '—'}
                </span>
              </div>

              {/* Target name input */}
              <input
                value={m.target === '__skip__' ? '' : m.target}
                onChange={e => {
                  const next = [...mappings];
                  next[idx] = { ...m, target: e.target.value };
                  setMappings(next);
                }}
                disabled={!isIncluded}
                placeholder="(nom original)"
                style={{
                  width: 140,
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 2,
                  padding: '4px 8px',
                  fontFamily: fontMono,
                  fontSize: 11,
                  color: C.textDim,
                  opacity: isIncluded ? 1 : 0.3,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>

    {/* Summary + next */}
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontFamily: fontMono, fontSize: 12, color: C.textDim }}>
        {mappings.filter(m => m.target !== '__skip__').length} / {mappings.length} colonnes sélectionnées
        &nbsp;·&nbsp; {fmtNum(features.length)} features à insérer
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => setStep(1)}
          style={{
            padding: '10px 20px',
            borderRadius: 2,
            background: C.bgElevated,
            border: `1px solid ${C.border}`,
            color: C.textDim,
            fontFamily: fontInter,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Retour
        </button>
        <button
          onClick={() => setStep(3)}
          style={{
            padding: '10px 24px',
            borderRadius: 2,
            background: C.green,
            border: 'none',
            color: '#000',
            fontFamily: fontInter,
            fontWeight: 500,
            fontSize: 12,
            cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          Lancer l&apos;import
        </button>
      </div>
    </div>
  </div>
  );
}
