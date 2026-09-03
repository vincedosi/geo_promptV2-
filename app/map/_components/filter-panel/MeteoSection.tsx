'use client';

/**
 * Section « Météo » de la catégorie Audience : renvoie vers le configurateur
 * météo et permet de masquer la couche active.
 *
 * La section entière n'est rendue que si le parent fournit `onOpenMeteo` —
 * comportement conservé du monolithe (2026-09-03).
 */

import React from 'react';
import { FilterSectionHeader } from './FilterSectionHeader';
import { C } from './tokens';
import { pill, primaryBtn } from './styles';

export interface MeteoSectionProps {
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;
  meteoVisible?: boolean;
  meteoLabel?: string | null;
  onOpenMeteo: () => void;
  onClearMeteo?: () => void;
}

export function MeteoSection({
  filterSearch,
  sectionsOpen,
  toggleSection,
  meteoVisible,
  meteoLabel,
  onOpenMeteo,
  onClearMeteo,
}: MeteoSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FilterSectionHeader
        label="Météo"
        sectionKey="meteo"
        open={sectionsOpen.meteo !== false}
        onToggle={() => toggleSection('meteo')}
        count={meteoVisible ? 1 : 0}
        searchTerm={filterSearch}
      />
      {sectionsOpen.meteo !== false && (
        <div style={{ animation: 'fadeIn 200ms var(--ease-out)' }}>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.45, marginBottom: 8 }}>
            Données Open-Meteo agrégées par zone au choix — code postal, département ou région (précipitations, température, vent, ensoleillement). Historique 90 jours · prévisions 16 jours.
          </div>
          {meteoVisible && meteoLabel && (
            <div style={{
              fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--brand-teal)',
              padding: '4px 8px',
              background: 'var(--bg-level-2)',
              border: '0.5px solid var(--brand-teal)',
              borderRadius: 4,
              marginBottom: 8,
            }}>
              {meteoLabel} actif
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ ...primaryBtn('var(--brand-teal)', false), flex: 1 }}
              onClick={onOpenMeteo}
            >
              {meteoVisible ? 'Modifier la météo' : 'Configurer la météo'}
            </button>
            {meteoVisible && (
              <button
                style={pill(false, C.muted)}
                onClick={onClearMeteo}
                title="Masquer la couche météo"
              >Masquer</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
