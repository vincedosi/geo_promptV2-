'use client';

/**
 * @file app/map/_components/panneaux/GroupeCalques.tsx — accordéon de groupe
 * du panneau Calques (Tâche 6, 2026-09-12).
 *
 * SEUL composant du panneau Calques à rendre un chevron DE GROUPE :
 * `ChevronRight` fermé, `ChevronDown` ouvert, 14px, `var(--text-tertiary)`,
 * poussé à droite (`ml-auto`). L'UI d'avant cette tâche en mélangeait quatre
 * variantes (FilterSectionHeader : ChevronDown pivoté ; CarreauxSection /
 * IrisSection : glyphes texte ▲/▼ ; CategoryGroup : sa propre implémentation)
 * — ce composant ferme cette dérive POUR LE NIVEAU GROUPE. Les accordéons
 * internes à une section déplacée (FilterSectionHeader, le ▲/▼ de
 * CarreauxSection/IrisSection) restent inchangés : ce sont des sections
 * existantes déplacées telles quelles, pas des groupes.
 *
 * Pas de puce décorative ici (spec §4) : le dot teal reste réservé à
 * l'en-tête du PANNEAU lui-même (`components/map/OverlayPanel.tsx:140`).
 */
import type { ReactNode } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

export interface GroupeCalquesProps {
  titre: string;
  ouvert: boolean;
  onToggle: () => void;
  /** Nombre de calques actifs dans ce groupe — badge optionnel, masqué si 0. */
  compte?: number;
  children: ReactNode;
}

export function GroupeCalques({ titre, ouvert, onToggle, compte, children }: GroupeCalquesProps) {
  return (
    <div style={{ borderTop: '0.5px solid var(--border-subtle)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={ouvert}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', background: 'var(--bg-level-2)',
          border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, fontWeight: 500,
          color: 'var(--text-primary)', flex: 1,
        }}>
          {titre}
        </span>
        {!!compte && compte > 0 && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--brand-teal)',
            background: 'rgba(78,205,196,0.15)', borderRadius: 4, padding: '1px 6px', lineHeight: 1.4,
          }}>
            {compte}
          </span>
        )}
        {ouvert
          ? <ChevronDown className="ml-auto" size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          : <ChevronRight className="ml-auto" size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
      </button>
      {ouvert && <div>{children}</div>}
    </div>
  );
}
