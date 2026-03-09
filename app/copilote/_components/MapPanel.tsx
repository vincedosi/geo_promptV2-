import { ISOCHRONE_COLORS, ISOCHRONE_MODE_LABELS, BATTLE_PALIER_OPACITY, getCatColor } from '../_lib/constants';
import type { ZoneData, VoronoiData } from '@/types/spatial';

interface SelectedBillboard {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  format?: string;
  score?: number | null;
  audience?: number | null;
  rank?: number | null;
  regie?: string;
}

interface MapPanelProps {
  mapContainerRef: React.RefObject<HTMLDivElement>;
  zoneData: ZoneData | null;
  activeCats: string[];
  isochroneVisible: boolean;
  isochroneMinutes: number;
  isochroneMode: string;
  isochroneFromCache: boolean;
  isochroneCachedAt: string;
  setIsochroneVisible: (v: boolean) => void;
  recalculerIsochrone: () => void;
  isLoading: boolean;
  voronoiVisible: boolean;
  voronoiCategory: string;
  voronoiCirfas: { id: string; nom: string; color: string }[];
  setVoronoiVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  voronoiDataForSaveRef: React.MutableRefObject<VoronoiData | null>;
  setShowSavePanel: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSaveError: (v: string | null) => void;
  battleVisible: boolean;
  battleCategory: string;
  battleCirfas: { id: string; nom: string; color: string }[];
  setBattleVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  carreauxVisible: boolean;
  carreauxLoaded: boolean;
  carreauxLabel: string;
  setCarreauxVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  selectedBillboard: SelectedBillboard | null;
  closeBillboardDrawer: () => void;
  mapStyleUrl?: string;
  mapStyles?: { id: string; label: string; url: string }[];
  onMapStyleChange?: (url: string) => void;
}

// Design tokens
const C = {
  bg:        '#050505',
  bgElevated:'#0d0d0d',
  bgOverlay: 'rgba(5,5,5,0.88)',
  border:    '#261a35',
  accent:    '#a855f7',
  accentDim: 'rgba(168,85,247,0.15)',
  accentBorder: 'rgba(168,85,247,0.35)',
  muted:     '#6b7280',
  text:      '#e2e8f0',
  textDim:   '#94a3b8',
  danger:    '#ef4444',
  dangerBg:  'rgba(239,68,68,0.12)',
  dangerBorder: 'rgba(239,68,68,0.35)',
  success:   '#22c55e',
  warn:      '#f59e0b',
  blue:      '#3b82f6',
};

const fontMono = "'JetBrains Mono', 'Fira Code', monospace";
const fontMichroma = "'Michroma', 'Orbitron', sans-serif";

const badgeBase: React.CSSProperties = {
  position: 'absolute',
  zIndex: 10,
  background: C.bgOverlay,
  backdropFilter: 'blur(8px)',
  border: `1px solid ${C.border}`,
  borderRadius: 2,
  padding: '6px 10px',
  fontSize: 10,
  fontFamily: fontMono,
  color: C.text,
  letterSpacing: '0.05em',
};

const toggleBtnBase = (active: boolean, activeColor: string): React.CSSProperties => ({
  position: 'absolute',
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: active ? `${activeColor}20` : C.bgOverlay,
  border: `1px solid ${active ? activeColor : C.border}`,
  borderRadius: 2,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 10,
  fontFamily: fontMono,
  color: active ? activeColor : C.textDim,
  backdropFilter: 'blur(8px)',
  transition: 'all 0.15s',
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
});

export function MapPanel({
  mapContainerRef, zoneData, activeCats,
  isochroneVisible, isochroneMinutes, isochroneMode, isochroneFromCache, isochroneCachedAt,
  setIsochroneVisible, recalculerIsochrone, isLoading,
  voronoiVisible, voronoiCategory, voronoiCirfas, setVoronoiVisible,
  voronoiDataForSaveRef, setShowSavePanel, setSaveError,
  battleVisible, battleCategory, battleCirfas, setBattleVisible,
  carreauxVisible, carreauxLoaded, carreauxLabel, setCarreauxVisible,
  selectedBillboard, closeBillboardDrawer,
  mapStyleUrl, mapStyles, onMapStyleChange,
}: MapPanelProps) {
  const streetViewSrc = selectedBillboard
    ? `https://www.google.com/maps/embed/v1/streetview?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&location=${selectedBillboard.lat},${selectedBillboard.lng}&heading=0&pitch=0&fov=90`
    : '';

  return (
    <div style={{ flex: 1, position: 'relative', background: C.bg }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />

      {/* Badge zone active */}
      {zoneData && (
        <div style={{ ...badgeBase, top: 12, left: 12 }}>
          <div style={{ color: C.accent, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.12em', marginBottom: 3 }}>
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
          top: 12,
          left: zoneData ? 150 : 12,
          borderColor: (ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).line + '80',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: (ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).line, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.12em' }}>
              ISO_{isochroneMinutes}min
            </span>
            <span style={{ color: C.textDim }}>
              {ISOCHRONE_MODE_LABELS[isochroneMode] ?? isochroneMode}
            </span>
            {isochroneFromCache && <span style={{ color: C.muted, fontSize: 9 }}>CACHE</span>}
            <button
              onClick={() => setIsochroneVisible(false)}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }}
            >✕</button>
          </div>
          {isochroneFromCache && isochroneCachedAt && (
            <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: C.muted, fontSize: 9 }}>
                {new Date(isochroneCachedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
              <button
                onClick={recalculerIsochrone}
                disabled={isLoading}
                style={{ background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 2, padding: '2px 6px', color: C.accent, cursor: 'pointer', fontSize: 9, fontFamily: fontMichroma, letterSpacing: '0.08em' }}
              >RECALC</button>
            </div>
          )}
        </div>
      )}

      {/* Badge Voronoï actif */}
      {voronoiVisible && voronoiCategory && (
        <div style={{
          ...badgeBase,
          top: isochroneVisible && isochroneMinutes > 0 ? 100 : 60,
          left: 12,
          borderColor: C.warn + '60',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: C.warn, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.12em' }}>
              VORONOI
            </span>
            <span style={{ color: C.textDim }}>{voronoiCategory}</span>
            <button
              onClick={() => setVoronoiVisible(false)}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }}
            >✕</button>
          </div>
        </div>
      )}

      {/* Badge carreaux indicateur */}
      {carreauxVisible && carreauxLabel && (
        <div style={{ ...badgeBase, top: 52, right: 12, borderColor: C.blue + '60' }}>
          <span style={{ color: C.blue, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.12em', marginRight: 6 }}>CARREAUX</span>
          <span style={{ color: C.textDim }}>{carreauxLabel}</span>
        </div>
      )}

      {/* Voronoï toggle */}
      {voronoiCategory && (
        <button
          onClick={() => setVoronoiVisible(v => !v)}
          title={voronoiVisible ? 'Masquer le Voronoï' : 'Afficher le Voronoï'}
          style={{ ...toggleBtnBase(voronoiVisible, C.warn), top: 52, right: 12 }}
        >
          <span style={{ width: 8, height: 8, background: voronoiVisible ? C.warn : 'transparent', border: `1.5px solid ${C.warn}`, borderRadius: 1, flexShrink: 0 }} />
          Voronoï
        </button>
      )}

      {/* Bataille toggle */}
      {battleCategory && (
        <button
          onClick={() => setBattleVisible(v => !v)}
          title={battleVisible ? 'Masquer la Bataille' : "Afficher la Bataille d'Isochrones"}
          style={{ ...toggleBtnBase(battleVisible, C.danger), top: voronoiCategory ? 86 : 52, right: 12 }}
        >
          <span style={{ width: 8, height: 8, background: battleVisible ? C.danger : 'transparent', border: `1.5px solid ${C.danger}`, borderRadius: 1, flexShrink: 0 }} />
          Bataille
        </button>
      )}

      {/* Carreaux toggle */}
      <button
        onClick={() => setCarreauxVisible(v => !v)}
        title={carreauxVisible ? 'Masquer les carreaux' : 'Afficher les carreaux démographiques'}
        style={{ ...toggleBtnBase(carreauxVisible, C.blue), top: 12, right: 12 }}
      >
        <span style={{ width: 8, height: 8, background: carreauxVisible ? C.blue : 'transparent', border: `1.5px solid ${C.blue}`, borderRadius: 1, flexShrink: 0 }} />
        Carreaux{carreauxLoaded ? ' ✓' : ''}
      </button>

      {/* Légende catégories */}
      {activeCats.length > 0 && (
        <div style={{
          ...badgeBase,
          bottom: 48,
          left: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          maxWidth: 220,
        }}>
          <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.12em', marginBottom: 2 }}>
            LEGENDE
          </div>
          {activeCats.map((cat) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: zoneData!.couleur_overrides?.[cat] ?? getCatColor(cat), flexShrink: 0 }} />
              <span style={{ color: C.textDim }}>{cat} <span style={{ color: C.muted }}>({zoneData!.categories[cat]})</span></span>
            </div>
          ))}
          {zoneData!.rayon_metres && (
            <div style={{ marginTop: 3, paddingTop: 5, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ display: 'inline-block', width: 9, height: 9, background: C.accentDim, borderRadius: 1, border: `1.5px dashed ${C.accent}`, flexShrink: 0 }} />
              <span style={{ color: C.textDim }}>Zone {(zoneData!.rayon_metres / 1000).toFixed(1)} km</span>
            </div>
          )}
          {zoneData!.rayon_poi_metres && (
            <div style={{ marginTop: 3, paddingTop: 5, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ display: 'inline-block', width: 9, height: 9, background: 'rgba(34,197,94,0.12)', borderRadius: '50%', border: `1.5px solid ${C.success}`, flexShrink: 0 }} />
              <span style={{ color: C.textDim }}>R={zoneData!.rayon_poi_metres >= 1000 ? `${(zoneData!.rayon_poi_metres/1000).toFixed(1)}km` : `${zoneData!.rayon_poi_metres}m`}/POI</span>
            </div>
          )}
          {isochroneVisible && isochroneMinutes > 0 && (
            <div style={{ marginTop: 3, paddingTop: 5, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ display: 'inline-block', width: 9, height: 9, background: `${(ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).fill}30`, borderRadius: 1, border: `1.5px solid ${(ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).line}`, flexShrink: 0 }} />
              <span style={{ color: C.textDim }}>Iso {isochroneMinutes}min ({ISOCHRONE_MODE_LABELS[isochroneMode] ?? isochroneMode})</span>
            </div>
          )}
          {voronoiVisible && voronoiCategory && (() => {
            const regionLabel = voronoiDataForSaveRef.current?._meta?.filtre_region
              ?? voronoiDataForSaveRef.current?._meta?.filtre_ville
              ?? voronoiDataForSaveRef.current?._meta?.filtre_dept
              ?? null;
            return (
              <div style={{ marginTop: 3, paddingTop: 5, borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 9, height: 9, background: (voronoiCirfas[0]?.color ?? C.warn) + '40', borderRadius: 1, border: `1.5px solid ${voronoiCirfas[0]?.color ?? C.warn}`, flexShrink: 0 }} />
                    <span style={{ color: C.text, fontSize: 9, fontFamily: fontMichroma, letterSpacing: '0.08em' }}>
                      VORONOI{regionLabel ? ` · ${regionLabel}` : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => { setShowSavePanel(true); setSaveError(null); }}
                    title="Sauvegarder ce Voronoï"
                    style={{ background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 2, padding: '2px 7px', fontSize: 9, color: C.accent, cursor: 'pointer', fontFamily: fontMichroma, letterSpacing: '0.08em' }}
                  >SAVE</button>
                </div>
                {voronoiCirfas.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, background: c.color + '40', borderRadius: 1, border: `1.5px solid ${c.color}`, flexShrink: 0 }} />
                    <span style={{ fontSize: 9, color: C.textDim }}>{c.nom}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          {battleVisible && battleCategory && (
            <div style={{ marginTop: 3, paddingTop: 5, borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 9, height: 9, background: C.dangerBg, borderRadius: 1, border: `1.5px solid ${C.danger}`, flexShrink: 0 }} />
                <span style={{ color: C.text, fontSize: 9, fontFamily: fontMichroma, letterSpacing: '0.08em' }}>BATAILLE · {battleCategory}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                {[10, 30, 60, 90, 120, 150].map(p => (
                  <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                    <span style={{ display: 'inline-block', width: 14, height: 7, background: `rgba(239,68,68,${BATTLE_PALIER_OPACITY[p]})`, borderRadius: 1 }} />
                    <span style={{ fontSize: 8, color: C.muted }}>{p}m</span>
                  </div>
                ))}
              </div>
              {battleCirfas.slice(0, 8).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: c.color + '40', borderRadius: 1, border: `1.5px solid ${c.color}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: C.textDim }}>{c.nom}</span>
                </div>
              ))}
              {battleCirfas.length > 8 && (
                <span style={{ fontSize: 9, color: C.muted }}>+{battleCirfas.length - 8} autres</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sélecteur de style de carte */}
      {mapStyles && onMapStyleChange && (
        <div style={{
          position: 'absolute', bottom: 48, right: 12, zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end',
        }}>
          <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.muted, letterSpacing: '0.12em', marginBottom: 2 }}>
            FOND_CARTE
          </div>
          {mapStyles.map(s => {
            const active = mapStyleUrl === s.url;
            return (
              <button
                key={s.id}
                onClick={() => onMapStyleChange(s.url)}
                style={{
                  background: active ? C.accentDim : C.bgOverlay,
                  border: `1px solid ${active ? C.accent : C.border}`,
                  borderRadius: 2,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  fontSize: 9,
                  fontFamily: fontMichroma,
                  color: active ? C.accent : C.textDim,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  transition: 'all 0.15s',
                  backdropFilter: 'blur(8px)',
                  minWidth: 72,
                  textAlign: 'right',
                }}
              >
                {active && <span style={{ marginRight: 5, fontSize: 7 }}>▶</span>}{s.label}
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
          background: 'rgba(5,5,5,0.96)',
          borderLeft: `1px solid ${C.border}`,
          backdropFilter: 'blur(12px)',
          boxShadow: `-8px 0 32px rgba(0,0,0,0.5)`,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header drawer */}
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontFamily: fontMichroma, fontSize: 10, color: C.accent, letterSpacing: '0.12em' }}>
              STREET_VIEW
            </div>
            <button
              onClick={closeBillboardDrawer}
              aria-label="Fermer"
              style={{ background: 'rgba(255,255,255,0.04)', color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 2, width: 26, height: 26, cursor: 'pointer', fontSize: 13, lineHeight: 1, transition: 'all 0.15s' }}
            >✕</button>
          </div>

          {/* Infos panneau */}
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: 10, fontFamily: fontMono, fontSize: 11, color: C.text, lineHeight: 1.6 }}>
              <div><span style={{ color: C.accent, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em' }}>ID</span>{'  '}{selectedBillboard.id}</div>
              <div><span style={{ color: C.accent, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em' }}>NOM</span>{'  '}{selectedBillboard.nom}</div>
              <div><span style={{ color: C.accent, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em' }}>FMT</span>{'  '}{selectedBillboard.format || '—'}</div>
              <div><span style={{ color: C.accent, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em' }}>SCR</span>{'  '}{selectedBillboard.score != null ? selectedBillboard.score : '—'}</div>
              <div><span style={{ color: C.accent, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.1em' }}>AUD</span>{'  '}{selectedBillboard.audience != null ? Number(selectedBillboard.audience).toLocaleString('fr-FR') : '—'}</div>
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
    </div>
  );
}
