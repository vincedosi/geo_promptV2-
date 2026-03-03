import { ISOCHRONE_COLORS, ISOCHRONE_MODE_LABELS, BATTLE_PALIER_OPACITY, getCatColor } from '../_lib/constants';
import type { ZoneData, VoronoiData } from '@/types/spatial';

interface MapPanelProps {
  mapContainerRef: React.RefObject<HTMLDivElement>;
  zoneData: ZoneData | null;
  activeCats: string[];
  // Isochrone
  isochroneVisible: boolean;
  isochroneMinutes: number;
  isochroneMode: string;
  isochroneFromCache: boolean;
  isochroneCachedAt: string;
  setIsochroneVisible: (v: boolean) => void;
  recalculerIsochrone: () => void;
  isLoading: boolean;
  // Voronoï
  voronoiVisible: boolean;
  voronoiCategory: string;
  voronoiCirfas: { id: string; nom: string; color: string }[];
  setVoronoiVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  voronoiDataForSaveRef: React.MutableRefObject<VoronoiData | null>;
  setShowSavePanel: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSaveError: (v: string | null) => void;
  // Bataille
  battleVisible: boolean;
  battleCategory: string;
  battleCirfas: { id: string; nom: string; color: string }[];
  setBattleVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  // Carreaux
  carreauxVisible: boolean;
  carreauxLoaded: boolean;
  carreauxLabel: string;
  setCarreauxVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  // Test ORS
  testIsoVisible: boolean;
  testIsoLoading: boolean;
  testIsoDebug: string;
  runTestIsochrone: (region?: string, category?: string, minutes?: number, mode?: string) => void;
}

export function MapPanel({
  mapContainerRef, zoneData, activeCats,
  isochroneVisible, isochroneMinutes, isochroneMode, isochroneFromCache, isochroneCachedAt,
  setIsochroneVisible, recalculerIsochrone, isLoading,
  voronoiVisible, voronoiCategory, voronoiCirfas, setVoronoiVisible,
  voronoiDataForSaveRef, setShowSavePanel, setSaveError,
  battleVisible, battleCategory, battleCirfas, setBattleVisible,
  carreauxVisible, carreauxLoaded, carreauxLabel, setCarreauxVisible,
  testIsoVisible, testIsoLoading, testIsoDebug, runTestIsochrone,
}: MapPanelProps) {
  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', background: '#e8e8e8', position: 'relative' }} />

      {/* Badge zone active */}
      {zoneData && (
        <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', zIndex: 10 }}>
          <div style={{ color: '#4f46e5', fontWeight: 700, marginBottom: 2 }}>📍 {zoneData.ville}</div>
          <div style={{ color: '#64748b' }}>
            {zoneData.rayon_metres ? `rayon ${(zoneData.rayon_metres / 1000).toFixed(1)} km · ` : ''}{zoneData.nb_pois} établissements
          </div>
        </div>
      )}

      {/* Badge isochrone actif */}
      {isochroneVisible && isochroneMinutes > 0 && (
        <div style={{
          position: 'absolute', top: 16, left: zoneData ? 130 : 16, zIndex: 10,
          background: `${(ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).fill}e6`,
          backdropFilter: 'blur(4px)',
          border: `1px solid ${(ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).line}`,
          borderRadius: 8, padding: '5px 10px', fontSize: 11, color: '#fff',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            ⏱ {isochroneMinutes}min — {ISOCHRONE_MODE_LABELS[isochroneMode] ?? isochroneMode}
            {isochroneFromCache && <span style={{ opacity: 0.75, fontSize: 10 }}>♻️ cache</span>}
            <button onClick={() => setIsochroneVisible(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1, opacity: 0.8 }}>✕</button>
          </div>
          {isochroneFromCache && isochroneCachedAt && (
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, opacity: 0.9 }}>
              <span>Calculé le {new Date(isochroneCachedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              <button
                onClick={recalculerIsochrone}
                disabled={isLoading}
                style={{ background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: 4, padding: '2px 6px', color: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}
              >Recalculer</button>
            </div>
          )}
        </div>
      )}

      {/* Badge Voronoï actif */}
      {voronoiVisible && voronoiCategory && (
        <div style={{
          position: 'absolute', top: isochroneVisible && isochroneMinutes > 0 ? 90 : 56, left: 16, zIndex: 10,
          background: 'rgba(217,119,6,0.9)', backdropFilter: 'blur(4px)',
          border: '1px solid #f59e0b', borderRadius: 8,
          padding: '5px 10px', fontSize: 11, color: '#fff',
          fontFamily: 'JetBrains Mono, monospace',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>◆ Voronoï — {voronoiCategory}</span>
          <button
            onClick={() => setVoronoiVisible(false)}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1, opacity: 0.8 }}
          >✕</button>
        </div>
      )}

      {/* Badge indicateur carreaux */}
      {carreauxVisible && carreauxLabel && (
        <div style={{
          position: 'absolute', top: 56, right: 16, zIndex: 10,
          background: 'rgba(33,113,181,0.92)', backdropFilter: 'blur(4px)',
          border: '1px solid rgba(33,113,181,0.6)', borderRadius: 8,
          padding: '5px 10px', fontSize: 11, color: '#fff',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          📊 {carreauxLabel}
        </div>
      )}

      {/* Voronoï toggle */}
      {voronoiCategory && (
        <button
          onClick={() => setVoronoiVisible(v => !v)}
          title={voronoiVisible ? 'Masquer le Voronoï' : 'Afficher le Voronoï'}
          style={{
            position: 'absolute', top: 52, right: 16, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 6,
            background: voronoiVisible ? 'rgba(217,119,6,0.9)' : 'rgba(255,255,255,0.9)',
            border: `1px solid ${voronoiVisible ? '#d97706' : 'rgba(0,0,0,0.15)'}`,
            borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            color: voronoiVisible ? '#fff' : '#64748b',
            backdropFilter: 'blur(4px)', transition: 'all 0.2s',
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 2, background: voronoiVisible ? '#fff' : '#f59e0b', border: `1.5px solid ${voronoiVisible ? '#fff' : '#d97706'}` }} />
          Voronoï
        </button>
      )}

      {/* Bataille toggle */}
      {battleCategory && (
        <button
          onClick={() => setBattleVisible(v => !v)}
          title={battleVisible ? 'Masquer la Bataille' : 'Afficher la Bataille d\'Isochrones'}
          style={{
            position: 'absolute', top: 88, right: 16, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 6,
            background: battleVisible ? 'rgba(220,38,38,0.9)' : 'rgba(255,255,255,0.9)',
            border: `1px solid ${battleVisible ? '#dc2626' : 'rgba(0,0,0,0.15)'}`,
            borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            color: battleVisible ? '#fff' : '#64748b',
            backdropFilter: 'blur(4px)', transition: 'all 0.2s',
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 2, background: battleVisible ? '#fff' : '#ef4444', border: `1.5px solid ${battleVisible ? '#fff' : '#dc2626'}` }} />
          Bataille
        </button>
      )}

      {/* Carreaux toggle */}
      <button
        onClick={() => setCarreauxVisible(v => !v)}
        title={carreauxVisible ? 'Masquer les carreaux' : 'Afficher les carreaux démographiques'}
        style={{
          position: 'absolute', top: 16, right: 16, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 6,
          background: carreauxVisible ? 'rgba(33,113,181,0.9)' : 'rgba(255,255,255,0.9)',
          border: `1px solid ${carreauxVisible ? '#2171b5' : 'rgba(0,0,0,0.15)'}`,
          borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
          fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          color: carreauxVisible ? '#fff' : '#64748b',
          backdropFilter: 'blur(4px)', transition: 'all 0.2s',
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 2, background: carreauxVisible ? '#fff' : '#6baed6', border: `1.5px solid ${carreauxVisible ? '#fff' : '#2171b5'}`, opacity: carreauxVisible ? 0.8 : 0.6 }} />
        Carreaux {carreauxLoaded ? '✓' : ''}
      </button>

      {/* Légende catégories */}
      {activeCats.length > 0 && (
        <div style={{ position: 'absolute', bottom: 48, left: 16, background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, padding: '8px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#64748b', zIndex: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {activeCats.map((cat) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: zoneData!.couleur_overrides?.[cat] ?? getCatColor(cat), border: '2px solid rgba(255,255,255,0.9)', flexShrink: 0 }} />
              <span>{cat} ({zoneData!.categories[cat]})</span>
            </div>
          ))}
          {zoneData!.rayon_metres && (
            <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(99,102,241,0.25)', borderRadius: 2, border: '1.5px dashed #6366f1', flexShrink: 0 }} />
              Zone {(zoneData!.rayon_metres / 1000).toFixed(1)} km
            </div>
          )}
          {zoneData!.rayon_poi_metres && (
            <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(16,185,129,0.15)', borderRadius: '50%', border: '1.5px solid #10b981', flexShrink: 0 }} />
              Rayon {zoneData!.rayon_poi_metres >= 1000 ? `${(zoneData!.rayon_poi_metres/1000).toFixed(1)} km` : `${zoneData!.rayon_poi_metres} m`} / POI
            </div>
          )}
          {isochroneVisible && isochroneMinutes > 0 && (
            <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: `${(ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).fill}40`, borderRadius: 2, border: `1.5px solid ${(ISOCHRONE_COLORS[isochroneMode] ?? ISOCHRONE_COLORS.walk).line}`, flexShrink: 0 }} />
              Isochrone {isochroneMinutes}min ({ISOCHRONE_MODE_LABELS[isochroneMode] ?? isochroneMode})
            </div>
          )}
          {voronoiVisible && voronoiCategory && (() => {
            const regionLabel = voronoiDataForSaveRef.current?._meta?.filtre_region
              ?? voronoiDataForSaveRef.current?._meta?.filtre_ville
              ?? voronoiDataForSaveRef.current?._meta?.filtre_dept
              ?? null;
            return (
              <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, background: (voronoiCirfas[0]?.color ?? '#d97706') + '55', borderRadius: 2, border: `1.5px solid ${voronoiCirfas[0]?.color ?? '#d97706'}`, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 10 }}>
                      Voronoï — {voronoiCategory}{regionLabel ? ` · ${regionLabel}` : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => { setShowSavePanel(true); setSaveError(null); }}
                    title="Sauvegarder ce Voronoï"
                    style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 5, padding: '2px 6px', fontSize: 10, color: '#7c3aed', cursor: 'pointer', fontWeight: 600, lineHeight: 1.4, flexShrink: 0 }}
                  >💾 Sauver</button>
                </div>
                {voronoiCirfas.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, background: c.color + '55', borderRadius: 2, border: `1.5px solid ${c.color}`, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: '#1e293b', fontWeight: 500 }}>{c.nom}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          {battleVisible && battleCategory && (
            <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#ef444455', borderRadius: 2, border: '1.5px solid #dc2626', flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 10 }}>Bataille — {battleCategory}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                {[10, 30, 60, 90, 120, 150].map(p => (
                  <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                    <span style={{ display: 'inline-block', width: 14, height: 8, background: `rgba(239,68,68,${BATTLE_PALIER_OPACITY[p]})`, borderRadius: 2, border: '1px solid rgba(0,0,0,0.2)' }} />
                    <span style={{ fontSize: 8, color: '#94a3b8' }}>{p}m</span>
                  </div>
                ))}
              </div>
              {battleCirfas.slice(0, 8).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: c.color + '55', borderRadius: 2, border: `1.5px solid ${c.color}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: '#1e293b', fontWeight: 500 }}>{c.nom}</span>
                </div>
              ))}
              {battleCirfas.length > 8 && (
                <span style={{ fontSize: 9, color: '#94a3b8' }}>+{battleCirfas.length - 8} autres…</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bouton Test ORS */}
      <div style={{ position: 'absolute', bottom: 90, right: 16, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 290 }}>
        <button
          onClick={() => runTestIsochrone('Bretagne', 'cirfa', 10, 'drive')}
          disabled={testIsoLoading}
          style={{
            background: testIsoVisible ? '#2563eb' : 'rgba(255,255,255,0.95)',
            border: '2px solid #2563eb',
            borderRadius: 8, padding: '8px 14px',
            cursor: testIsoLoading ? 'wait' : 'pointer',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            color: testIsoVisible ? '#fff' : '#2563eb',
            fontWeight: 600,
            boxShadow: '0 2px 8px rgba(37,99,235,0.18)',
            transition: 'all 0.2s',
          }}
        >
          {testIsoLoading ? '⏳ Appel ORS…' : testIsoVisible ? '✅ ORS 10min visible' : '🔵 Test ORS 10min Bretagne'}
        </button>
        {testIsoDebug && (
          <div style={{ background: 'rgba(0,0,0,0.78)', color: '#e2e8f0', padding: '5px 9px', borderRadius: 6, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.45, wordBreak: 'break-word' }}>
            {testIsoDebug}
          </div>
        )}
      </div>

      {/* Légende par défaut */}
      {activeCats.length === 0 && (
        <div style={{ position: 'absolute', bottom: 48, left: 16, background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, padding: '7px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#64748b', zIndex: 10 }}>
          <div style={{ color: '#94a3b8', fontSize: 10 }}>Décrivez une zone pour commencer</div>
        </div>
      )}
    </div>
  );
}
