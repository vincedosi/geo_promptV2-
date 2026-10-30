import React, { useState } from 'react';
import { ISOCHRONE_COLORS, ISOCHRONE_MODE_LABELS } from '../_lib/constants';
import maplibregl from 'maplibre-gl';
import type { ZoneData } from '@/types/spatial';
import type { SelectedBillboard } from '@/types/map';
import type { BornesEchelle } from '@/lib/carreaux/bornes';

interface MapPanelProps {
  mapContainerRef: React.RefObject<HTMLDivElement | null>;
  mapRef?: React.MutableRefObject<maplibregl.Map | null>;
  mapReady?: boolean;
  zoneData: ZoneData | null;
  isochroneVisible: boolean;
  isochroneMinutes: number;
  isochroneMode: string;
  isochroneFromCache: boolean;
  isochroneCachedAt: string;
  setIsochroneVisible: (v: boolean) => void;
  battleVisible: boolean;
  battleCategory: string;
  setBattleVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  carreauxRange: BornesEchelle | null;
  carreauxSelectedBucket: number | null;
  setCarreauxVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  setCarreauxIndicateur: (v: string) => void;
  setCarreauxPalette: (v: string) => void;
  setCarreauxOpacity: (v: number) => void;
  setCarreauxSelectedBucket: (v: number | null) => void;
  selectedBillboard: SelectedBillboard | null;
  closeBillboardDrawer: () => void;
  mapStyleUrl?: string;
  mapStyles?: { id: string; label: string; url: string }[];
  onMapStyleChange?: (url: string) => void;
}

// Design tokens
const C = {
  bg:        'var(--bg-primary)',
  bgElevated:'var(--bg-level-2)',
  bgOverlay: 'rgba(10,10,10,0.9)',
  border:    'var(--border-subtle)',
  text:      'var(--text-primary)',
  textSec:   'var(--text-secondary)',
  textDim:   'var(--text-tertiary)',
  green:     'var(--success)',
  warning:   'var(--warning)',
  red:       'var(--danger)',
  danger:    '#ef4444',
  dangerBg:  'rgba(239,68,68,0.1)',
  dangerBorder: 'rgba(239,68,68,0.3)',
  success:   'var(--success)',
  warn:      'var(--warning)',
  blue:      '#38bdf8',
};

const fontMono = "'JetBrains Mono', 'Fira Code', monospace";
const fontInter = "'Inter', system-ui, sans-serif";

// Overlays carte : utilisent --bg-surface theme-aware (opaque pour lisibilite
// garantie en light mode). backdrop-filter ajoute un voile vitre sur la carte.
const badgeBase: React.CSSProperties = {
  position: 'absolute',
  zIndex: 10,
  background: 'var(--bg-surface)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '0.5px solid var(--border-subtle)',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 10,
  fontFamily: fontMono,
  color: C.text,
  letterSpacing: '0.04em',
  transition: 'all 0.2s ease',
};

const toggleBtnBase = (active: boolean, activeColor: string): React.CSSProperties => ({
  position: 'absolute',
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: active ? `${activeColor}18` : 'var(--bg-surface)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: `0.5px solid ${active ? activeColor + '80' : 'var(--border-subtle)'}`,
  borderRadius: 4,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 10,
  fontFamily: fontInter,
  color: active ? activeColor : C.textDim,
  transition: 'all 0.2s ease',
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
});

export function MapPanel({
  mapContainerRef, mapRef, mapReady, zoneData,
  isochroneVisible, isochroneMinutes, isochroneMode, isochroneFromCache, isochroneCachedAt,
  setIsochroneVisible,
  battleVisible, battleCategory, setBattleVisible,
  carreauxRange, carreauxSelectedBucket,
  setCarreauxVisible, setCarreauxIndicateur, setCarreauxPalette, setCarreauxOpacity, setCarreauxSelectedBucket,
  selectedBillboard, closeBillboardDrawer,
  mapStyleUrl, mapStyles, onMapStyleChange,
}: MapPanelProps) {
  const [currentZoom, setCurrentZoom] = useState<number | null>(null);
  const [hoveredToggle, setHoveredToggle] = useState<string | null>(null);

  // Écoute le zoom de la carte
  React.useEffect(() => {
    const map = mapRef?.current;
    if (!map || !mapReady) return;
    const update = () => setCurrentZoom(Math.round(map.getZoom() * 10) / 10);
    update();
    map.on('zoom', update);
    return () => { map.off('zoom', update); };
  }, [mapRef, mapReady]);
  const streetViewSrc = selectedBillboard
    ? `https://www.google.com/maps/embed/v1/streetview?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&location=${selectedBillboard.lat},${selectedBillboard.lng}&heading=0&pitch=0&fov=90`
    : '';

  return (
    <div style={{ flex: 1, position: 'relative', background: C.bg }}>
      <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />
      {/* carreaux-mvt-fill/line init dans useMapInit, visibilité gérée par useMapLayers */}

      {/* Zoom badge */}
      {currentZoom !== null && (
        <div style={{
          ...badgeBase,
          top: 12,
          right: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          animation: 'mapBadgeFade 0.3s ease-out',
        }}>
          <span style={{ color: C.textDim, fontFamily: fontMono, fontSize: 9, letterSpacing: '0.08em' }}>Z</span>
          <span style={{ color: 'var(--brand-teal)', fontFamily: fontMono, fontSize: 11, fontWeight: 600 }}>{currentZoom}</span>
        </div>
      )}

      {/* ── Colonne contrôles top-left ───────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        display: 'flex', flexDirection: 'column', gap: 6,
        width: 220, maxHeight: 'calc(100% - 80px)', overflowY: 'auto',
      }}>

      {/* ZONE_ACTIVE */}
      {zoneData && (
        <div style={{ ...badgeBase, position: 'relative' }}>
          <div style={{ color: C.textSec, fontFamily: fontMono, fontSize: 9, letterSpacing: '0.08em', marginBottom: 3 }}>
            ZONE_ACTIVE
          </div>
          <div style={{ color: C.text, fontWeight: 600 }}>{zoneData.ville}</div>
          <div style={{ color: C.textDim, marginTop: 2 }}>
            {zoneData.rayon_metres ? `r=${(zoneData.rayon_metres / 1000).toFixed(1)}km · ` : ''}{zoneData.nb_pois} POI
          </div>
        </div>
      )}

      {/* Badge isochrone actif */}
      {isochroneVisible && isochroneMinutes > 0 && (
        <div style={{
          ...badgeBase,
          position: 'relative',
          borderColor: (ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).line + '80',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: (ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).line, fontFamily: fontMono, fontSize: 9, letterSpacing: '0.08em' }}>
              ISO_{isochroneMinutes}min
            </span>
            <span style={{ color: C.textDim }}>
              {ISOCHRONE_MODE_LABELS[isochroneMode] ?? isochroneMode}
            </span>
            {isochroneFromCache && <span style={{ color: C.textDim, fontSize: 9 }}>CACHE</span>}
            <button
              onClick={() => setIsochroneVisible(false)}
              style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }}
            >✕</button>
          </div>
          {isochroneFromCache && isochroneCachedAt && (
            <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: C.textDim, fontSize: 9 }}>
                {new Date(isochroneCachedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Toggles layers : ligne compacte */}
      <div style={{ display: 'flex', gap: 4 }}>
        {/* Carreaux : contrôles dans PanneauCalques > Socio-démographie (Tâche 6, 2026-09-12) */}
        {battleCategory && (
          <button onClick={() => setBattleVisible(v => !v)}
            onMouseEnter={() => setHoveredToggle('battle')}
            onMouseLeave={() => setHoveredToggle(null)}
            style={{ ...toggleBtnBase(battleVisible, C.danger), position: 'relative', flex: 1, justifyContent: 'center', padding: '5px 6px', transform: hoveredToggle === 'battle' ? 'scale(1.02)' : 'scale(1)' }}>
            <span style={{ width: 7, height: 7, background: battleVisible ? C.danger : 'transparent', border: `1.5px solid ${C.danger}`, borderRadius: 1, flexShrink: 0 }} />
            Bataille
          </button>
        )}
      </div>

      {/* La légende catégories POI / isochrone / Voronoï / bataille a été
          absorbée dans LegendeCarte (composants/map/LegendeCarte.tsx,
          BlocAnalyse) le 2026-09-12 (Tâche 7) — une seule légende à l'écran,
          plus deux dans des coins opposés. */}

      </div>{/* ── fin colonne top-left ── */}

      {/* FOND_CARTE compact */}
      {mapStyles && onMapStyleChange && (
        <div style={{
          position: 'absolute', bottom: 28, right: 12, zIndex: 10,
          display: 'flex', flexDirection: 'row', gap: 2, alignItems: 'center',
        }}>
          <span style={{ fontFamily: fontMono, fontSize: 9, color: C.textDim, letterSpacing: '0.06em', marginRight: 4 }}>FOND</span>
          {mapStyles.map(s => {
            const active = mapStyleUrl === s.url;
            return (
              <button
                key={s.id}
                onClick={() => onMapStyleChange(s.url)}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                title={s.label}
                style={{
                  background: active ? 'var(--brand-teal)' : 'transparent',
                  border: `0.5px solid ${active ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                  borderRadius: 4,
                  padding: '3px 8px',
                  cursor: 'pointer',
                  fontSize: 9,
                  fontFamily: fontInter,
                  color: active ? 'var(--bg-primary)' : C.textDim,
                  transition: 'all 0.2s ease',
                }}
              >
                {s.label.slice(0, 3)}
              </button>
            );
          })}
        </div>
      )}

      {/* Drawer Street View */}
      {selectedBillboard && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 'min(420px, 92vw)', zIndex: 30,
          background: C.bg,
          borderLeft: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header drawer */}
          <div style={{ padding: '10px 14px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textSec, letterSpacing: '0.06em' }}>
              STREET_VIEW
            </div>
            <button
              onClick={closeBillboardDrawer}
              aria-label="Fermer"
              style={{ background: 'transparent', color: C.textDim, border: `0.5px solid ${C.border}`, borderRadius: 4, width: 28, height: 28, cursor: 'pointer', fontSize: 13, lineHeight: 1, transition: 'all 0.15s' }}
            >✕</button>
          </div>

          {/* Infos panneau */}
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 4, padding: 10, fontFamily: fontMono, fontSize: 11, color: C.text, lineHeight: 1.6 }}>
              <div><span style={{ color: C.textDim, fontSize: 9 }}>ID </span>{selectedBillboard.id}</div>
              <div><span style={{ color: C.textDim, fontSize: 9 }}>NOM </span>{selectedBillboard.nom}</div>
              <div><span style={{ color: C.textDim, fontSize: 9 }}>FMT </span>{selectedBillboard.format || '—'}</div>
              <div><span style={{ color: C.textDim, fontSize: 9 }}>SCR </span>{selectedBillboard.score != null ? selectedBillboard.score : '—'}</div>
              <div><span style={{ color: C.textDim, fontSize: 9 }}>AUD </span>{selectedBillboard.audience != null ? Number(selectedBillboard.audience).toLocaleString('fr-FR') : '—'}</div>
            </div>

            {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
              <iframe
                title={`Street View ${selectedBillboard.nom}`}
                width="100%"
                height="360"
                style={{ border: `1px solid ${C.border}`, borderRadius: 2, background: C.bgElevated, display: 'block' }}
                loading="lazy"
                allowFullScreen
                src={streetViewSrc}
              />
            ) : (
              <div style={{ background: C.dangerBg, border: `1px solid ${C.dangerBorder}`, color: '#fecaca', borderRadius: 2, padding: '10px 12px', fontSize: 11, fontFamily: fontMono }}>
                NEXT_PUBLIC_GOOGLE_MAPS_API_KEY manquante.
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes mapBadgeFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>
    </div>
  );
}
