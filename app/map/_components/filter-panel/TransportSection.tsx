'use client';

/**
 * Section « Arrêts de transport en commun » de la catégorie Terrain.
 * JSX repris tel quel du monolithe (2026-09-03).
 */

import React from 'react';
import { FilterSectionHeader } from './FilterSectionHeader';
import { TRANSPORT_TYPES } from './constants';
import { C, fInter, fMono } from './tokens';
import { labelStyle, pill, primaryBtn } from './styles';

export interface TransportSectionProps {
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;
  selectedTransportTypes: string[];
  setSelectedTransportTypes: React.Dispatch<React.SetStateAction<string[]>>;
  transportLoading: boolean;
  setTransportLoading: React.Dispatch<React.SetStateAction<boolean>>;
  /** Absent = la carte parente ne sait pas charger les arrêts : bouton désactivé. */
  onLoadTransport?: (types: string[]) => Promise<void> | void;
}

export function TransportSection({
  filterSearch,
  sectionsOpen,
  toggleSection,
  selectedTransportTypes,
  setSelectedTransportTypes,
  transportLoading,
  setTransportLoading,
  onLoadTransport,
}: TransportSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FilterSectionHeader label="Arrêts de transport en commun" sectionKey="transport" open={sectionsOpen.transport !== false} onToggle={() => toggleSection('transport')} count={selectedTransportTypes.length} searchTerm={filterSearch} />
      {sectionsOpen.transport !== false && (
      <div style={{ animation: 'fadeIn 200ms var(--ease-out)' }}>

      {/* Sélection du type */}
      <div>
        <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            Type de transport
            {selectedTransportTypes.length > 0 && (
              <span style={{ color: C.textSec }}> — {selectedTransportTypes.join(', ')}</span>
            )}
          </span>
          {selectedTransportTypes.length > 0 && (
            <button
              onClick={() => setSelectedTransportTypes([])}
              style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 10, padding: '0 2px', fontFamily: fMono }}
              title="Tout désélectionner"
            >✕</button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {TRANSPORT_TYPES.map(t => (
            <button
              key={t.id}
              style={pill(selectedTransportTypes.includes(t.id), C.textSec)}
              onClick={() => setSelectedTransportTypes(prev =>
                prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id]
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, marginTop: 5, fontStyle: 'italic' }}>
          {selectedTransportTypes.length === 0 ? 'Tous les types' : ''} · Chargé pour la zone visible
        </div>
      </div>

      <button
        style={primaryBtn('var(--brand-teal)', transportLoading || !onLoadTransport)}
        disabled={transportLoading || !onLoadTransport}
        onClick={async () => {
          setTransportLoading(true);
          try { await onLoadTransport?.(selectedTransportTypes); }
          finally { setTransportLoading(false); }
        }}
      >
        {transportLoading ? 'Chargement...' : 'Afficher arrêts'}
      </button>
      </div>
      )}{/* fin collapsible transport */}
    </div>
  );
}
