'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';

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

interface MapIntegratedProps {
  panneaux: Panneau[];
  onBackToPrompt?: () => void;
}

// Dynamic import with SSR disabled (MapLibre requires DOM)
const MapIntegratedClient = dynamic(
  () => import('./MapIntegratedClient'),
  {
    ssr: false,
    loading: () => <MapLoadingPlaceholder />,
  }
);

function MapLoadingPlaceholder() {
  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0a0a',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '4px solid #334155',
            borderTopColor: '#3b82f6',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 12px',
          }}
        />
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>
          Chargement de la carte...
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

export default function MapIntegrated({
  panneaux,
  onBackToPrompt,
}: MapIntegratedProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <MapLoadingPlaceholder />;
  }

  return (
    <MapIntegratedClient
      panneaux={panneaux}
      onBackToPrompt={onBackToPrompt}
    />
  );
}
