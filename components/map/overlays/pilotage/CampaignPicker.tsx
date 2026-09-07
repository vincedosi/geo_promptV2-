'use client';

/**
 * Modale de choix de la campagne à piloter, à la création d'une stratégie —
 * extraite de PilotageOverlay.tsx (2026-09-07).
 */

import { useState } from 'react';
import { fInter, fMono, type CampaignLite } from './shared';

export function CampaignPicker({
  campaigns, onPick, onClose,
}: { campaigns: CampaignLite[]; onPick: (id: string) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<string>(campaigns[0]?.id ?? '');
  const selectedCamp = campaigns.find(c => c.id === selected);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-level-1)',
          border: '0.5px solid var(--border-subtle)',
          borderRadius: 8, padding: 16, width: 'min(440px, 90%)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4, fontFamily: fInter }}>
          Choisir la campagne DSP
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, fontFamily: fInter }}>
          La nouvelle stratégie sera attachée à cette campagne (Adform exclu).
        </div>

        {campaigns.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: 12 }}>
            Aucune campagne DSP éligible.
          </div>
        ) : (
          <>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fInter, marginBottom: 6 }}>
              Campagne
            </label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', fontSize: 13, fontFamily: fInter,
                background: 'var(--bg-level-2)', color: 'var(--text-primary)',
                border: '0.5px solid var(--border-subtle)', borderRadius: 6,
                outline: 'none', cursor: 'pointer',
              }}
            >
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} — {(c.dsp_source ?? '').toUpperCase()}
                </option>
              ))}
            </select>
            {selectedCamp && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fMono, marginTop: 8 }}>
                source : <span style={{ color: 'var(--text-secondary)' }}>{(selectedCamp.dsp_source ?? '').toUpperCase()}</span>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 12px', fontSize: 11, fontFamily: fInter,
              background: 'transparent', color: 'var(--text-tertiary)',
              border: '0.5px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            disabled={!selected}
            onClick={() => selected && onPick(selected)}
            style={{
              padding: '6px 14px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
              background: selected ? 'var(--brand-teal)' : 'var(--bg-level-2)',
              color: selected ? 'var(--bg-level-0)' : 'var(--text-tertiary)',
              border: 'none', borderRadius: 6,
              cursor: selected ? 'pointer' : 'not-allowed',
            }}
          >
            Continuer
          </button>
        </div>
      </div>
    </div>
  );
}
