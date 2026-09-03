'use client';

/** Liste déroulante multi-sélection avec recherche — utilisée par 7 sections. */

import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { C, fInter } from './tokens';

export function MultiDropdown({
  label, items, selected, onChange, searchable = false,
}: {
  label: string;
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  searchable?: boolean;
}) {
  const [open, setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Auto-enable search when >10 items
  const showSearch = searchable || items.length > 10;

  const filtered = showSearch && search
    ? items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()) || i.id.toLowerCase().includes(search.toLowerCase()))
    : items;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(i => selected.includes(i.id));

  const selectAllFiltered = () => {
    const newIds = new Set(selected);
    for (const i of filtered) newIds.add(i.id);
    onChange([...newIds]);
  };

  const deselectAllFiltered = () => {
    const toRemove = new Set(filtered.map(i => i.id));
    onChange(selected.filter(id => !toRemove.has(id)));
  };

  const displayLabel = selected.length === 0
    ? label
    : selected.length === 1
      ? (items.find(i => i.id === selected[0])?.label ?? selected[0])
      : `${selected.length} / ${items.length} selectionnes`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 11px', background: C.bgInput,
          border: `0.5px solid ${open ? 'var(--border-hover)' : C.border}`, borderRadius: 4,
          cursor: 'pointer', fontFamily: fInter, fontSize: 13, color: selected.length > 0 ? C.text : C.textDim,
          transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 8 }}>
          {selected.length > 0 && (
            <span
              onClick={e => { e.stopPropagation(); onChange([]); }}
              style={{ fontSize: 11, color: C.textDim, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
              title="Effacer"
            >✕</span>
          )}
          <span style={{ color: C.textDim, fontSize: 9 }}>{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
          background: 'var(--bg-level-2)', border: `0.5px solid var(--border-default)`, borderTop: 'none',
          borderRadius: '0 0 4px 4px', maxHeight: 260, display: 'flex', flexDirection: 'column',
          animation: 'fpDropIn 180ms var(--ease-out)',
        }}>
          {/* Search bar */}
          {showSearch && (
            <div style={{ padding: '5px 8px', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Search size={12} style={{ color: C.textDim, flexShrink: 0 }} />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                aria-label="Rechercher"
                placeholder="Rechercher..." style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontFamily: fInter, fontSize: 12, color: C.text }} />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche"
                  style={{ fontSize: 10, color: C.textDim, cursor: 'pointer', flexShrink: 0, background: 'transparent', border: 'none', padding: 0, lineHeight: 1 }}>✕</button>
              )}
            </div>
          )}

          {/* Select all / deselect all bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: `0.5px solid ${C.border}`, flexShrink: 0 }}>
            <button onClick={allFilteredSelected ? deselectAllFiltered : selectAllFiltered}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: fInter, fontSize: 10, color: 'var(--brand-teal)', padding: 0 }}>
              {allFilteredSelected ? 'Tout deselectionner' : `Tout selectionner${search ? ` (${filtered.length})` : ''}`}
            </button>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: C.textDim }}>
              {selected.length}/{items.length}
            </span>
          </div>

          {/* Items list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '8px 11px', fontFamily: fInter, fontSize: 12, color: C.textDim }}>Aucun resultat</div>
            )}
            {filtered.map(item => {
              const active = selected.includes(item.id);
              return (
                <button key={item.id} onClick={() => toggle(item.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                    padding: '6px 11px', background: active ? 'rgba(78,205,196,0.06)' : 'none',
                    border: 'none', borderBottom: `0.5px solid ${C.border}`,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = active ? 'rgba(78,205,196,0.06)' : 'none'; }}
                >
                  <div style={{
                    width: 12, height: 12, borderRadius: 2, border: `0.5px solid ${active ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                    background: active ? 'var(--brand-teal)' : 'transparent', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {active && <span style={{ fontSize: 8, color: 'var(--bg-primary)', fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontFamily: fInter, fontSize: 12, color: active ? C.text : C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
