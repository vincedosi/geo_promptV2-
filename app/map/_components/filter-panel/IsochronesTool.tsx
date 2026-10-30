'use client';

/**
 * Outil « Isochrones routiers (ORS) » de l'analyse spatiale : anneaux
 * concentriques par temps de trajet réel, puis découpe sans chevauchement
 * (bouton BATAILLE, ST_Difference côté PostGIS).
 *
 * Flux critique du pitch : JSX déplacé strictement verbatim depuis le
 * monolithe (2026-09-03), aucune logique retouchée.
 */

import React from 'react';
import { ISO_DURATIONS } from '@/lib/geo/france-admin';
import type { BattleRing, CacheStatus } from './analysis-types';
import { C, fInter, fMono } from './tokens';
import { labelStyle, pill, primaryBtn } from './styles';

export interface IsochronesToolProps {
  showBattle: boolean;
  setShowBattle: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBattleV2: React.Dispatch<React.SetStateAction<boolean>>;

  battleVisible: boolean;
  setBattleVisible: (v: boolean) => void;
  battleOuterFillVisible: boolean;
  setBattleOuterFillVisible: (v: boolean) => void;

  isoDurations: number[];
  toggleDuration: (d: number) => void;

  orsCacheStatus: CacheStatus;
  orsChecking: boolean;
  handleCheckORS: () => void;

  battleLoading: boolean;
  battleLog: string[];
  setBattleLog: React.Dispatch<React.SetStateAction<string[]>>;
  battleTotal: number;
  battleCompleted: number;
  battleProgress: number;
  handleBattle: (force?: boolean) => void;

  battleRings: BattleRing[];
  battleMeta: { categorie: string; mode: string } | null;
  battleApplyLoading: boolean;
  setBattleApplyLoading: React.Dispatch<React.SetStateAction<boolean>>;
  battleApplyPct: number;
  setBattleApplyPct: React.Dispatch<React.SetStateAction<number>>;
  onApplyBattle: (
    rings: BattleRing[],
    category?: string,
    poisForMap?: { id: string; nom: string; lat: number; lng: number; adresse?: string; ville?: string }[],
    onProgress?: (msg: string, pct: number) => void,
  ) => Promise<void>;
}

export function IsochronesTool({
  showBattle,
  setShowBattle,
  setShowBattleV2,
  battleVisible,
  setBattleVisible,
  battleOuterFillVisible,
  setBattleOuterFillVisible,
  isoDurations,
  toggleDuration,
  orsCacheStatus,
  orsChecking,
  handleCheckORS,
  battleLoading,
  battleLog,
  setBattleLog,
  battleTotal,
  battleCompleted,
  battleProgress,
  handleBattle,
  battleRings,
  battleMeta,
  battleApplyLoading,
  setBattleApplyLoading,
  battleApplyPct,
  setBattleApplyPct,
  onApplyBattle,
}: IsochronesToolProps) {
  return (
    <div style={{ border: `0.5px solid ${showBattle ? 'var(--border-default)' : C.border}`, borderRadius: 4, overflow: 'hidden' }}>
      <button
        disabled={battleLoading}
        onClick={() => { setShowBattle(s => !s); setShowBattleV2(false); }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 12px', background: showBattle ? 'var(--bg-level-2)' : 'rgba(255,255,255,0.02)',
          border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: battleVisible ? C.text : C.textSec }}>
          {battleVisible ? '✓ ' : ''}Isochrones routiers (ORS)
        </span>
        <span style={{ color: C.textDim, fontSize: 10 }}>{showBattle ? '▲' : '▼'}</span>
      </button>
      {showBattle && (
      <div style={{ padding: '13px', background: 'rgba(255,255,255,0.01)', borderTop: `0.5px solid var(--border-subtle)`, display: 'flex', flexDirection: 'column', gap: 13 }}>

        {/* Durées */}
        <div>
          <div style={labelStyle}>
            Temps de trajet
            {isoDurations.length > 0 && <span style={{ color: C.textSec }}> — {isoDurations.join(', ')} min</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {ISO_DURATIONS.map(d => (
              <button key={d} style={pill(isoDurations.includes(d), 'var(--text-primary)')} onClick={() => toggleDuration(d)}>
                {d} min
              </button>
            ))}
          </div>
          <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginTop: 5, fontStyle: 'italic' }}>
            Anneaux concentriques — calculé via ORS directement, sans IA
          </div>
        </div>

        {/* ── Statut cache ORS ── */}
        {orsCacheStatus && (
          <div style={{
            background: orsCacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.06)' : 'rgba(251,191,36,0.06)',
            border: `0.5px solid ${orsCacheStatus.missing_combos === 0 ? 'rgba(61,255,160,0.3)' : 'rgba(247,183,49,0.35)'}`,
            borderRadius: 2, padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: fMono, fontSize: 9, color: '#94a3b8' }}>
                {orsCacheStatus.total_pois} POIs · {orsCacheStatus.total_combos} isochrones
              </span>
              <span style={{ fontFamily: fMono, fontSize: 9, color: orsCacheStatus.missing_combos === 0 ? 'var(--success)' : C.amber, fontWeight: 700 }}>
                {orsCacheStatus.missing_combos === 0
                  ? '✓ 100% en cache'
                  : `${orsCacheStatus.missing_pois} POI${orsCacheStatus.missing_pois > 1 ? 's' : ''} à calculer`}
              </span>
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${Math.round((orsCacheStatus.cached_combos / Math.max(orsCacheStatus.total_combos, 1)) * 100)}%`,
                background: orsCacheStatus.missing_combos === 0 ? 'var(--success)' : C.red,
                transition: 'width 400ms linear',
              }} />
            </div>
            <div style={{ fontFamily: fMono, fontSize: 8, color: 'var(--text-tertiary)' }}>
              {orsCacheStatus.cached_combos}/{orsCacheStatus.total_combos} en cache
              {orsCacheStatus.missing_combos > 0 && ` · ORS calculera les ${orsCacheStatus.missing_combos} manquants automatiquement`}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={primaryBtn('#6b7280', isoDurations.length === 0 || battleLoading || orsChecking)}
            disabled={isoDurations.length === 0 || battleLoading || orsChecking}
            onClick={handleCheckORS}
          >
            {orsChecking ? 'VÉRIF...' : 'VÉRIFIER CACHE'}
          </button>
          <button
            style={primaryBtn(C.red, isoDurations.length === 0 || battleLoading)}
            disabled={isoDurations.length === 0 || battleLoading}
            onClick={() => handleBattle(false)}
          >
            {battleLoading ? 'CALCUL ORS...' : 'LANCER'}
          </button>
          <button
            style={primaryBtn(C.amber, isoDurations.length === 0 || battleLoading)}
            disabled={isoDurations.length === 0 || battleLoading}
            onClick={() => handleBattle(true)}
          >
            RECALCULER
          </button>
        </div>

        {battleLog.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* ── Barre de progression ── */}
            {battleLoading && battleTotal > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                  <span style={{ color: battleProgress === 100 ? C.green : C.amber }}>
                    {battleProgress === 100 ? '✓ Terminé' : `ORS — ${battleCompleted}/${battleTotal} POIs`}
                  </span>
                  <span style={{ color: battleProgress > 0 ? C.green : C.textDim }}>{battleProgress}%</span>
                </div>
                <div style={{ height: 4, background: 'var(--bg-level-2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${battleProgress}%`,
                    background: battleProgress === 100 ? C.green : C.textSec,
                    transition: 'width 400ms linear',
                    borderRadius: 2,
                  }} />
                </div>
              </div>
            )}
            {/* ── Log terminal ── */}
            <div style={{
              background: 'var(--bg-primary)', border: `0.5px solid var(--border-default)`,
              borderRadius: 4, padding: '8px 10px', fontFamily: fMono, fontSize: 10,
              color: C.textDim, lineHeight: 1.7, maxHeight: 120, overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 1,
            }}>
              {battleLog.map((line, i) => (
                <div key={i} style={{
                  color: line.startsWith('> ✓') ? C.green
                       : line.startsWith('> ✕') ? C.red
                       : line.startsWith('> !') ? C.amber
                       : line.includes('[3/3]') ? C.green
                       : C.textDim,
                }}>{line}</div>
              ))}
              {battleLoading && (
                <div style={{ color: C.textDim, animation: 'fpBlink 1s linear infinite' }}>▌</div>
              )}
            </div>
          </div>
        )}

        {battleVisible && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={pill(false, C.textSec)} onClick={() => { setBattleVisible(false); setBattleLog([]); }}>
              Masquer les isochrones
            </button>
            <button
              style={pill(battleOuterFillVisible, C.textSec)}
              onClick={() => setBattleOuterFillVisible(!battleOuterFillVisible)}
              title="Afficher/masquer le remplissage Voronoï résiduel (zones hors portée)"
            >
              {battleOuterFillVisible ? 'Voronoï ✓' : 'Voronoï'}
            </button>
          </div>
        )}

        {/* ── Bouton BATAILLE (Phase 2 — ST_Difference) ────── */}
        {battleRings.length > 0 && !battleLoading && (
          <>
          <button
            style={{ ...pill(false, C.textSec), opacity: battleApplyLoading ? 0.5 : 1 }}
            disabled={battleApplyLoading}
            onClick={async () => {
              setBattleApplyLoading(true);
              setBattleApplyPct(0);
              setBattleLog(prev => [...prev, '> [BATAILLE] ST_Difference en cours…']);
              try {
                await onApplyBattle(
                  battleRings,
                  battleMeta?.categorie,
                  undefined,
                  (msg, pct) => {
                    setBattleLog(prev => [...prev, `> ${msg}`]);
                    setBattleApplyPct(pct);
                  },
                );
                setBattleApplyPct(100);
                setBattleLog(prev => [...prev, '> ✓ Territoires découpés sans chevauchement']);
              } catch (e: unknown) {
                setBattleLog(prev => [...prev, `> ✕ ${e instanceof Error ? e.message : 'Erreur bataille'}`]);
              } finally {
                setBattleApplyLoading(false);
              }
            }}
          >
            {battleApplyLoading ? `BATAILLE… ${battleApplyPct}%` : 'X BATAILLE (ST_Difference)'}
          </button>
          {/* Barre de progression BATAILLE */}
          {battleApplyLoading && (
            <div style={{ height: 3, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${battleApplyPct}%`,
                background: battleApplyPct === 100 ? C.green : C.textSec,
                transition: 'width 400ms linear, background-color 180ms var(--ease-out)',
              }} />
            </div>
          )}
          </>
        )}
      </div>
      )}
    </div>
  );
}
