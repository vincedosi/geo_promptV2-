'use client';

/**
 * @file app/map/_components/panneaux/PanneauZones.tsx — panneau « Zones »
 * (Tâche 7, 2026-09-12).
 *
 * Contenu de l'entrée « Zones » du rail (lib/navigation/config.ts) : « Ce que
 * je fabrique ». Deux sections :
 *
 *   - « Créer une zone » : la capture des couches actives (`CustomGeoCaptureModal`,
 *     jusqu'à 11 sources contributives via `useCustomGeoCaptureContext`) —
 *     reprise VERBATIM de l'entrée « Capturer zone custom » de
 *     `SettingsOverlay.tsx` (avant cette tâche), qui la perd. Dessin libre,
 *     rayon comme outil de zone et import de codes postaux **n'existent pas**
 *     dans le code — décision du contrôleur : ne pas poser de bouton mort,
 *     ils arrivent aux Tâches 16-18 (Phase 2).
 *   - « Mes zones » : `ZonesOverlay` (components/map/overlays/ZonesOverlay.tsx)
 *     déplacée TELLE QUELLE (fichier non relocalisé physiquement, seulement
 *     réimporté ici — même convention que `PanneauCalques`/`PanneauAnalyse`
 *     pour les sections reprises de `filter-panel/`). Composition en clair et
 *     opérations booléennes (Fusionner/Intersection/Soustraire) : Phase 2
 *     (Tâche 14), non implémentées ici.
 */
import { useState } from 'react';
import { Save as SaveIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { useCustomGeoCaptureContext } from '@/lib/custom-geo/CustomGeoCaptureContext';
import { retryImport } from '@/lib/dynamic-with-retry';
import { ZonesOverlay } from '@/components/map/overlays/ZonesOverlay';

const CustomGeoCaptureModal = dynamic(
  retryImport(() => import('@/components/custom-geo/CustomGeoCaptureModal').then((m) => ({ default: m.CustomGeoCaptureModal }))),
  { ssr: false, loading: () => null }
);

export interface PanneauZonesProps {
  mapRef: React.MutableRefObject<MaplibreMap | null>;
  /** Notifie le parent des zones actuellement affichées sur la carte (plan média). */
  onLoadedZonesChange?: (zones: Array<{ id: string; name: string }>) => void;
}

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  letterSpacing: '0.04em',
  marginBottom: 8,
  marginTop: 0,
};

export function PanneauZones({ mapRef, onLoadedZonesChange }: PanneauZonesProps) {
  const { layerCount } = useCustomGeoCaptureContext();
  const [customGeoModalOpen, setCustomGeoModalOpen] = useState(false);
  const customGeoDisabled = layerCount === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

      {/* ── Créer une zone ─────────────────────────────────────────────── */}
      <section style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border-subtle)' }}>
        <h4 style={sectionTitleStyle}>Créer une zone</h4>
        <button
          type="button"
          onClick={() => setCustomGeoModalOpen(true)}
          disabled={customGeoDisabled}
          title={customGeoDisabled ? 'Aucune zone à capturer (active au moins un layer terrain)' : 'Capturer la vue comme zone custom'}
          style={{
            width: '100%',
            background: 'transparent',
            border: `0.5px solid ${customGeoDisabled ? 'var(--border-default)' : 'var(--brand-teal)'}`,
            color: customGeoDisabled ? 'var(--text-tertiary)' : 'var(--brand-teal)',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 500,
            cursor: customGeoDisabled ? 'not-allowed' : 'pointer',
            opacity: customGeoDisabled ? 0.5 : 1,
            fontFamily: "'Inter', system-ui, sans-serif",
            transition: 'background-color 150ms var(--ease-hover)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
          onMouseEnter={e => { if (!customGeoDisabled) e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <SaveIcon size={14} strokeWidth={1.5} />
          Capturer zone custom
          {layerCount > 0 && (
            <span style={{
              marginLeft: 'auto',
              minWidth: 18, height: 18, padding: '0 5px',
              borderRadius: 9, background: 'var(--brand-teal)',
              color: '#050505', fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{layerCount}</span>
          )}
        </button>
      </section>
      {customGeoModalOpen && <CustomGeoCaptureModal onClose={() => setCustomGeoModalOpen(false)} />}

      {/* ── Mes zones ──────────────────────────────────────────────────── */}
      <section style={{ padding: '12px 0 0' }}>
        <h4 style={{ ...sectionTitleStyle, padding: '0 16px' }}>Mes zones</h4>
        <ZonesOverlay mapRef={mapRef} onLoadedZonesChange={onLoadedZonesChange} />
      </section>

    </div>
  );
}
