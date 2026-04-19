'use client';

const fMono = "'JetBrains Mono', monospace";

interface Props {
  zoneId: string;
}

export function ZoneFullMap({ zoneId }: Props) {
  // Placeholder — will integrate MapLibre with geometry fetch + teal fill/line layers
  return (
    <div style={{
      width: '100%', height: '100%', minHeight: 200,
      background: 'var(--bg-level-2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fMono,
    }}>
      Carte interactive — {zoneId.slice(0, 8)}
    </div>
  );
}
