'use client';

/**
 * MAGELIAN — Page de démo Custom Geo Capture (hors prod, test interne).
 *
 * Prouve que le système de capture est 100% générique en simulant 3 modules
 * fictifs qui contribuent chacun une géométrie mockée. AUCUNE référence à radio,
 * météo, IRIS ou autre module réel. Si ça marche ici, ça marchera partout.
 *
 * IMPORTANT : le Provider n'est monté que dans app/map/layout.tsx, donc cette
 * page wrap manuellement son propre provider pour être self-contained.
 */
import { useState } from 'react';
import { CustomGeoCaptureProvider } from '@/lib/custom-geo/CustomGeoCaptureContext';
import { CustomGeoCaptureButton } from '@/components/custom-geo/CustomGeoCaptureButton';
import { useCustomGeoLayer } from '@/lib/custom-geo/useCustomGeoLayer';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

// Géométries mockées (3 rectangles sur 3 villes)
const LYON_POLY: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[4.75, 45.70], [4.95, 45.70], [4.95, 45.82], [4.75, 45.82], [4.75, 45.70]]],
};
const PARIS_POLY: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[2.25, 48.82], [2.42, 48.82], [2.42, 48.90], [2.25, 48.90], [2.25, 48.82]]],
};
const MARSEILLE_POLY: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[5.30, 43.25], [5.45, 43.25], [5.45, 43.35], [5.30, 43.35], [5.30, 43.25]]],
};

function MockToggleRow({
  label, subLabel, enabled, onToggle,
}: { label: string; subLabel: string; enabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderRadius: 6,
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-subtle)',
      cursor: 'pointer',
    }}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={e => onToggle(e.target.checked)}
        style={{ accentColor: 'var(--brand-teal)' }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)' }}>{label}</div>
        <div style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>{subLabel}</div>
      </div>
    </label>
  );
}

function MockModule({
  id, sourceType, label, geometry, enabled, onToggle,
}: {
  id: string; sourceType: string; label: string;
  geometry: GeoJSON.Geometry; enabled: boolean; onToggle: (v: boolean) => void;
}) {
  useCustomGeoLayer({
    id,
    sourceType,
    label,
    enabled,
    getGeometry: () => geometry,
    metadata: { mock: true, module: label },
  });
  return <MockToggleRow label={label} subLabel={`id=${id} · source_type=${sourceType}`} enabled={enabled} onToggle={onToggle} />;
}

export default function TestCustomGeoCapturePage() {
  const [lyonEnabled, setLyonEnabled] = useState(true);
  const [parisEnabled, setParisEnabled] = useState(true);
  const [marseilleEnabled, setMarseilleEnabled] = useState(true);

  return (
    <CustomGeoCaptureProvider>
      <div style={{
        minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)',
        padding: 40, fontFamily: fInter,
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Test Custom Geo Capture</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.6 }}>
            Prouve que le systeme de capture est 100% generique avec 3 modules fictifs.
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 32, lineHeight: 1.6 }}>
            Coche les modules pour activer leur contribution. Le bouton flottant bottom-right agrege
            les geometries des modules actifs et ouvre un modal de sauvegarde. Les 4 transformations
            (union, enveloppe convexe, rectangle englobant, brut) sont testables depuis le modal.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <MockModule
              id="mock-lyon"
              sourceType="mock_module_a"
              label="Lyon (module fictif A)"
              geometry={LYON_POLY}
              enabled={lyonEnabled}
              onToggle={setLyonEnabled}
            />
            <MockModule
              id="mock-paris"
              sourceType="mock_module_b"
              label="Paris (module fictif B)"
              geometry={PARIS_POLY}
              enabled={parisEnabled}
              onToggle={setParisEnabled}
            />
            <MockModule
              id="mock-marseille"
              sourceType="mock_module_c"
              label="Marseille (module fictif C)"
              geometry={MARSEILLE_POLY}
              enabled={marseilleEnabled}
              onToggle={setMarseilleEnabled}
            />
          </div>

          <div style={{
            marginTop: 32, padding: 16,
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 6,
            fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.8,
          }}>
            <div><span style={{ color: 'var(--brand-teal)' }}>checklist</span> pour valider l&apos;etape</div>
            <div>1. 3 modules actifs → badge &quot;3&quot; sur le bouton</div>
            <div>2. Cliquer bouton → modal liste les 3 layers</div>
            <div>3. Tester union / convex_hull / envelope / raw</div>
            <div>4. Sauvegarder → zone creee en base, source_type=&quot;composite&quot;</div>
            <div>5. Decocher 2 modules → badge &quot;1&quot; → source_type = sourceType du layer restant</div>
            <div>6. Decocher tout → bouton disabled + tooltip</div>
          </div>
        </div>

        <CustomGeoCaptureButton />
      </div>
    </CustomGeoCaptureProvider>
  );
}
