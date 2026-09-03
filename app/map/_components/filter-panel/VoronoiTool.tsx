'use client';

/**
 * Outil « Voronoï géométrique » de l'analyse spatiale : découpe au POI le plus
 * proche à vol d'oiseau, sans appel API.
 *
 * Les trois outils d'analyse s'excluent : ouvrir celui-ci referme les deux
 * autres — comportement conservé du monolithe (2026-09-03).
 */

import React from 'react';
import { C, fInter } from './tokens';
import { pill, primaryBtn } from './styles';

export interface VoronoiToolProps {
  showVoronoi: boolean;
  setShowVoronoi: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBattle: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBattleV2: React.Dispatch<React.SetStateAction<boolean>>;
  isLoading: boolean;
  voronoiVisible: boolean;
  setVoronoiVisible: (v: boolean) => void;
  handleVoronoi: () => void;
}

export function VoronoiTool({
  showVoronoi,
  setShowVoronoi,
  setShowBattle,
  setShowBattleV2,
  isLoading,
  voronoiVisible,
  setVoronoiVisible,
  handleVoronoi,
}: VoronoiToolProps) {
  return (
    <div style={{ border: `0.5px solid ${showVoronoi ? 'var(--border-default)' : C.border}`, borderRadius: 4, overflow: 'hidden' }}>
      <button
        disabled={isLoading}
        onClick={() => { setShowVoronoi(s => !s); setShowBattle(false); setShowBattleV2(false); }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 12px', background: showVoronoi ? 'var(--bg-level-2)' : 'rgba(255,255,255,0.02)',
          border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: voronoiVisible ? C.text : C.textSec }}>
          {voronoiVisible ? '✓ ' : ''}Voronoï géométrique
        </span>
        <span style={{ color: C.textDim, fontSize: 10 }}>{showVoronoi ? '▲' : '▼'}</span>
      </button>
      {showVoronoi && (
        <div style={{ padding: '12px', background: 'rgba(255,255,255,0.01)', borderTop: `0.5px solid var(--border-subtle)`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: fInter, fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>
            Zones au POI le plus proche à vol d&apos;oiseau. Instantané, sans API.
          </div>
          <button style={primaryBtn('var(--text-primary)', isLoading)} disabled={isLoading} onClick={handleVoronoi}>
            Lancer le calcul
          </button>
          {voronoiVisible && (
            <button style={pill(false, C.textSec)} onClick={() => setVoronoiVisible(false)}>
              Masquer le Voronoï
            </button>
          )}
        </div>
      )}
    </div>
  );
}
