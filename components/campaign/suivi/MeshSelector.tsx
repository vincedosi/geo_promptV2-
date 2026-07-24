'use client';
/**
 * MeshSelector — le sélecteur signature « Grain » de la carte de dérive.
 * Piste segmentée National → Région → Département → CP ; curseur teal glissant.
 * Flat + teal (design system), sentence case, aucune couleur en dur.
 */
import { MESH_ORDER, meshLabel, type DeriveMesh } from '@/lib/campaigns/derive-metrics';

const fInter = "'Inter', system-ui, sans-serif";

export function MeshSelector({ mesh, onChange }: { mesh: DeriveMesh; onChange: (m: DeriveMesh) => void }) {
  const idx = MESH_ORDER.indexOf(mesh);
  return (
    <div style={{
      display: 'flex', position: 'relative', background: 'var(--bg-level-2)',
      border: '0.5px solid var(--border-subtle)', borderRadius: 10, padding: 4, gap: 2, width: '100%',
    }}>
      <div aria-hidden style={{
        position: 'absolute', top: 4, bottom: 4, left: 4, width: `calc(${100 / MESH_ORDER.length}% - 4px)`,
        background: 'var(--brand-teal)', borderRadius: 7, zIndex: 1,
        transform: `translateX(${idx * 100}%)`, transition: 'transform 0.38s cubic-bezier(0.34,1.35,0.5,1)',
      }} />
      {MESH_ORDER.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          style={{
            flex: 1, position: 'relative', zIndex: 2, background: 'transparent', border: 'none',
            padding: '9px 4px', borderRadius: 7, cursor: 'pointer', fontFamily: fInter, fontSize: 12.5,
            fontWeight: m === mesh ? 600 : 400,
            color: m === mesh ? 'var(--bg-primary)' : 'var(--text-tertiary)', transition: 'color 0.25s',
          }}
        >
          {meshLabel(m)}
        </button>
      ))}
    </div>
  );
}
