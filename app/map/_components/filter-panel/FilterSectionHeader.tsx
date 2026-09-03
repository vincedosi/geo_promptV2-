'use client';

/** En-tête de section repliable du FilterPanel + libellés d'aide associés. */

import React from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

// ─── Tooltip data for complex labels ──────────────────────────────────────────
export const TOOLTIPS: Record<string, string> = {
  tmja:       'Trafic Moyen Journalier Annuel — nombre de véhicules/jour sur un tronçon routier',
  iris:       'Ilots Regroupés pour l\'Information Statistique — découpage INSEE de 2 000 habitants',
  carreaux:   'Maillage 200m de l\'INSEE avec revenus et données fiscales',
  isochrone:  'Zone accessible en X minutes depuis un point donné',
  poi:        'Point d\'Intérêt — commerce, service, lieu public',
};

// ─── Collapsible section header ───────────────────────────────────────────────
export function FilterSectionHeader({
  label, sectionKey, open, onToggle, count, tooltipKey, searchTerm,
}: {
  label: string; sectionKey: string; open: boolean; onToggle: () => void;
  count?: number; tooltipKey?: string; searchTerm?: string;
}) {
  // Highlight search match in label
  const renderLabel = () => {
    if (!searchTerm) return label;
    const idx = label.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (idx < 0) return label;
    return (
      <>
        {label.slice(0, idx)}
        <mark style={{ background: 'rgba(78,205,196,0.2)', color: 'var(--text-primary)', borderRadius: 2, padding: '0 1px' }}>
          {label.slice(idx, idx + searchTerm.length)}
        </mark>
        {label.slice(idx + searchTerm.length)}
      </>
    );
  };

  return (
    <div
      onClick={onToggle}
      style={{
        background: 'var(--bg-level-2)', borderTop: '1px solid var(--border-subtle)',
        padding: '10px 14px', margin: '0 -16px',
        display: 'flex', alignItems: 'center', gap: 8,
        cursor: 'pointer', userSelect: 'none',
        position: 'sticky', top: 0, zIndex: 10,
      }}
    >
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
      <span style={{ fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 500, fontSize: 12, color: 'var(--text-primary)', flex: 1 }}>
        {renderLabel()}
      </span>
      {tooltipKey && TOOLTIPS[tooltipKey] && (
        <span
          title={TOOLTIPS[tooltipKey]}
          style={{ display: 'inline-flex', cursor: 'help', flexShrink: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <HelpCircle size={12} style={{ color: 'var(--text-tertiary)' }} />
        </span>
      )}
      {count !== undefined && count > 0 && (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--brand-teal)',
          background: 'rgba(78,205,196,0.15)', borderRadius: 4, padding: '1px 6px', lineHeight: 1.4,
        }}>
          {count}
        </span>
      )}
      <ChevronDown size={14} style={{
        color: 'var(--text-tertiary)', flexShrink: 0,
        transition: 'transform 200ms var(--ease-out)',
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
      }} />
    </div>
  );
}
