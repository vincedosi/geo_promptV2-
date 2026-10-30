'use client';

/**
 * Outil « Bataille V2 (multi-paliers) » de l'analyse spatiale : lit le cache
 * d'isochrones existant et découpe les territoires en PostGIS, sans appel ORS.
 * Le remplissage ORS des POI manquants reste un geste explicite.
 *
 * Flux critique du pitch : JSX déplacé strictement verbatim depuis le
 * monolithe (2026-09-03), aucune logique retouchée.
 */

import React from 'react';
import type { CacheStatus } from './analysis-types';
import { C, fInter, fMono } from './tokens';
import { labelStyle, pill, primaryBtn } from './styles';

/** Paliers proposés, en minutes. */
const V2_PALIERS = [10, 20, 30, 40, 50, 60, 90];

export interface BattleV2ToolProps {
  showBattleV2: boolean;
  setShowBattleV2: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBattle: React.Dispatch<React.SetStateAction<boolean>>;

  battleVisible: boolean;
  setBattleVisible: (v: boolean) => void;

  battleV2Paliers: number[];
  setBattleV2Paliers: React.Dispatch<React.SetStateAction<number[]>>;
  battleV2Loading: boolean;
  battleV2Log: string[];
  setBattleV2Log: React.Dispatch<React.SetStateAction<string[]>>;

  v2CacheStatus: CacheStatus;
  setV2CacheStatus: React.Dispatch<React.SetStateAction<CacheStatus>>;
  v2Checking: boolean;
  v2Filling: boolean;
  v2FillTotal: number;
  v2FillCompleted: number;
  v2FillPct: number;
  v2FillRings: number;

  handleCheckV2: () => void;
  handleFillMissingV2: () => void;
  handleBattleV2: (force?: boolean) => void;
}

export function BattleV2Tool({
  showBattleV2,
  setShowBattleV2,
  setShowBattle,
  battleVisible,
  setBattleVisible,
  battleV2Paliers,
  setBattleV2Paliers,
  battleV2Loading,
  battleV2Log,
  setBattleV2Log,
  v2CacheStatus,
  setV2CacheStatus,
  v2Checking,
  v2Filling,
  v2FillTotal,
  v2FillCompleted,
  v2FillPct,
  v2FillRings,
  handleCheckV2,
  handleFillMissingV2,
  handleBattleV2,
}: BattleV2ToolProps) {
  return (
    <div style={{ border: `0.5px solid ${showBattleV2 ? 'var(--border-default)' : C.border}`, borderRadius: 4, overflow: 'hidden' }}>
      <button
        disabled={battleV2Loading}
        onClick={() => { setShowBattleV2(s => !s); setShowBattle(false); }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 12px', background: showBattleV2 ? 'var(--bg-level-2)' : 'rgba(255,255,255,0.02)',
          border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: battleVisible ? C.text : C.textSec }}>
          {battleVisible ? '✓ ' : ''}Bataille V2 (multi-paliers)
        </span>
        <span style={{ color: C.textDim, fontSize: 10 }}>{showBattleV2 ? '▲' : '▼'}</span>
      </button>
    {showBattleV2 && (
      <div style={{ padding: '13px', background: 'rgba(255,255,255,0.01)', borderTop: `0.5px solid var(--border-subtle)`, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontFamily: fInter, fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>
          Lit le cache existant — <span style={{ color: C.text }}>aucun appel ORS</span>. Paliers manquants skippés.
          Lance d&apos;abord les isochrones v1 pour remplir le cache.
        </div>

        {/* Sélection des paliers */}
        <div>
          <div style={{ ...labelStyle }}>
            Paliers — {battleV2Paliers.join(', ')} min
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {V2_PALIERS.map(p => (
              <button
                key={p}
                style={pill(battleV2Paliers.includes(p), 'var(--text-primary)')}
                onClick={() => {
                  setV2CacheStatus(null);
                  setBattleV2Paliers(prev =>
                    prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p].sort((a, b) => a - b)
                  );
                }}
              >
                {p} min
              </button>
            ))}
          </div>
        </div>

        {/* ── Statut cache V2 ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Barre de statut */}
          {v2CacheStatus && (
            <div style={{
              background: v2CacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.06)' : 'rgba(251,191,36,0.06)',
              border: `0.5px solid ${v2CacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.3)' : 'rgba(247,183,49,0.35)'}`,
              borderRadius: 2, padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: fMono, fontSize: 9, color: '#94a3b8' }}>
                  {v2CacheStatus.total_pois} POIs · {v2CacheStatus.total_combos} isochrones
                </span>
                <span style={{ fontFamily: fMono, fontSize: 9, color: v2CacheStatus.missing_combos === 0 ? 'var(--success)' : C.amber, fontWeight: 700 }}>
                  {v2CacheStatus.missing_combos === 0
                    ? '✓ 100% en cache'
                    : `✕ ${v2CacheStatus.missing_pois} POI${v2CacheStatus.missing_pois > 1 ? 's' : ''} manquants`}
                </span>
              </div>
              {/* Barre de progression cache */}
              <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${Math.round((v2CacheStatus.cached_combos / Math.max(v2CacheStatus.total_combos, 1)) * 100)}%`,
                  background: v2CacheStatus.missing_combos === 0 ? 'var(--success)' : '#22d3ee',
                  transition: 'width 400ms linear',
                }} />
              </div>
              <div style={{ fontFamily: fMono, fontSize: 8, color: 'var(--text-tertiary)' }}>
                {v2CacheStatus.cached_combos}/{v2CacheStatus.total_combos} en cache
                {v2CacheStatus.missing_combos > 0 && ` · ${v2CacheStatus.missing_combos} à calculer`}
              </div>
            </div>
          )}

          {/* Bouton calculer manquants (si POIs sans cache) */}
          {v2CacheStatus && v2CacheStatus.missing_pois > 0 && (
            <button
              style={primaryBtn(C.amber, v2Filling || battleV2Loading)}
              disabled={v2Filling || battleV2Loading}
              onClick={handleFillMissingV2}
            >
              {v2Filling
                ? 'ORS EN COURS...'
                : `CALCULER ${v2CacheStatus.missing_pois} POI${v2CacheStatus.missing_pois > 1 ? 'S' : ''} MANQUANTS (ORS)`}
            </button>
          )}

          {/* Boutons lancer */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={primaryBtn('#6b7280', battleV2Paliers.length === 0 || v2Checking || v2Filling || battleV2Loading)}
              disabled={battleV2Paliers.length === 0 || v2Checking || v2Filling || battleV2Loading}
              onClick={handleCheckV2}
            >
              {v2Checking ? 'VÉRIF...' : 'VÉRIFIER CACHE'}
            </button>
            <button
              style={primaryBtn('#22d3ee', battleV2Paliers.length === 0 || battleV2Loading || v2Filling)}
              disabled={battleV2Paliers.length === 0 || battleV2Loading || v2Filling}
              onClick={() => { setV2CacheStatus(null); handleBattleV2(false); }}
            >
              {battleV2Loading ? 'CALCUL...' : 'LANCER'}
            </button>
            <button
              style={primaryBtn(C.amber, battleV2Paliers.length === 0 || battleV2Loading || v2Filling)}
              disabled={battleV2Paliers.length === 0 || battleV2Loading || v2Filling}
              onClick={() => { setV2CacheStatus(null); handleBattleV2(true); }}
            >
              FORCER
            </button>
          </div>
        </div>

        {/* ── Barre de progression ORS fill ── */}
        {v2Filling && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fInter, fontSize: 11, color: C.textDim }}>
              <span style={{ color: C.amber }}>
                {v2FillTotal > 0 ? `ORS — ${v2FillCompleted}/${v2FillTotal} POIs` : 'ORS — initialisation...'}
              </span>
              <span style={{ color: v2FillPct > 0 ? C.green : C.textDim }}>{v2FillPct}%</span>
            </div>
            {/* Barre principale */}
            <div style={{ height: 4, background: 'var(--bg-level-2)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${v2FillPct}%`,
                background: v2FillPct === 100 ? C.green : C.amber,
                transition: 'width 400ms linear',
              }} />
            </div>
            {/* Sous-stats */}
            <div style={{ display: 'flex', gap: 10, fontFamily: fInter, fontSize: 11, color: C.textDim }}>
              {v2FillTotal > 0 && (
                <>
                  <span style={{ color: C.green }}>↗ {v2FillRings} isochrones reçus</span>
                  <span>·</span>
                  <span>{v2FillTotal - v2FillCompleted} POIs restants</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Barre de progression Bataille V2 ── */}
        {battleV2Loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fInter, fontSize: 11, color: C.textDim }}>
              <span style={{ color: C.textSec, animation: 'fpBlink 1s linear infinite' }}>
                Bataille V2 — PostGIS ST_Difference...
              </span>
            </div>
            {/* Barre indéterminée */}
            <div style={{ height: 4, background: 'var(--bg-level-2)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                position: 'absolute', height: '100%', width: '40%',
                background: 'linear-gradient(90deg, transparent, var(--text-secondary), transparent)',
                animation: 'fpScan 1.8s linear infinite',
                borderRadius: 2,
              }} />
            </div>
          </div>
        )}

        {/* ── Log terminal ── */}
        {battleV2Log.length > 0 && (
          <div style={{
            background: 'var(--bg-primary)', border: `0.5px solid var(--border-default)`,
            borderRadius: 4, padding: '8px 10px', fontFamily: fMono, fontSize: 10,
            color: C.textDim, lineHeight: 1.7, maxHeight: 140, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 1,
          }}>
            {battleV2Log.map((line, i) => (
              <div key={i} style={{
                color: line.startsWith('> ✓') ? C.green
                     : line.startsWith('> ✕') ? C.red
                     : line.startsWith('> !') ? C.amber
                     : line.startsWith('> ◆') ? C.textSec
                     : line.startsWith('> ORS') ? C.amber
                     : C.textDim,
              }}>{line}</div>
            ))}
            {(battleV2Loading || v2Filling) && <div style={{ color: C.textSec, animation: 'fpBlink 1s linear infinite' }}>▌</div>}
          </div>
        )}

        {battleVisible && (
          <button style={pill(false, C.textSec)} onClick={() => { setBattleVisible(false); setBattleV2Log([]); }}>
            Masquer
          </button>
        )}
      </div>
    )}
    </div>
  );
}
