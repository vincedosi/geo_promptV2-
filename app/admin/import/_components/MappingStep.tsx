'use client';

/**
 * Étape 03 du wizard d'import — mapping des colonnes du fichier.
 *
 * Champs POI standards d'un côté, mode de géolocalisation de l'autre
 * (GPS direct, géocodage BAN, Lambert 93), chacun avec ses colonnes propres.
 *
 * JSX repris tel quel de page.tsx (2026-09-03) ; `ColSelect`, jusque-là
 * redéfini à chaque rendu de la page, passe en portée module et reçoit les
 * colonnes en prop.
 */

import React from 'react';
import type { GeoMode, ParseResult } from '@/lib/import/types';
import {
  C, fontInter, fontMono,
  GENESIS_FIELDS_POI, GEO_MODES,
  type MappingState,
} from './shared';
import { card, cardBody, cardHeader, cardTitle, stepNum } from './styles';

type Column = ParseResult['columns'][number];

/** Sélecteur d'une colonne du fichier pour un champ cible, avec exemple de valeur. */
function ColSelect({
  columns,
  label,
  value,
  onChange,
  sample,
}: {
  columns: Column[];
  label: string;
  value: string;
  onChange: (v: string) => void;
  sample?: boolean;
}) {
  const selectedCol = columns.find((c) => c.name === value);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <label style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.text, minWidth: 130, margin: 0, flexShrink: 0 }}>{label}</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: 2,
          color: C.text,
          fontFamily: fontMono,
          fontSize: 11,
          padding: '5px 8px',
          outline: 'none',
        }}
      >
        <option value="">— Non mappe —</option>
        {columns.map((col) => (
          <option key={col.name} value={col.name}>{col.name}</option>
        ))}
      </select>
      {sample && selectedCol && selectedCol.sampleValues.length > 0 && (
        <span style={{ fontSize: 11, color: C.textDim, fontFamily: fontMono, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
          ex: {selectedCol.sampleValues[0]}
        </span>
      )}
    </div>
  );
}

export interface MappingStepProps {
  columns: Column[];
  mapping: MappingState;
  setMapping: React.Dispatch<React.SetStateAction<MappingState>>;
  geoMode: GeoMode;
  setGeoMode: (v: GeoMode) => void;
  geoMapping: Record<string, string>;
  setGeoMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function MappingStep({
  columns,
  mapping,
  setMapping,
  geoMode,
  setGeoMode,
  geoMapping,
  setGeoMapping,
}: MappingStepProps) {
  const genesisFields = GENESIS_FIELDS_POI;

  return (
        <div style={card}>
          <div style={cardHeader}>
            <span style={stepNum}>03</span>
            <span style={cardTitle}>Mapping colonnes</span>
            <span style={{ marginLeft: 'auto', fontFamily: fontMono, fontSize: 10, color: C.muted }}>
              {columns.length} colonnes detectees
            </span>
          </div>
          <div style={cardBody}>
            {/* Standard fields */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginBottom: 10 }}>
                {'// champs GENESIS → colonnes fichier'}
              </div>
              {genesisFields.map((field) => (
                <ColSelect
                  key={field.key}
                  columns={columns}
                  label={field.label}
                  value={mapping[field.key] || ''}
                  onChange={(v) => setMapping((prev) => ({ ...prev, [field.key]: v || undefined }))}
                  sample
                />
              ))}
            </div>

            {/* Geolocation section */}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
              <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginBottom: 12 }}>
                {'// geolocalisation'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {GEO_MODES.map((mode) => (
                  <label
                    key={mode.val}
                    onClick={() => setGeoMode(mode.val)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '9px 12px',
                      borderRadius: 2,
                      border: `1px solid ${geoMode === mode.val ? C.borderLight : C.border}`,
                      background: geoMode === mode.val ? C.accentDim : C.bgSurface,
                      cursor: 'pointer',
                    }}
                  >
                    <input type="radio" value={mode.val} checked={geoMode === mode.val} onChange={() => setGeoMode(mode.val)} style={{ marginTop: 2, accentColor: C.accent }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: geoMode === mode.val ? C.accent : C.text, marginBottom: 2 }}>{mode.title}</div>
                      <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim }}>{mode.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Geo mode specific fields */}
              {geoMode === 'gps' && (
                <div>
                  <ColSelect columns={columns} label="Latitude" value={geoMapping.colLat || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colLat: v }))} sample />
                  <ColSelect columns={columns} label="Longitude" value={geoMapping.colLng || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colLng: v }))} sample />
                </div>
              )}
              {geoMode === 'address' && (
                <div>
                  <ColSelect columns={columns} label="Adresse" value={geoMapping.colAdresse || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colAdresse: v }))} sample />
                  <ColSelect columns={columns} label="Code postal" value={geoMapping.colCodePostal || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colCodePostal: v }))} sample />
                  <ColSelect columns={columns} label="Ville" value={geoMapping.colVille || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colVille: v }))} sample />
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginTop: 4 }}>
                    {'// geocodage via api-adresse.data.gouv.fr (BAN) — ~100ms/adresse'}
                  </div>
                </div>
              )}
              {geoMode === 'lambert93' && (
                <div>
                  <ColSelect columns={columns} label="X (Est)" value={geoMapping.colX || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colX: v }))} sample />
                  <ColSelect columns={columns} label="Y (Nord)" value={geoMapping.colY || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colY: v }))} sample />
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginTop: 4 }}>
                    {'// EPSG:2154 → EPSG:4326 via proj4'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
  );
}
