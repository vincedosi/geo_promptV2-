'use client';

/**
 * Ligne de stratégie affichée dans le sélecteur de l'overlay Pilotage —
 * extraite de PilotageOverlay.tsx (2026-09-07).
 *
 * Nom de campagne, algorithme, mode d'exécution coloré, badge démo.
 */

import React from 'react';
import { fMono, MODE_COLORS, type StrategyListItem } from './shared';

export function SelectedRow({ s }: { s: StrategyListItem }) {
  const modeColor = MODE_COLORS[s.execution_mode] ?? 'var(--text-secondary)';
  const campaignName = s.dsp_campaigns?.name ?? s.name;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {campaignName}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: fMono, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.algorithm_code} · {s.name}
        </div>
      </div>
      <span style={{
        fontSize: 9, fontFamily: fMono, color: modeColor,
        padding: '2px 6px', background: `${modeColor}1a`,
        border: `0.5px solid ${modeColor}40`, borderRadius: 4,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {s.execution_mode}
      </span>
      {s.dsp_campaigns?.is_demo && (
        <span style={{
          fontSize: 9, fontFamily: fMono, color: 'var(--warning, #f7b731)',
          padding: '2px 6px', background: 'rgba(247,183,49,0.1)',
          border: '0.5px solid rgba(247,183,49,0.3)', borderRadius: 4,
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          demo
        </span>
      )}
    </div>
  );
}

