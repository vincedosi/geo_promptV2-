'use client';

/**
 * GEOMATIK — Bouton flottant de capture custom-geo.
 *
 * Visible sur toutes les pages /map/*. Disabled si aucun layer contributif actif.
 * Affiche un badge avec le compteur de layers enabled.
 */
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Save } from 'lucide-react';
import { useCustomGeoCaptureContext } from '@/lib/custom-geo/CustomGeoCaptureContext';

const CustomGeoCaptureModal = dynamic(
  () => import('./CustomGeoCaptureModal').then((m) => ({ default: m.CustomGeoCaptureModal })),
  { ssr: false, loading: () => null }
);

export function CustomGeoCaptureButton() {
  const { layerCount } = useCustomGeoCaptureContext();
  const [modalOpen, setModalOpen] = useState(false);
  const disabled = layerCount === 0;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setModalOpen(true)}
        title={disabled ? 'Aucune zone a capturer' : 'Sauvegarder la vue comme zone custom'}
        style={{
          position: 'fixed',
          // top: 12 + height: 28 (zoom badge) + 16 marge = 56. On met 70 pour respirer.
          top: 70,
          right: 12,
          // /map utilise un overlay zIndex 9999 ; on doit passer au-dessus.
          zIndex: 10000,
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'var(--brand-teal)',
          border: 'none',
          color: '#050505',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 150ms var(--ease-out), opacity 150ms var(--ease-out)',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.transform = 'scale(1.05)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <Save size={18} />
        {layerCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 20,
            height: 20,
            padding: '0 6px',
            borderRadius: 10,
            background: 'var(--brand-teal)',
            border: '2px solid var(--bg-primary)',
            color: '#050505',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {layerCount}
          </span>
        )}
      </button>

      {modalOpen && (
        <CustomGeoCaptureModal onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}
