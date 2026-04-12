'use client';

import { useState, useRef, useEffect } from 'react';
import { PALETTES } from '../_lib/palettes';

const fInter = "'Inter', sans-serif";

const C = {
  bg: '#050505', card: '#0a0a0a', elevated: '#111111',
  border: '#1a1a1a', text: '#f0f0f0', textSec: '#a0a0a0', textDim: '#666666',
  teal: '#4ecdc4',
};

interface Campaign { id: string; name: string; total_tracked_ads: number; }

interface DigitalToolbarProps {
  campaigns: Campaign[];
  selectedCampaign: string;
  onCampaignChange: (id: string) => void;
  scale: string;
  onScaleChange: (s: string) => void;
  palette: string;
  onPaletteChange: (id: string) => void;
  inverted: boolean;
  onInvertedChange: (v: boolean) => void;
  popField: string;
  onPopFieldChange: (f: string) => void;
  mediaList: string[];
  selectedMedia: string[];
  onMediaChange: (media: string[]) => void;
  loading: boolean;
  zonesCount: number;
  totalImpressions: number;
}

const POP_FIELDS = [
  { value: 'population', label: 'Population totale' },
  { value: 'pop_0_14', label: '0-14 ans' },
  { value: 'pop_15_29', label: '15-29 ans' },
  { value: 'pop_30_44', label: '30-44 ans' },
  { value: 'pop_45_59', label: '45-59 ans' },
  { value: 'pop_60_74', label: '60-74 ans' },
  { value: 'pop_75_plus', label: '75+ ans' },
  { value: 'nb_menages', label: 'Menages' },
  { value: 'nb_csp_cadre', label: 'CSP+ Cadres' },
  { value: 'nb_csp_employe', label: 'Employes' },
  { value: 'nb_csp_ouvrier', label: 'Ouvriers' },
  { value: 'nb_diplome_sup', label: 'Diplome sup.' },
  { value: 'rev_median', label: 'Revenu median' },
  { value: 'taux_chomage', label: '% Chomage' },
  { value: 'taux_pauvrete', label: '% Pauvrete' },
];

function MediaMultiSelect({ mediaList, selectedMedia, onMediaChange }: {
  mediaList: string[];
  selectedMedia: string[];
  onMediaChange: (media: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const allSelected = selectedMedia.length === 0;
  const count = allSelected ? mediaList.length : selectedMedia.length;
  const label = allSelected ? 'Toutes les regies' : `${count}/${mediaList.length} regies`;

  const toggle = (m: string) => {
    if (allSelected) {
      // Was "all" → select only this one
      onMediaChange([m]);
    } else if (selectedMedia.includes(m)) {
      const next = selectedMedia.filter(x => x !== m);
      onMediaChange(next); // empty = all
    } else {
      onMediaChange([...selectedMedia, m]);
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} style={{
        background: C.elevated, border: `0.5px solid ${open ? C.teal : C.border}`, borderRadius: 4,
        padding: '5px 10px', fontFamily: fInter, fontSize: 11, color: allSelected ? C.textSec : C.teal,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
      }}>
        {label}
        <span style={{ fontSize: 8, color: C.textDim }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100,
          background: '#0a0a0a', border: '0.5px solid #262626', borderRadius: 6,
          minWidth: 220, maxHeight: 300, overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        }}>
          {/* Select all / deselect all */}
          <button onClick={() => onMediaChange([])} style={{
            width: '100%', padding: '8px 12px', fontFamily: fInter, fontSize: 11, cursor: 'pointer',
            background: allSelected ? 'rgba(78,205,196,0.08)' : 'transparent',
            border: 'none', borderBottom: '0.5px solid #1a1a1a', textAlign: 'left',
            color: allSelected ? C.teal : C.textSec, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              width: 12, height: 12, borderRadius: 2, flexShrink: 0,
              border: `1px solid ${allSelected ? C.teal : '#333'}`,
              background: allSelected ? C.teal : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, color: '#050505', fontWeight: 700,
            }}>{allSelected ? '✓' : ''}</span>
            Tout selectionner
          </button>

          {/* Individual media items */}
          {mediaList.map(m => {
            const checked = allSelected || selectedMedia.includes(m);
            return (
              <button key={m} onClick={() => toggle(m)} style={{
                width: '100%', padding: '6px 12px', fontFamily: fInter, fontSize: 11, cursor: 'pointer',
                background: checked ? 'rgba(78,205,196,0.04)' : 'transparent',
                border: 'none', borderBottom: '0.5px solid #111111', textAlign: 'left',
                color: checked ? C.text : C.textDim, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                  border: `1px solid ${checked ? C.teal : '#333'}`,
                  background: checked ? C.teal : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 8, color: '#050505', fontWeight: 700,
                }}>{checked ? '✓' : ''}</span>
                {m}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DigitalToolbar({
  campaigns, selectedCampaign, onCampaignChange,
  scale, onScaleChange,
  palette, onPaletteChange, inverted, onInvertedChange,
  popField, onPopFieldChange,
  mediaList, selectedMedia, onMediaChange,
  loading, zonesCount, totalImpressions,
}: DigitalToolbarProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '8px 16px',
      background: C.card, borderBottom: `0.5px solid ${C.border}`,
      flexShrink: 0, flexWrap: 'wrap',
    }}>
      <select
        value={selectedCampaign}
        onChange={e => onCampaignChange(e.target.value)}
        style={{
          background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 4,
          padding: '6px 10px', fontFamily: fInter, fontSize: 12, color: C.text, outline: 'none',
          minWidth: 200, cursor: 'pointer',
        }}
      >
        <option value="">Campagne</option>
        {campaigns.map(c => (
          <option key={c.id} value={c.id}>{c.name} — {c.total_tracked_ads?.toLocaleString('fr-FR')} imp.</option>
        ))}
      </select>

      <div style={{ display: 'flex', gap: 2 }}>
        {[
          { id: 'cp', label: 'CP' },
          { id: 'departement', label: 'Dept' },
          { id: 'region', label: 'Région' },
        ].map(s => (
          <button key={s.id} onClick={() => onScaleChange(s.id)} style={{
            padding: '5px 10px', fontSize: 11, fontFamily: fInter, cursor: 'pointer',
            background: scale === s.id ? 'rgba(78,205,196,0.12)' : 'transparent',
            border: `0.5px solid ${scale === s.id ? C.teal : C.border}`,
            borderRadius: 3, color: scale === s.id ? C.teal : C.textSec, transition: 'all 0.15s',
          }}>{s.label}</button>
        ))}
      </div>

      {/* Population field */}
      <select
        value={popField}
        onChange={e => onPopFieldChange(e.target.value)}
        style={{
          background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 4,
          padding: '5px 8px', fontFamily: fInter, fontSize: 11, color: C.text, outline: 'none',
          cursor: 'pointer', maxWidth: 150,
        }}
      >
        {POP_FIELDS.map(f => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {/* Media filter — multi-select dropdown */}
      {mediaList.length > 0 && <MediaMultiSelect mediaList={mediaList} selectedMedia={selectedMedia} onMediaChange={onMediaChange} />}

      {loading && <span style={{ fontFamily: fInter, fontSize: 11, color: C.teal }}>Chargement...</span>}
      {!loading && zonesCount > 0 && (
        <span style={{ fontFamily: fInter, fontSize: 10, color: C.textDim, marginLeft: 'auto' }}>
          {zonesCount.toLocaleString('fr-FR')} zones · {totalImpressions.toLocaleString('fr-FR')} imp.
        </span>
      )}
    </div>
  );
}
