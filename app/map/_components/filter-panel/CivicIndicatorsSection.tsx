'use client';

/**
 * Section « Indicateurs civiques » de la catégorie Audience : choroplèthe par
 * code postal d'une variable civique (abstention présidentielle 2022).
 *
 * JSX repris tel quel du monolithe (2026-09-03).
 */

import React from 'react';
import { FilterSectionHeader } from './FilterSectionHeader';
import { C, fInter, fMono } from './tokens';
import { labelStyle } from './styles';

/**
 * Paliers du gradient de la légende : [couleur, poids relatif].
 *
 * Exportée pour `components/map/LegendeCarte.tsx` (Tâche 6) : la légende
 * unique du panneau Calques rend ce gradient, cette section ne l'affiche
 * plus elle-même.
 */
export const ABSTENTION_LEGEND: [string, number][] = [
  ['#16a34a', 0.5],
  ['#84cc16', 1],
  ['#eab308', 1],
  ['#f97316', 1],
  ['#dc2626', 1.2],
  ['#7f1d1d', 0.8],
];

/** Libellés des trois repères affichés sous le gradient, dans l'ordre. */
export const ABSTENTION_LEGEND_REPERES: readonly [string, string, string] = [
  '10% (forte particip.)', '30%', '60% (forte abst.)',
];

export interface CivicIndicatorsSectionProps {
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;
  civicVariableCode?: 'abstention_pres_2022' | null;
  onCivicVariableChange?: (code: 'abstention_pres_2022' | null) => void;
}

export function CivicIndicatorsSection({
  filterSearch,
  sectionsOpen,
  toggleSection,
  civicVariableCode,
  onCivicVariableChange,
}: CivicIndicatorsSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FilterSectionHeader
        label="Indicateurs civiques"
        sectionKey="civic"
        open={sectionsOpen.civic !== false}
        onToggle={() => toggleSection('civic')}
        count={civicVariableCode ? 1 : 0}
        searchTerm={filterSearch}
      />
      {sectionsOpen.civic !== false && (
      <div style={{ animation: 'fadeIn 200ms var(--ease-out)' }}>
        <div style={{ ...labelStyle, marginBottom: 4 }}>Variable à afficher</div>
        <div style={{ position: 'relative' }}>
          <select
            value={civicVariableCode ?? ''}
            onChange={(e) => onCivicVariableChange?.((e.target.value || null) as 'abstention_pres_2022' | null)}
            style={{
              width: '100%', padding: '8px 28px 8px 11px',
              background: C.bgInput,
              border: `0.5px solid ${civicVariableCode ? 'var(--brand-teal)' : C.border}`,
              borderRadius: 4,
              fontFamily: fInter, fontSize: 13,
              color: civicVariableCode ? 'var(--brand-teal)' : C.text,
              appearance: 'none', cursor: 'pointer', outline: 'none',
              transition: 'border-color 200ms var(--ease-out), color 200ms var(--ease-out)',
            }}
          >
            <option value="">— Aucune (layer désactivé) —</option>
            <option value="abstention_pres_2022">🗳️ Taux d&apos;abstention (Présidentielle 2022)</option>
          </select>
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: C.textDim, fontSize: 10 }}>▾</span>
        </div>

        {civicVariableCode === 'abstention_pres_2022' && (
          <>
            {/* Légende — rendue par la légende unique de la carte (LegendeCarte,
                Tâche 6), qui lit ABSTENTION_LEGEND exporté ci-dessus. */}

            {/* Source */}
            <div style={{ marginTop: 10, fontFamily: fMono, fontSize: 9, color: C.muted, fontStyle: 'italic' }}>
              Source : data.gouv.fr — Ministère de l&apos;Intérieur · 6 186 codes postaux (France métro + DROM)
            </div>
          </>
        )}
      </div>
      )}{/* fin collapsible civic */}
    </div>
  );
}
