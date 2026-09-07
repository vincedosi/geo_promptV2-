'use client';

/**
 * Étape 03c du wizard d'import — géocodage des adresses via l'API BAN
 * (api-adresse.data.gouv.fr, endpoint batch CSV).
 *
 * L'opérateur relit les résultats triés par qualité (échecs d'abord), corrige
 * ligne à ligne (nouvelle adresse ou coordonnées manuelles), puis valide. La
 * validation est obligatoire pour passer aux étapes suivantes.
 *
 * JSX repris tel quel de page.tsx (2026-09-03).
 */

import React from 'react';
import type { GeocodeDetailedResult, ParseResult } from '@/lib/import/types';
import { C, fontInter, fontMono, Spinner } from './shared';
import {
  badgeGreen, badgeRed, badgeWarn,
  btnGhost, btnSuccess,
  card, cardBody, cardHeader, cardTitle,
  inputStyle, statusColor, statusLabel, stepNum,
} from './styles';

/** Au-delà, le tableau devient trop lourd à rendre : on tronque l'affichage. */
const MAX_ROWS_AFFICHEES = 200;

/** Ordre de relecture : les échecs en premier, ce sont eux qui demandent une action. */
const ORDRE_STATUT = { red: 0, orange: 1, green: 2 } as const;

export type GeocodeFilter = 'all' | 'green' | 'orange' | 'red';

export interface GeocodeStepProps {
  parseResult: ParseResult;

  geocodeId: string | null;
  setGeocodeId: (v: string | null) => void;
  isGeocoding: boolean;
  handleGeocodeBatch: () => void;

  geocodeResults: GeocodeDetailedResult[];
  setGeocodeResults: (v: GeocodeDetailedResult[]) => void;
  geocodeStats: { green: number; orange: number; red: number } | null;
  setGeocodeStats: (v: { green: number; orange: number; red: number } | null) => void;
  geocodeError: string | null;
  setGeocodeError: (v: string | null) => void;

  geocodeFilter: GeocodeFilter;
  setGeocodeFilter: (v: GeocodeFilter) => void;

  editingRow: number | null;
  setEditingRow: (v: number | null) => void;
  editAddress: string;
  setEditAddress: (v: string) => void;
  editLat: string;
  setEditLat: (v: string) => void;
  editLng: string;
  setEditLng: (v: string) => void;
  isUpdatingRow: boolean;
  handleGeocodeUpdateRow: (
    rowIndex: number,
    action:
      | { type: 'manual'; lat: number; lng: number }
      | { type: 'reGeocode'; address: string }
      | { type: 'ignore' },
  ) => void;

  geocodeValidated: boolean;
  setGeocodeValidated: (v: boolean) => void;
}

export function GeocodeStep({
  parseResult,
  geocodeId,
  setGeocodeId,
  isGeocoding,
  handleGeocodeBatch,
  geocodeResults,
  setGeocodeResults,
  geocodeStats,
  setGeocodeStats,
  geocodeError,
  setGeocodeError,
  geocodeFilter,
  setGeocodeFilter,
  editingRow,
  setEditingRow,
  editAddress,
  setEditAddress,
  editLat,
  setEditLat,
  editLng,
  setEditLng,
  isUpdatingRow,
  handleGeocodeUpdateRow,
  geocodeValidated,
  setGeocodeValidated,
}: GeocodeStepProps) {
  const filteredResults = geocodeFilter === 'all'
    ? geocodeResults
    : geocodeResults.filter((r) => r.status === geocodeFilter);

  const sortedResults = [...filteredResults].sort(
    (a, b) => ORDRE_STATUT[a.status] - ORDRE_STATUT[b.status],
  );

  return (
    <div style={card}>
      <div style={cardHeader}>
        <span style={stepNum}>03c</span>
        <span style={cardTitle}>Geocodage adresses</span>
        {geocodeStats && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <span style={badgeGreen}>{geocodeStats.green} OK</span>
            {geocodeStats.orange > 0 && (
              <span style={badgeWarn}>{geocodeStats.orange} approx.</span>
            )}
            {geocodeStats.red > 0 && (
              <span style={badgeRed}>{geocodeStats.red} echecs</span>
            )}
          </div>
        )}
      </div>
      <div style={cardBody}>
        <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginBottom: 12 }}>
          {'// geocodage via api-adresse.data.gouv.fr (BAN) — endpoint batch CSV'}
        </div>

        {/* Launch button */}
        {!geocodeId && (
          <button
            onClick={handleGeocodeBatch}
            disabled={isGeocoding}
            style={{ ...btnSuccess, minWidth: 250, opacity: isGeocoding ? 0.6 : 1 }}
          >
            {isGeocoding ? <><Spinner /> Geocodage en cours...</> : `Lancer le geocodage (${parseResult.totalRows} adresses)`}
          </button>
        )}

        {geocodeError && (
          <div style={{ marginTop: 12, background: C.redDim, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red }}>
            ! {geocodeError}
          </div>
        )}

        {/* Results review */}
        {geocodeResults.length > 0 && geocodeStats && (
          <div style={{ marginTop: 16 }}>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                { key: 'green', label: 'Geocodes OK', val: geocodeStats.green, note: 'score >= 0.6', color: C.green },
                { key: 'orange', label: 'Approximatifs', val: geocodeStats.orange, note: 'score 0.3–0.6', color: C.warn },
                { key: 'red', label: 'Non trouves', val: geocodeStats.red, note: 'score < 0.3', color: C.red },
              ].map(({ key, label, val, note, color }) => (
                <div
                  key={key}
                  onClick={() => setGeocodeFilter(key as 'green' | 'orange' | 'red')}
                  style={{
                    background: C.bgSurface,
                    border: `1px solid ${geocodeFilter === key ? color : C.border}`,
                    borderRadius: 2,
                    padding: '12px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontFamily: fontInter, fontSize: 8, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>{label}</div>
                  <div style={{ fontFamily: fontInter, fontSize: 22, color, fontWeight: 700 }}>{val}</div>
                  <div style={{ fontFamily: fontMono, fontSize: 9, color: C.muted, marginTop: 4 }}>{note}</div>
                </div>
              ))}
            </div>

            {/* Filter bar */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
              {(['all', 'red', 'orange', 'green'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setGeocodeFilter(f)}
                  style={{
                    fontFamily: fontInter,
                    fontSize: 12,
                    fontWeight: 500,
                    padding: '4px 10px',
                    borderRadius: 2,
                    cursor: 'pointer',
                    background: geocodeFilter === f
                      ? (f === 'all' ? C.accentDim : `${statusColor(f)}22`)
                      : 'transparent',
                    color: geocodeFilter === f
                      ? (f === 'all' ? C.accent : statusColor(f))
                      : C.muted,
                    border: `1px solid ${geocodeFilter === f
                      ? (f === 'all' ? C.accent : statusColor(f))
                      : C.border}`,
                  }}
                >
                  {f === 'all' ? `Tous (${geocodeResults.length})` : `${statusLabel(f)} (${geocodeResults.filter(r => r.status === f).length})`}
                </button>
              ))}
              <span style={{ marginLeft: 'auto', fontFamily: fontMono, fontSize: 9, color: C.muted }}>
                {filteredResults.length} resultats affiches
              </span>
            </div>

            {/* Results table */}
            <div style={{ maxHeight: 500, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 2 }}>
              {/* Table header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '50px 1fr 1fr 60px 70px 120px',
                gap: 4, padding: '6px 8px',
                fontFamily: fontInter, fontSize: 11, fontWeight: 500,
                color: C.muted, borderBottom: `1px solid ${C.border}`,
                position: 'sticky', top: 0, background: C.bgElevated, zIndex: 1,
              }}>
                <span>#</span>
                <span>Adresse saisie</span>
                <span>Resultat BAN</span>
                <span>Score</span>
                <span>Statut</span>
                <span>Actions</span>
              </div>

              {/* Table rows (show max 200 for performance) */}
              {sortedResults.slice(0, MAX_ROWS_AFFICHEES).map((result) => (
                <div key={result.rowIndex}>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '50px 1fr 1fr 60px 70px 120px',
                    gap: 4, padding: '5px 8px',
                    borderBottom: `1px solid ${C.border}`,
                    alignItems: 'center',
                    background: result.status === 'red'
                      ? 'rgba(248,113,113,0.04)'
                      : result.status === 'orange'
                        ? 'rgba(251,191,36,0.03)'
                        : 'transparent',
                  }}>
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>{result.rowIndex + 1}</span>
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={result.inputAddress}>
                      {result.inputAddress || <i style={{ color: C.muted }}>vide</i>}
                    </span>
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: result.status === 'green' ? C.text : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={result.resultLabel}>
                      {result.resultLabel || '—'}
                      {result.manualOverride && <span style={{ fontFamily: fontMono, fontSize: 9, color: C.accent, marginLeft: 4 }}>[edit]</span>}
                    </span>
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: statusColor(result.status), fontWeight: 600 }}>
                      {result.score.toFixed(2)}
                    </span>
                    <span style={{ fontFamily: fontInter, fontSize: 11, fontWeight: 600, color: statusColor(result.status) }}>
                      {statusLabel(result.status)}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {result.status !== 'green' && (
                        <>
                          <button
                            style={{ ...btnGhost, fontSize: 8, padding: '2px 6px' }}
                            onClick={() => {
                              setEditingRow(editingRow === result.rowIndex ? null : result.rowIndex);
                              setEditAddress(result.inputAddress);
                              setEditLat(result.lat?.toString() || '');
                              setEditLng(result.lng?.toString() || '');
                            }}
                          >
                            {editingRow === result.rowIndex ? 'Fermer' : 'Corriger'}
                          </button>
                          <button
                            style={{ ...btnGhost, fontSize: 8, padding: '2px 6px', opacity: isUpdatingRow ? 0.5 : 1 }}
                            onClick={() => handleGeocodeUpdateRow(result.rowIndex, { type: 'ignore' })}
                            disabled={isUpdatingRow}
                          >
                            Ignorer
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Inline edit form */}
                  {editingRow === result.rowIndex && (
                    <div style={{
                      padding: '10px 8px 10px 58px',
                      background: C.accentDim,
                      borderBottom: `1px solid ${C.border}`,
                      display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                      {/* Re-geocode with corrected address */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <label style={{ fontFamily: fontInter, fontSize: 11, fontWeight: 500, color: C.muted, minWidth: 80 }}>Adresse :</label>
                        <input
                          type="text"
                          value={editAddress}
                          onChange={(e) => setEditAddress(e.target.value)}
                          style={{ ...inputStyle, flex: 1, fontSize: 10, padding: '4px 8px' }}
                          placeholder="Corrigez l'adresse et re-geocodez"
                        />
                        <button
                          style={{ ...btnSuccess, fontSize: 9, padding: '4px 10px', opacity: (!editAddress.trim() || isUpdatingRow) ? 0.5 : 1 }}
                          disabled={!editAddress.trim() || isUpdatingRow}
                          onClick={() => handleGeocodeUpdateRow(result.rowIndex, { type: 'reGeocode', address: editAddress.trim() })}
                        >
                          {isUpdatingRow ? <Spinner size={10} /> : 'Re-geocoder'}
                        </button>
                      </div>
                      {/* Manual lat/lng */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <label style={{ fontFamily: fontInter, fontSize: 11, fontWeight: 500, color: C.muted, minWidth: 80 }}>Manuel :</label>
                        <input
                          type="text"
                          value={editLat}
                          onChange={(e) => setEditLat(e.target.value)}
                          style={{ ...inputStyle, width: 100, fontSize: 10, padding: '4px 8px' }}
                          placeholder="Latitude"
                        />
                        <input
                          type="text"
                          value={editLng}
                          onChange={(e) => setEditLng(e.target.value)}
                          style={{ ...inputStyle, width: 100, fontSize: 10, padding: '4px 8px' }}
                          placeholder="Longitude"
                        />
                        <button
                          style={{ ...btnSuccess, fontSize: 9, padding: '4px 10px', opacity: (!editLat || !editLng || isNaN(Number(editLat)) || isNaN(Number(editLng)) || isUpdatingRow) ? 0.5 : 1 }}
                          disabled={!editLat || !editLng || isNaN(Number(editLat)) || isNaN(Number(editLng)) || isUpdatingRow}
                          onClick={() => handleGeocodeUpdateRow(result.rowIndex, { type: 'manual', lat: Number(editLat), lng: Number(editLng) })}
                        >
                          Valider coords
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {sortedResults.length > MAX_ROWS_AFFICHEES && (
                <div style={{ padding: 12, textAlign: 'center', fontFamily: fontMono, fontSize: 10, color: C.muted }}>
                  ... et {sortedResults.length - MAX_ROWS_AFFICHEES} autres resultats (utilisez les filtres pour affiner)
                </div>
              )}
            </div>

            {/* Validate button */}
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                style={{ ...btnSuccess, minWidth: 200, opacity: geocodeStats.green === 0 ? 0.4 : 1 }}
                onClick={() => setGeocodeValidated(true)}
                disabled={geocodeStats.green === 0}
              >
                Valider le geocodage ({geocodeStats.green + geocodeStats.orange} lignes avec coordonnees)
              </button>
              {geocodeStats.red > 0 && (
                <span style={{ fontFamily: fontMono, fontSize: 10, color: C.warn }}>
                  ! {geocodeStats.red} ligne{geocodeStats.red > 1 ? 's' : ''} sans coordonnees (seront exclues)
                </span>
              )}
              {geocodeValidated && (
                <span style={{ ...badgeGreen, marginLeft: 'auto' }}>VALIDE</span>
              )}
            </div>

            {/* Re-geocode button */}
            <div style={{ marginTop: 8 }}>
              <button
                style={btnGhost}
                onClick={() => {
                  setGeocodeId(null);
                  setGeocodeResults([]);
                  setGeocodeStats(null);
                  setGeocodeValidated(false);
                  setGeocodeError(null);
                }}
              >
                Relancer tout le geocodage
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
