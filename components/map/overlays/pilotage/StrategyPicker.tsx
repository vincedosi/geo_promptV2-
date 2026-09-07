'use client';

/**
 * Sélecteur de stratégie de l'overlay Pilotage — extrait de
 * PilotageOverlay.tsx (2026-09-07).
 *
 * Dropdown fermé au clic extérieur, liste des stratégies existantes et
 * entrée de création.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fInter, fMono, type StrategyListItem } from './shared';
import { SelectedRow } from './SelectedRow';

export function StrategyPicker({
  strategies, selectedId, onSelect, onCreateNew,
}: {
  strategies: StrategyListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fermer le dropdown sur clic extérieur
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = strategies.find(s => s.id === selectedId) ?? null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px',
        borderBottom: '0.5px solid var(--border-subtle)',
      }}
    >
      <label style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)', textTransform: 'lowercase' }}>
        stratégie
      </label>

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', fontSize: 12, fontFamily: fInter, fontWeight: 500,
          background: 'var(--bg-level-2, #111)',
          color: 'var(--text-primary)',
          border: `0.5px solid ${open ? 'rgba(78,205,196,0.5)' : 'var(--border-subtle)'}`,
          borderRadius: 6, cursor: 'pointer', textAlign: 'left',
        }}
      >
        {selected ? <SelectedRow s={selected} /> : <span style={{ color: 'var(--text-tertiary)' }}>Sélectionner une stratégie…</span>}
        <ChevronDown size={14} strokeWidth={1.5} style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }} />
      </button>

      <button
        onClick={onCreateNew}
        style={{
          padding: '8px 12px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
          background: 'transparent', color: 'var(--brand-teal)',
          border: '0.5px solid var(--brand-teal)', borderRadius: 6, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        + Nouvelle
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 12, right: 12,
            zIndex: 40,
            background: 'var(--bg-level-1, #0a0a0a)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 8,
            maxHeight: 360, overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {strategies.length === 0 ? (
            <div style={{ padding: 12, fontSize: 11, fontFamily: fInter, color: 'var(--text-tertiary)' }}>
              Aucune stratégie disponible.
            </div>
          ) : strategies.map(s => {
            const active = s.id === selectedId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { onSelect(s.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '10px 12px', fontSize: 12, fontFamily: fInter,
                  background: active ? 'rgba(78,205,196,0.06)' : 'transparent',
                  color: 'var(--text-primary)',
                  border: 'none', borderBottom: '0.5px solid var(--border-subtle)',
                  cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-level-2, #111)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <SelectedRow s={s} />
                {active && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--brand-teal)', fontFamily: fMono }}>actif</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

