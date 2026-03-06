'use client';

import type { NetworkCoverageData } from '@/types/spatial';

interface NetworkCoverageReportProps {
  data: NetworkCoverageData;
}

const MODE_LABELS: Record<string, string> = {
  drive:   'voiture',
  walk:    'à pied',
  bike:    'vélo',
  network: 'voiture',
};

export function NetworkCoverageReport({ data }: NetworkCoverageReportProps) {
  const modeLabel = MODE_LABELS[data.mode] ?? data.mode;

  return (
    <div style={{
      margin: '8px 0',
      background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(99,102,241,0.05) 100%)',
      border: '1px solid rgba(99,102,241,0.35)',
      borderRadius: 10,
      padding: '12px 14px',
      fontSize: 12,
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>🌍</span>
        <div>
          <div style={{ color: '#a5b4fc', fontWeight: 700, fontSize: 13 }}>
            Couverture réseau{' '}
            <span style={{ color: '#818cf8' }}>{data.poi_category}</span>
            {' '}· {data.travel_time_minutes} min {modeLabel}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 1 }}>
            {data.nb_pois} points · cible{' '}
            <span style={{ color: '#34d399', fontWeight: 600 }}>{data.target_demo_label}</span>
            {data.from_cache && (
              <span style={{ marginLeft: 6, background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 3, padding: '1px 5px', fontSize: 9, color: '#a5b4fc' }}>
                cache
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Big coverage number */}
      <div style={{
        background: 'rgba(99,102,241,0.12)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 8,
        padding: '14px 16px',
        textAlign: 'center',
        marginBottom: 8,
      }}>
        <div style={{ color: '#6366f1', fontWeight: 800, fontSize: 28, letterSpacing: '-0.02em', lineHeight: 1 }}>
          {data.coverage.toLocaleString('fr-FR')}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 }}>
          {data.target_demo_label} couverts
        </div>
      </div>

      {/* Footer params */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { label: 'Réseau', value: data.poi_category },
          { label: 'Temps', value: `${data.travel_time_minutes} min` },
          { label: 'Mode', value: modeLabel },
          { label: 'Points', value: String(data.nb_pois) },
        ].map(({ label, value }) => (
          <span key={label} style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 4,
            padding: '2px 6px',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 10,
          }}>
            {label}: <span style={{ color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace' }}>{value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
