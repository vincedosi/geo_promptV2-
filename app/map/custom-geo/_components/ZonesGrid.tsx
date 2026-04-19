'use client';

import type { CustomGeoZoneSummary, CustomGeoExportFormat } from '@/types/custom-geo';
import { ZoneCard } from './ZoneCard';

interface Props {
  zones: CustomGeoZoneSummary[];
  loading: boolean;
  selectedZoneId: string | null;
  onSelectZone: (id: string) => void;
  actions: {
    rename: (id: string, name: string, desc?: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
    exportZone: (id: string, format: CustomGeoExportFormat) => void;
  };
}

export function ZonesGrid({ zones, loading, selectedZoneId, onSelectZone, actions }: Props) {
  if (loading) {
    return (
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16,
      }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{
            height: 220, background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)',
            borderRadius: 8, animation: 'pulse 1.5s ease-in-out infinite',
          }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16,
    }}>
      {zones.map(z => (
        <ZoneCard
          key={z.id}
          zone={z}
          selected={selectedZoneId === z.id}
          onSelect={() => onSelectZone(z.id)}
          actions={actions}
        />
      ))}
    </div>
  );
}
