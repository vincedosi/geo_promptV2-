'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

interface Panneau {
  id: string;
  lat?: number;
  latitude?: number;
  lng?: number;
  longitude?: number;
  nom?: string;
  ville?: string;
  region?: string;
  format?: string;
  regie?: string;
  [key: string]: any;
}

// Charger MapLibre dynamiquement pour éviter les erreurs SSR
const MapLibreComponent = dynamic(
  () => import('./MaplibreMapClient'),
  { ssr: false, loading: () => <MapLoadingPlaceholder /> }
);

function MapLoadingPlaceholder() {
  return (
    <div
      style={{
        width: '100%',
        height: '500px',
        borderRadius: '8px',
        border: '1px solid #475569',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
      }}
    >
      <div style={{ textAlign: 'center', color: '#cbd5e1' }}>
        <p style={{ marginBottom: '8px', fontSize: '14px' }}>
          Chargement de la carte...
        </p>
        <p style={{ fontSize: '12px', color: '#94a3b8' }}>
          Assurez-vous que maplibre-gl est installé
        </p>
      </div>
    </div>
  );
}

export default function MaplibreMap({ panneaux }: { panneaux: Panneau[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <MapLoadingPlaceholder />;
  }

  return <MapLibreComponent panneaux={panneaux} />;
}
