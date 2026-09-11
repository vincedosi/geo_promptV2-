'use client';

/**
 * Accordéon « Carreaux » de la catégorie Audience : bascule de la couche
 * PMTiles, choix de l'indicateur, palette, opacité et légende cliquable
 * (le clic sur un palier filtre la carte).
 *
 * JSX repris tel quel du monolithe (2026-09-03).
 */

import React from 'react';
import { CARREAUX_INDICATEURS, CARREAUX_PALETTES } from '@/lib/carreaux/catalogue';
import { uniteNormalisee } from '@/lib/carreaux/normalisation';
import { palierEchelle, versValeurReelle, formaterValeur } from '@/lib/carreaux/bornes';
import type { BornesEchelle } from '@/lib/carreaux/bornes';
import { C, fInter, fMono } from './tokens';

export interface CarreauxSectionProps {
  analyseOpen: Record<string, boolean>;
  toggleAnalyse: (key: string) => void;

  carreauxVisible?: boolean;
  carreauxLoaded?: boolean;
  carreauxIndicateur?: string;
  carreauxPalette?: string;
  carreauxOpacity?: number;
  carreaux3D?: boolean;
  carreauxHauteur?: number;
  carreauxRange?: BornesEchelle | null;
  carreauxSelectedBucket?: number | null;
  setCarreauxVisible?: (v: boolean | ((p: boolean) => boolean)) => void;
  setCarreauxIndicateur?: (v: string) => void;
  setCarreauxPalette?: (v: string) => void;
  setCarreauxOpacity?: (v: number) => void;
  setCarreaux3D?: (v: boolean) => void;
  setCarreauxHauteur?: (v: number) => void;
  setCarreauxSelectedBucket?: (v: number | null) => void;
}

export function CarreauxSection({
  analyseOpen,
  toggleAnalyse,
  carreauxVisible,
  carreauxLoaded,
  carreauxIndicateur,
  carreauxPalette,
  carreauxOpacity,
  carreaux3D,
  carreauxHauteur,
  carreauxRange,
  carreauxSelectedBucket,
  setCarreauxVisible,
  setCarreauxIndicateur,
  setCarreauxPalette,
  setCarreauxOpacity,
  setCarreaux3D,
  setCarreauxHauteur,
  setCarreauxSelectedBucket,
}: CarreauxSectionProps) {
  // `carreauxRange` porte des bornes NATIONALES fixes en log10 de la valeur
  // normalisée (cf. lib/carreaux/bornes.ts) : un effectif y est rapporté au
  // km², une somme Filosofi à son effectif. Ce ne sont plus des percentiles du
  // viewport — c'est précisément pour ça que le renommage p5/p95 → min/max a
  // eu lieu. L'unité affichée doit suivre le même dénominateur, sinon la
  // légende annonce « pers. » pour une densité.
  const indicateur = carreauxIndicateur ?? 'population_totale';
  const uniteBrute = CARREAUX_INDICATEURS.find(i => i.id === indicateur)?.unit ?? '';
  const unite = uniteNormalisee(indicateur, uniteBrute);

  return (
    <>
      <button
        onClick={() => toggleAnalyse('carreaux')}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', background: 'var(--bg-level-2)',
          border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background-color 180ms var(--ease-out)',
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
          Carreaux
        </span>
        <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.carreaux ? '▲' : '▼'}</span>
      </button>
      {analyseOpen.carreaux && (
      <div style={{ padding: '16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Toggle visible */}
        <button
          onClick={() => setCarreauxVisible?.(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            background: carreauxVisible ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
            border: `0.5px solid ${carreauxVisible ? 'var(--border-default)' : C.border}`,
            borderRadius: 4, cursor: 'pointer', width: '100%',
          }}
        >
          <span style={{ width: 11, height: 11, background: carreauxVisible ? 'var(--text-primary)' : 'transparent', border: `0.5px solid ${carreauxVisible ? 'var(--text-primary)' : 'var(--border-default)'}`, borderRadius: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {carreauxVisible && <span style={{ fontSize: 7, color: 'var(--bg-primary)', fontWeight: 700 }}>✓</span>}
          </span>
          <span style={{ fontFamily: fInter, fontSize: 13, color: carreauxVisible ? C.text : C.textDim }}>
            Carreaux{carreauxLoaded ? ' ✓' : ''}
          </span>
        </button>

        {/* Indicateur */}
        <select
          value={carreauxIndicateur ?? 'population_totale'}
          onChange={e => setCarreauxIndicateur?.(e.target.value)}
          style={{ width: '100%', background: C.bgInput, border: `0.5px solid ${C.border}`, borderRadius: 4, color: C.text, fontSize: 13, fontFamily: fInter, padding: '6px 8px', cursor: 'pointer', outline: 'none' }}
        >
          {Array.from(new Set(CARREAUX_INDICATEURS.map(i => i.group))).map(g => (
            <optgroup key={g} label={g} style={{ color: C.textDim }}>
              {CARREAUX_INDICATEURS.filter(i => i.group === g).map(ind => (
                <option key={ind.id} value={ind.id}>{ind.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* Palette */}
        <div>
          <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 5 }}>Palette</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {CARREAUX_PALETTES.map(p => (
              <button key={p.id} onClick={() => setCarreauxPalette?.(p.id)} title={p.label}
                style={{ border: `1.5px solid ${carreauxPalette === p.id ? 'var(--text-primary)' : 'transparent'}`, borderRadius: 3, padding: 0, cursor: 'pointer', background: 'none', display: 'flex', overflow: 'hidden', width: 28, height: 12 }}
              >
                {p.stops.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
              </button>
            ))}
          </div>
        </div>

        {/* Opacité */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, whiteSpace: 'nowrap' }}>Opacité</span>
          <input type="range" min={0.1} max={1} step={0.05}
            value={carreauxOpacity ?? 0.72}
            onChange={e => setCarreauxOpacity?.(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--text-primary)', cursor: 'pointer', height: 4 }}
          />
          <span style={{ color: C.textDim, fontSize: 11, fontFamily: fMono, minWidth: 26, textAlign: 'right' }}>
            {Math.round((carreauxOpacity ?? 0.72) * 100)}%
          </span>
        </div>

        {/* Relief 3D — bascule + hauteur des colonnes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            onClick={() => setCarreaux3D?.(!carreaux3D)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
              background: 'transparent',
              border: `0.5px solid ${carreaux3D ? 'var(--brand-teal)' : C.border}`,
              color: carreaux3D ? 'var(--brand-teal)' : C.textDim,
              borderRadius: 6, padding: '5px 10px',
              fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Relief 3D{carreaux3D ? ' ✓' : ''}
          </button>

          {/* La réglette n'a de sens qu'en relief : la masquer évite d'offrir un
              contrôle sans effet visible. */}
          {carreaux3D && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, whiteSpace: 'nowrap' }}>Hauteur</span>
              <input type="range" min={500} max={20000} step={500}
                value={carreauxHauteur ?? 4000}
                onChange={e => setCarreauxHauteur?.(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--text-primary)', cursor: 'pointer', height: 4 }}
              />
              <span style={{ color: C.textDim, fontSize: 11, fontFamily: fMono, minWidth: 38, textAlign: 'right' }}>
                {Math.round((carreauxHauteur ?? 4000) / 1000)} km
              </span>
            </div>
          )}
        </div>

        {/* Légende */}
        <div>
          <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            Légende
            {unite && (
              <span style={{ fontFamily: fMono, fontSize: 10, fontWeight: 400, color: C.textDim }}>
                {unite}
              </span>
            )}
            {carreauxSelectedBucket !== null && (
              <button onClick={() => setCarreauxSelectedBucket?.(null)}
                style={{ background: 'none', border: 'none', color: C.textSec, cursor: 'pointer', fontSize: 11, fontFamily: fInter, padding: 0 }}
              >✕ Tout</button>
            )}
          </div>
          {(() => {
            const pal = CARREAUX_PALETTES.find(p => p.id === (carreauxPalette ?? 'rouge')) ?? CARREAUX_PALETTES[0];
            if (carreauxRange) {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {pal.stops.map((color, i) => {
                    // L'échelle est logarithmique, la légende ne l'est pas : on
                    // repasse chaque borne en unité réelle avant affichage. Même
                    // découpage (palierEchelle) que le filtre par palier, et
                    // formatage à précision adaptative — un arrondi à l'entier
                    // affichait « 0 – 0 » sur les indicateurs rares.
                    const palier = palierEchelle(carreauxRange, i, 6);
                    const min = versValeurReelle(palier.min);
                    const max = versValeurReelle(palier.max);
                    const isSelected = carreauxSelectedBucket === i;
                    const fmt = formaterValeur;
                    return (
                      <button key={i} onClick={() => setCarreauxSelectedBucket?.(isSelected ? null : i)}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', background: isSelected ? color + '22' : 'none', border: `0.5px solid ${isSelected ? color : 'transparent'}`, borderRadius: 2, padding: '1px 3px', cursor: 'pointer' }}
                      >
                        <span style={{ width: 14, height: 8, background: color, borderRadius: 1, flexShrink: 0 }} />
                        <span style={{ color: isSelected ? C.text : C.textDim, fontSize: 10, fontFamily: fMono, flex: 1 }}>
                          {i === 5 ? `≥ ${fmt(min)}` : `${fmt(min)} – ${fmt(max)}`}
                        </span>
                        {isSelected && <span style={{ color, fontSize: 8, fontFamily: fMono }}>●</span>}
                      </button>
                    );
                  })}
                </div>
              );
            }
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {pal.stops.map((c, i) => <span key={i} style={{ display: 'inline-block', flex: 1, height: 7, background: c, borderRadius: 1 }} />)}
                <span style={{ color: C.textDim, fontSize: 9, marginLeft: 4, fontFamily: fMono }}>z≥10</span>
              </div>
            );
          })()}
        </div>

      </div>
      )}
    </>
  );
}
