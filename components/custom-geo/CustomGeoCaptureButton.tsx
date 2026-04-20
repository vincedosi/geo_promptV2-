'use client';

/**
 * GEOMATIK — Bouton flottant de capture custom-geo.
 *
 * Visible sur toutes les pages /map/*. Disabled si aucun layer contributif actif.
 * Affiche un badge avec le compteur de layers enabled.
 */
import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { useCustomGeoCaptureContext } from '@/lib/custom-geo/CustomGeoCaptureContext';
import { CustomGeoCaptureModal } from './CustomGeoCaptureModal';

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
          bottom: 24,
          right: 24,
          zIndex: 1000,
          width: 48,
          height: 48,
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
        <MapPin size={20} />
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
