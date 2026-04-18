'use client';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface MapLegendProps {
  title: string;
  stops: string[];
  minLabel: string;
  midLabel?: string;
  maxLabel: string;
}

export function MapLegend({ title, stops, minLabel, midLabel, maxLabel }: MapLegendProps) {
  return (
    <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', borderTop: '0.5px solid #1a1a1a' }}>
      <div style={{ fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>{title}</div>
      <div style={{ height: 8, borderRadius: 3, background: `linear-gradient(to right, ${stops.join(', ')})` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontFamily: fMono, fontSize: 8, color: 'var(--text-tertiary)' }}>{minLabel}</span>
        {midLabel && <span style={{ fontFamily: fMono, fontSize: 8, color: 'var(--text-tertiary)' }}>{midLabel}</span>}
        <span style={{ fontFamily: fMono, fontSize: 8, color: 'var(--text-tertiary)' }}>{maxLabel}</span>
      </div>
    </div>
  );
}
