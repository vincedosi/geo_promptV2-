'use client';

/**
 * Accordéon « IRIS » de la catégorie Audience : bascule de la couche, filtre
 * vrais IRIS, indicateur socio-démo (liste dynamique depuis IRIS_DB_COLUMNS),
 * palette, opacité et légende par déciles.
 *
 * JSX repris tel quel du monolithe (2026-09-03).
 */

import React from 'react';
import { IRIS_PALETTES, type IrisStats } from '@/app/copilote/_hooks/useMapLayers';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';
import { C, fInter, fMono } from './tokens';

export interface IrisSectionProps {
  analyseOpen: Record<string, boolean>;
  toggleAnalyse: (key: string) => void;

  irisVisible?: boolean;
  irisIndicateur?: string;
  irisPalette?: string;
  irisOpacity?: number;
  iris3D?: boolean;
  setIris3D?: (v: boolean) => void;
  irisHauteur?: number;
  setIrisHauteur?: (v: number) => void;
  irisStats?: IrisStats | null;
  irisTrueOnly?: boolean;
  /** Zoom courant de la carte — `null` tant que la carte n'est pas prête. */
  zoomCourant?: number | null;
  /** Zoom sous lequel aucune tuile IRIS n'existe (`IRIS_ZOOM_PLANCHER`). */
  irisZoomPlancher?: number;
  setIrisVisible?: (v: boolean | ((p: boolean) => boolean)) => void;
  setIrisIndicateur?: (v: string) => void;
  setIrisPalette?: (v: string) => void;
  setIrisOpacity?: (v: number) => void;
  setIrisTrueOnly?: (v: boolean) => void;
}

export function IrisSection({
  analyseOpen,
  toggleAnalyse,
  irisVisible,
  irisIndicateur,
  irisPalette,
  irisOpacity,
  iris3D,
  setIris3D,
  irisHauteur,
  setIrisHauteur,
  irisStats,
  irisTrueOnly,
  zoomCourant,
  irisZoomPlancher,
  setIrisVisible,
  setIrisIndicateur,
  setIrisPalette,
  setIrisOpacity,
  setIrisTrueOnly,
}: IrisSectionProps) {
  // Les IRIS n'existent pas en tuile sous leur plancher de zoom, et MapLibre ne
  // demande alors AUCUNE tuile : couche allumée, carte vide, zéro erreur. Ce
  // silence a été pris pour une panne. La bascule remonte la caméra à
  // l'activation ; ce bandeau couvre le cas restant — dézoomer couche allumée.
  const sousLePlancher =
    irisVisible === true &&
    typeof irisZoomPlancher === 'number' &&
    typeof zoomCourant === 'number' &&
    zoomCourant < irisZoomPlancher;

  return (
    <>
      <button
        onClick={() => toggleAnalyse('iris')}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', background: 'var(--bg-level-2)',
          border: 'none', borderTop: '1px solid var(--border-subtle)', borderLeft: '2px solid rgba(78,205,196,0.25)', borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer', transition: 'background-color 180ms var(--ease-out)',
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
          IRIS
          {irisVisible && <span style={{ color: C.green, marginLeft: 6 }}>●</span>}
        </span>
        <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.iris ? '▲' : '▼'}</span>
      </button>
      {analyseOpen.iris && (
      <div style={{ padding: '16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Toggle visible */}
        <button
          onClick={() => setIrisVisible?.(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            background: irisVisible ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
            border: `0.5px solid ${irisVisible ? 'var(--border-default)' : C.border}`,
            borderRadius: 4, cursor: 'pointer', width: '100%',
          }}
        >
          <span style={{ width: 11, height: 11, background: irisVisible ? 'var(--text-primary)' : 'transparent', border: `0.5px solid ${irisVisible ? 'var(--text-primary)' : 'var(--border-default)'}`, borderRadius: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {irisVisible && <span style={{ fontSize: 7, color: 'var(--bg-primary)', fontWeight: 700 }}>✓</span>}
          </span>
          <span style={{ fontFamily: fInter, fontSize: 13, color: irisVisible ? C.text : C.textDim }}>
            Couche IRIS
          </span>
        </button>

        {/* Pourquoi la couche ne montre rien — voir `sousLePlancher` ci-dessus */}
        {sousLePlancher && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 4,
              background: 'rgba(247,183,49,0.1)',
              border: '0.5px solid rgba(247,183,49,0.2)',
            }}
          >
            <span style={{ fontFamily: fInter, fontSize: 11, color: C.amber, flex: 1, lineHeight: 1.4 }}>
              Trop loin pour les IRIS — lisibles à partir du zoom {irisZoomPlancher}
              {typeof zoomCourant === 'number' && (
                <span style={{ fontFamily: fMono, color: C.textDim }}>{` (z${zoomCourant.toFixed(1)})`}</span>
              )}
            </span>
            {/* Réactiver la couche déjà active : la bascule porte la remontée de
                caméra, on ne la duplique pas ici. */}
            <button
              type="button"
              onClick={() => setIrisVisible?.(true)}
              style={{
                background: 'transparent', border: `0.5px solid ${C.amber}`,
                color: C.amber, borderRadius: 4, padding: '3px 8px',
                fontFamily: fInter, fontSize: 11, fontWeight: 500,
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              Zoomer
            </button>
          </div>
        )}

        {/* Toggle vrais IRIS uniquement */}
        <button
          onClick={() => setIrisTrueOnly?.(!irisTrueOnly)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            background: 'rgba(255,255,255,0.02)',
            border: `0.5px solid ${C.border}`,
            borderRadius: 4, cursor: 'pointer', width: '100%',
          }}
        >
          <span style={{ width: 11, height: 11, background: irisTrueOnly ? 'var(--text-primary)' : 'transparent', border: `0.5px solid ${irisTrueOnly ? 'var(--text-primary)' : 'var(--border-default)'}`, borderRadius: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {irisTrueOnly && <span style={{ fontSize: 7, color: 'var(--bg-primary)', fontWeight: 700 }}>✓</span>}
          </span>
          <span style={{ fontFamily: fInter, fontSize: 12, color: C.textSec, flex: 1, textAlign: 'left' }}>
            Vrais IRIS uniquement
          </span>
          <span style={{ fontFamily: fInter, fontSize: 10, color: C.textDim }}>
            {irisTrueOnly ? '16 k quartiers' : '49 k (+ communes)'}
          </span>
        </button>

        {/* Indicateur — généré depuis IRIS_DB_COLUMNS */}
        <select
          value={irisIndicateur ?? 'pop_15_29'}
          onChange={e => setIrisIndicateur?.(e.target.value)}
          style={{ width: '100%', background: C.bgInput, border: `0.5px solid ${C.border}`, borderRadius: 4, color: C.text, fontSize: 13, fontFamily: fInter, padding: '6px 8px', cursor: 'pointer', outline: 'none' }}
        >
          {Array.from(
            IRIS_DB_COLUMNS.filter(c => c.type !== 'boolean').reduce((acc, col) => {
              if (!acc.has(col.group)) acc.set(col.group, []);
              acc.get(col.group)!.push(col);
              return acc;
            }, new Map<string, typeof IRIS_DB_COLUMNS>())
          ).map(([group, cols]) => (
            <optgroup key={group} label={group} style={{ color: C.textDim }}>
              {cols.map(col => (
                <option key={col.name} value={col.name}>{col.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* Palette */}
        <div>
          <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 5 }}>Palette</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {IRIS_PALETTES.map(p => (
              <button key={p.id} onClick={() => setIrisPalette?.(p.id)} title={p.label}
                style={{ border: `1.5px solid ${irisPalette === p.id ? 'var(--text-primary)' : 'transparent'}`, borderRadius: 3, padding: 0, cursor: 'pointer', background: 'none', display: 'flex', overflow: 'hidden', width: 28, height: 12 }}
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
            value={irisOpacity ?? 0.45}
            onChange={e => setIrisOpacity?.(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--text-primary)', cursor: 'pointer', height: 4 }}
          />
          <span style={{ color: C.textDim, fontSize: 11, fontFamily: fMono, minWidth: 26, textAlign: 'right' }}>
            {Math.round((irisOpacity ?? 0.45) * 100)}%
          </span>
        </div>

        {/* Relief 3D — bascule + exagération */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            onClick={() => setIris3D?.(!iris3D)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
              background: 'transparent',
              border: `0.5px solid ${iris3D ? 'var(--brand-teal)' : C.border}`,
              color: iris3D ? 'var(--brand-teal)' : C.textDim,
              borderRadius: 6, padding: '5px 10px',
              fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Relief 3D{iris3D ? ' ✓' : ''}
          </button>

          {/* La réglette n'a de sens qu'en relief : la masquer évite d'offrir un
              contrôle sans effet visible. */}
          {iris3D && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Exagération, et non hauteur en mètres : un IRIS parisien fait
                  0,06 km² et un IRIS rural 30 km². Une hauteur absolue écraserait
                  les premiers et transformerait les seconds en colonnes plates. */}
              <span style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, whiteSpace: 'nowrap' }}>Relief</span>
              <input type="range" min={0.25} max={5} step={0.25}
                value={irisHauteur ?? 1.5}
                onChange={e => setIrisHauteur?.(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--text-primary)', cursor: 'pointer', height: 4 }}
              />
              <span style={{ color: C.textDim, fontSize: 11, fontFamily: fMono, minWidth: 38, textAlign: 'right' }}>
                ×{(irisHauteur ?? 1.5).toFixed(2).replace(/0$/, '').replace(/[.,]$/, '')}
              </span>
            </div>
          )}
        </div>

        {/* Légende */}
        <div>
          <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 4 }}>Légende</div>
          {(() => {
            const pal = IRIS_PALETTES.find(p => p.id === (irisPalette ?? 'bleu')) ?? IRIS_PALETTES[0];
            if (irisStats && irisStats.col_exists && irisStats.max > 0) {
              const pts = [irisStats.p10, irisStats.p25, irisStats.p50, irisStats.p75, irisStats.p90, irisStats.max];
              const fmt = (v: number) => v >= 100000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString();
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {pal.stops.map((color, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 14, height: 8, background: color, borderRadius: 1, flexShrink: 0 }} />
                      <span style={{ color: C.textDim, fontSize: 8, fontFamily: fMono }}>
                        {i === 0 ? `≤ ${fmt(pts[0])}` : i === 5 ? `≥ ${fmt(pts[4])}` : `${fmt(pts[i - 1])} – ${fmt(pts[i])}`}
                      </span>
                    </div>
                  ))}
                </div>
              );
            }
            if (irisVisible && !irisStats) {
              return <div style={{ color: C.textDim, fontSize: 11, fontFamily: fInter }}>Chargement...</div>;
            }
            if (irisStats && !irisStats.col_exists) {
              return <div style={{ color: C.amber, fontSize: 11, fontFamily: fInter }}>! Colonne non disponible en base</div>;
            }
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {pal.stops.map((c, i) => <span key={i} style={{ display: 'inline-block', flex: 1, height: 7, background: c, borderRadius: 1 }} />)}
              </div>
            );
          })()}
        </div>

      </div>
      )}
    </>
  );
}
