'use client';

/**
 * Section « Flux routier (TMJA) » de la catégorie Terrain.
 * JSX repris tel quel du monolithe (2026-09-03).
 */

import React from 'react';
import { FilterSectionHeader } from './FilterSectionHeader';
import { C, fInter, fMono } from './tokens';
import { pill, primaryBtn } from './styles';

/**
 * Paliers de la légende — l'ordre suit celui affiché à l'écran.
 *
 * Exportée pour `components/map/LegendeCarte.tsx` (Tâche 6) : la légende
 * unique du panneau Calques rend ces paliers, cette section ne les affiche
 * plus elle-même.
 */
export const TMJA_LEGEND = [
  { color: '#4292C6', label: '< 5 000 véh/j', isLow: true },
  { color: '#f6d543', label: '5 000 – 15 000 véh/j', isLow: false },
  { color: '#e5a00d', label: '15 000 – 40 000 véh/j', isLow: false },
  { color: '#ef4444', label: '> 40 000 véh/j', isLow: false },
];

export interface TmjaSectionProps {
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;
  tmjaVisible: boolean;
  tmjaHideLowTraffic: boolean;
  /** Absent = le parent ne pilote pas ce filtre : la case est désactivée. */
  onToggleTmjaHideLowTraffic?: (hide: boolean) => void;
  tmjaLoading: boolean;
  setTmjaLoading: React.Dispatch<React.SetStateAction<boolean>>;
  onLoadTMJA?: () => Promise<void> | void;
  onClearTMJA?: () => void;
}

export function TmjaSection({
  filterSearch,
  sectionsOpen,
  toggleSection,
  tmjaVisible,
  tmjaHideLowTraffic,
  onToggleTmjaHideLowTraffic,
  tmjaLoading,
  setTmjaLoading,
  onLoadTMJA,
  onClearTMJA,
}: TmjaSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FilterSectionHeader label="Flux routier (TMJA)" sectionKey="tmja" open={sectionsOpen.tmja !== false} onToggle={() => toggleSection('tmja')} count={tmjaVisible ? 1 : 0} tooltipKey="tmja" searchTerm={filterSearch} />
      {sectionsOpen.tmja !== false && (
      <div style={{ animation: 'fadeIn 200ms var(--ease-out)' }}>

      {/* Légende — rendue par la légende unique de la carte (LegendeCarte,
          Tâche 6), qui lit TMJA_LEGEND exporté ci-dessus. */}

      {/* Toggle : masquer le trafic faible (perf + lisibilité) */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: onToggleTmjaHideLowTraffic ? 'pointer' : 'default',
          padding: '6px 8px',
          background: 'var(--elevated)',
          border: '0.5px solid var(--border-subtle)',
          borderRadius: 4,
        }}
        title="Cache les tronçons à moins de 5 000 véh/j (allège le rendu)"
      >
        <input
          type="checkbox"
          checked={tmjaHideLowTraffic}
          onChange={e => onToggleTmjaHideLowTraffic?.(e.target.checked)}
          disabled={!onToggleTmjaHideLowTraffic}
          style={{ accentColor: 'var(--brand-teal)' }}
        />
        <span style={{ fontFamily: fInter, fontSize: 11, color: C.text }}>
          Masquer le trafic faible (&lt; 5 000 véh/j)
        </span>
      </label>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          style={{ ...primaryBtn('var(--brand-teal)', tmjaLoading || !onLoadTMJA), flex: 1 }}
          disabled={tmjaLoading || !onLoadTMJA}
          onClick={async () => {
            setTmjaLoading(true);
            try { await onLoadTMJA?.(); }
            finally { setTmjaLoading(false); }
          }}
        >
          {tmjaLoading ? 'Chargement...' : tmjaVisible ? 'Actualiser' : 'Afficher TMJA'}
        </button>
        {tmjaVisible && (
          <button
            style={pill(false, C.muted)}
            onClick={onClearTMJA}
            title="Masquer le flux routier"
          >Masquer</button>
        )}
      </div>
      <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, fontStyle: 'italic' }}>
        Source : CEREMA — tronçons pour la zone visible
      </div>
      </div>
      )}{/* fin collapsible TMJA */}
    </div>
  );
}
