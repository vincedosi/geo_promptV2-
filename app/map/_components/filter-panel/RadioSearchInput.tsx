'use client';

/** Autocomplétion de recherche de station radio — section Radio FM/DAB+. */

import React from 'react';
import { adminFetch } from '@/lib/admin-fetch';

export function RadioSearchInput({ onSelect }: { onSelect: (radioId: string, radioNom: string) => void }) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Array<{ id: string; nom: string; categorie_arcom: string | null }>>([]);
  const [show, setShow] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>();

  const search = (q: string) => {
    setQuery(q);
    clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); setShow(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await adminFetch(`/api/radio/stations?search=${encodeURIComponent(q)}&limit=8`);
        if (!res.ok) return;
        const d = await res.json();
        setResults(d.stations ?? []);
        setShow(true);
      } catch { /* ignore */ }
    }, 300);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => search(e.target.value)}
        placeholder="Ex: NRJ, France Inter..."
        style={{
          width: '100%', background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6,
          padding: '6px 10px', fontSize: 11, color: 'var(--text-primary)', outline: 'none',
          fontFamily: "'Inter', system-ui, sans-serif",
          transition: 'border-color 150ms var(--ease-hover)',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; if (results.length) setShow(true); }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; setTimeout(() => setShow(false), 200); }}
      />
      {show && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderRadius: 6,
          marginTop: 4, maxHeight: 200, overflowY: 'auto',
        }}>
          {results.map(r => (
            <button key={r.id} onMouseDown={() => { onSelect(r.id, r.nom); setQuery(r.nom); setShow(false); }} style={{
              display: 'block', width: '100%', padding: '6px 10px', background: 'none', border: 'none',
              textAlign: 'left', cursor: 'pointer', fontSize: 11, color: 'var(--text-primary)',
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: 'background-color 150ms var(--ease-hover)',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-level-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {r.nom} {r.categorie_arcom && <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>({r.categorie_arcom})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
