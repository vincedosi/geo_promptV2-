'use client';

/**
 * Encarts d'accueil de l'analyse spatiale : ce qui est disponible quand aucun
 * POI n'est sélectionné, et l'avertissement quand il y en a plusieurs.
 *
 * Les analyses spatiales exigent exactement un type de POI — ces deux encarts
 * expliquent la contrainte au lieu d'afficher des boutons désactivés.
 *
 * JSX repris tel quel du monolithe (2026-09-03).
 */

import React from 'react';
import { C, fInter, fMono } from './tokens';

/** Outils présentés dans l'encart d'accueil. */
const AVAILABLE_TOOLS = [
  { icon: '⬡', label: 'Voronoï géométrique', desc: 'Zones à vol d\'oiseau' },
  { icon: '◎', label: 'Isochrones routiers', desc: 'Temps de trajet réel ORS' },
];

/** Aucun POI sélectionné : présente les analyses et la condition d'accès. */
export function SpatialAnalysisEmptyState() {
  return (
    <div style={{
      padding: '14px', borderRadius: 4,
      background: 'rgba(255,255,255,0.02)',
      border: `0.5px solid ${C.border}`,
    }}>
      <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textDim, marginBottom: 8 }}>
        Analyses spatiales disponibles
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {AVAILABLE_TOOLS.map(tool => (
          <div key={tool.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 4, border: `0.5px solid ${C.border}` }}>
            <span style={{ fontSize: 14, color: C.textDim, flexShrink: 0, fontFamily: fMono }}>{tool.icon}</span>
            <div>
              <div style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: C.textSec }}>{tool.label}</div>
              <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginTop: 1 }}>{tool.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, padding: '9px 11px', background: 'rgba(255,255,255,0.03)', border: `0.5px solid var(--border-default)`, borderRadius: 4 }}>
        <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.textSec, marginBottom: 4 }}>
          Sélectionnez 1 seul type de POI
        </div>
        <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
          Isolez un réseau (ex: CIRFA) pour débloquer le calcul de zone de chalandise.
        </div>
      </div>
    </div>
  );
}

/** Plus d'un POI sélectionné : indique combien de types retirer. */
export function SpatialAnalysisTooManyPoi({ selectedCount }: { selectedCount: number }) {
  return (
    <div style={{ padding: '10px 12px', background: C.redDim, border: `0.5px solid ${C.redBorder}`, borderRadius: 4, marginTop: 4 }}>
      <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.red, marginBottom: 4 }}>! Trop de types sélectionnés</div>
      <div style={{ fontFamily: fInter, fontSize: 12, color: '#fca5a5', lineHeight: 1.5 }}>
        Les analyses spatiales nécessitent exactement 1 type de POI. Retirez {selectedCount - 1} type{selectedCount > 2 ? 's' : ''}.
      </div>
    </div>
  );
}
