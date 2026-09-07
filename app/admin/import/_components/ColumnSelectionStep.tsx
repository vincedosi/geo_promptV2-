'use client';

/**
 * Étape 03b du wizard d'import — colonnes libres à embarquer et filtres.
 *
 * Les colonnes déjà consommées par le mapping standard ou la géolocalisation
 * sont marquées comme telles ; les autres peuvent être importées en metadata,
 * et chacune peut en plus devenir un filtre de la carte.
 *
 * Corps de l'IIFE de page.tsx repris tel quel (2026-09-03) : le calcul des
 * colonnes libres devient le corps du composant, le JSX son rendu.
 */

import React from 'react';
import type { ParseResult } from '@/lib/import/types';
import { C, fontInter, fontMono, type MappingState } from './shared';
import {
  badgeAccent, badgeGreen, btnGhost,
  card, cardBody, cardHeader, cardTitle, stepNum,
} from './styles';

export interface ColumnSelectionStepProps {
  columns: ParseResult['columns'];
  mapping: MappingState;
  geoMapping: Record<string, string>;
  importedColumns: string[];
  setImportedColumns: React.Dispatch<React.SetStateAction<string[]>>;
  filterFields: string[];
  setFilterFields: React.Dispatch<React.SetStateAction<string[]>>;
}

export function ColumnSelectionStep({
  columns,
  mapping,
  geoMapping,
  importedColumns,
  setImportedColumns,
  filterFields,
  setFilterFields,
}: ColumnSelectionStepProps) {
  // Compute which columns are already handled by the schema/geo mapping
  const mappedSourceCols = new Set<string>([
    ...Object.values(mapping).filter(Boolean) as string[],
    geoMapping.colLat, geoMapping.colLng,
    geoMapping.colX, geoMapping.colY,
    geoMapping.colAdresse, geoMapping.colCodePostal, geoMapping.colVille,
  ].filter(Boolean));

  // Build reverse map: source column → genesis field label
  const colToSchema: Record<string, string> = {};
  const fieldLabels: Record<string, string> = {
    nom: 'nom', adresse: 'adresse', ville: 'ville', code_postal: 'code_postal',
    departement: 'departement', region: 'region',
    reference_panneau: 'reference', type_panneau: 'type_panneau',
  };
  Object.entries(mapping).forEach(([f, src]) => { if (src) colToSchema[src] = fieldLabels[f] || f; });
  if (geoMapping.colLat) colToSchema[geoMapping.colLat] = 'latitude';
  if (geoMapping.colLng) colToSchema[geoMapping.colLng] = 'longitude';
  if (geoMapping.colX) colToSchema[geoMapping.colX] = 'X Lambert';
  if (geoMapping.colY) colToSchema[geoMapping.colY] = 'Y Lambert';
  if (geoMapping.colAdresse) colToSchema[geoMapping.colAdresse] = 'adresse (geoloc)';
  if (geoMapping.colCodePostal) colToSchema[geoMapping.colCodePostal] = 'CP (geoloc)';
  if (geoMapping.colVille) colToSchema[geoMapping.colVille] = 'ville (geoloc)';

  const unmappedCols = columns.filter(c => !mappedSourceCols.has(c.name));
  const importedCount = unmappedCols.filter(c => importedColumns.includes(c.name)).length;

  const toggleImport = (colName: string) => {
    setImportedColumns(prev => {
      const next = prev.includes(colName) ? prev.filter(c => c !== colName) : [...prev, colName];
      if (!next.includes(colName)) setFilterFields(pf => pf.filter(f => f !== colName));
      return next;
    });
  };
  const toggleFilter = (colName: string) => {
    setFilterFields(prev => prev.includes(colName) ? prev.filter(f => f !== colName) : [...prev, colName]);
  };

  return (
    <div style={card}>
      <div style={cardHeader}>
        <span style={stepNum}>03b</span>
        <span style={cardTitle}>Colonnes a importer</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <span style={badgeGreen}>{importedCount + mappedSourceCols.size} importees</span>
          {filterFields.length > 0 && (
            <span style={badgeAccent}>
              {filterFields.length} filtre{filterFields.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
      <div style={cardBody}>
        <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginBottom: 10 }}>
          {'// schema = toujours importe via champs GENESIS · cochez Importer pour metadata · Filtre = filtre carte'}
        </div>

        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 180px 80px 70px',
          gap: 4, padding: '5px 8px',
          fontFamily: fontInter, fontSize: 11, fontWeight: 500,
          color: C.muted, borderBottom: `1px solid ${C.border}`,
          marginBottom: 4,
        }}>
          <span>Colonne / exemples</span>
          <span>Statut</span>
          <span style={{ textAlign: 'center' }}>Importer</span>
          <span style={{ textAlign: 'center' }}>Filtre</span>
        </div>

        {/* Rows */}
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          {columns.map(col => {
            const isMapped = mappedSourceCols.has(col.name);
            const schemaField = colToSchema[col.name];
            const isImported = importedColumns.includes(col.name);
            const isFilter = filterFields.includes(col.name);

            return (
              <div key={col.name} style={{
                display: 'grid', gridTemplateColumns: '1fr 180px 80px 70px',
                gap: 4, padding: '5px 8px', borderRadius: 2,
                background: isMapped ? 'rgba(78,205,196,0.04)' : isImported ? 'transparent' : 'rgba(0,0,0,0.2)',
                opacity: isMapped ? 0.75 : 1,
                borderBottom: `1px solid ${C.border}`,
                alignItems: 'center',
              }}>
                {/* Nom + exemples */}
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: fontMono,
                    fontSize: 11,
                    fontWeight: 600,
                    color: isMapped ? C.accent : isImported ? C.text : C.muted,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {col.name}
                  </div>
                  {col.sampleValues.length > 0 && (
                    <div style={{ fontFamily: fontMono, fontSize: 9, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {col.sampleValues.slice(0, 2).join(' · ')}
                    </div>
                  )}
                </div>

                {/* Statut */}
                {isMapped ? (
                  <span style={{ fontFamily: fontMono, fontSize: 9, color: C.accent }}>
                    → schema:{schemaField}
                  </span>
                ) : (
                  <span style={{ fontFamily: fontMono, fontSize: 9, color: C.muted }}>
                    {isImported ? (isFilter ? 'metadata + filtre' : 'metadata') : 'exclu'}
                  </span>
                )}

                {/* Importer checkbox */}
                <div style={{ textAlign: 'center' }}>
                  {isMapped ? (
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>—</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={isImported}
                      onChange={() => toggleImport(col.name)}
                      style={{ accentColor: C.accent, cursor: 'pointer', width: 13, height: 13 }}
                    />
                  )}
                </div>

                {/* Filtre checkbox */}
                <div style={{ textAlign: 'center' }}>
                  {isMapped ? (
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>—</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={isFilter}
                      disabled={!isImported}
                      onChange={() => isImported && toggleFilter(col.name)}
                      style={{ accentColor: C.green, cursor: isImported ? 'pointer' : 'not-allowed', width: 13, height: 13, opacity: isImported ? 1 : 0.3 }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer actions */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          <button style={btnGhost} onClick={() => setImportedColumns(unmappedCols.map(c => c.name))}>
            Tout importer
          </button>
          <button style={btnGhost} onClick={() => { setImportedColumns([]); setFilterFields([]); }}>
            Tout exclure
          </button>
          <button style={btnGhost} onClick={() => setFilterFields([])}>
            Effacer filtres
          </button>
          <span style={{ fontFamily: fontMono, fontSize: 9, color: C.muted, marginLeft: 'auto' }}>
            {importedCount}/{unmappedCols.length} colonnes libres · {filterFields.length} filtres
          </span>
        </div>
      </div>
    </div>
  );
}
