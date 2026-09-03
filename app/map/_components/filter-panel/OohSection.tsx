'use client';

/**
 * Section « Panneaux OOH et DOOH » de la catégorie Terrain.
 * JSX repris tel quel du monolithe (2026-09-03).
 */

import React from 'react';
import { FilterSectionHeader } from './FilterSectionHeader';
import { MultiDropdown } from './MultiDropdown';
import { OOH_REGIES } from './constants';
import { C, fInter } from './tokens';
import { primaryBtn } from './styles';

export interface OohSectionProps {
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;
  selectedOOH: string[];
  setSelectedOOH: React.Dispatch<React.SetStateAction<string[]>>;
  /** Charge les panneaux sur la carte ; sans argument = toutes les régies. */
  onDirectOOH: (regies?: string[]) => void;
}

export function OohSection({
  filterSearch,
  sectionsOpen,
  toggleSection,
  selectedOOH,
  setSelectedOOH,
  onDirectOOH,
}: OohSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FilterSectionHeader label="Panneaux OOH et DOOH" sectionKey="ooh" open={sectionsOpen.ooh !== false} onToggle={() => toggleSection('ooh')} count={selectedOOH.length} searchTerm={filterSearch} />
      {sectionsOpen.ooh !== false && (
      <div style={{ animation: 'fadeIn 200ms var(--ease-out)' }}>

      {/* Info stock */}
      <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
        <span style={{ color: C.textSec }}>1 434</span> panneaux · Brest Métropole
        <span style={{ color: C.textDim }}> · DECAUX, Clear Channel…</span>
      </div>

      {/* Filtre par régie (optionnel) */}
      <div>
        <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            Filtrer par régie (optionnel)
            {selectedOOH.length > 0 && <span style={{ color: C.textSec }}> — {selectedOOH.length} sélectionnée{selectedOOH.length > 1 ? 's' : ''}</span>}
          </span>
          <span style={{ display: 'flex', gap: 4 }}>
            <button
              title="Tout sélectionner"
              onClick={() => setSelectedOOH(OOH_REGIES.map(r => r.id))}
              style={{ background: 'none', border: `0.5px solid ${C.border}`, color: C.textDim, cursor: 'pointer', fontSize: 11, padding: '1px 6px', fontFamily: fInter }}
            >Tout</button>
            <button
              title="Tout désélectionner"
              onClick={() => setSelectedOOH([])}
              style={{ background: 'none', border: `0.5px solid ${C.border}`, color: C.textDim, cursor: 'pointer', fontSize: 10, padding: '1px 5px', lineHeight: 1 }}
            >✕</button>
          </span>
        </div>
        <MultiDropdown
          label="Toutes les régies"
          items={OOH_REGIES}
          selected={selectedOOH}
          onChange={setSelectedOOH}
        />
      </div>

      {/* Bouton toujours visible */}
      <button
        style={{ ...primaryBtn('var(--brand-teal)', false) }}
        onClick={() => onDirectOOH(selectedOOH.length > 0 ? selectedOOH : undefined)}
      >
        {selectedOOH.length > 0
          ? `Afficher — ${selectedOOH.length} régie${selectedOOH.length > 1 ? 's' : ''}`
          : 'Afficher tous les panneaux'}
      </button>
      </div>
      )}{/* fin collapsible OOH */}
    </div>
  );
}
