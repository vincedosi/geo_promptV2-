'use client';

const fMono = "'JetBrains Mono', monospace";

interface Props {
  zoneId: string;
  bbox: [number, number, number, number] | null;
}

export function ZoneMapPreview({ bbox }: Props) {
  // Placeholder — full MapLibre preview will be added after validation
  // (max 12-15 simultaneous instances, needs virtualisation)
  return (
    <div style={{
      width: '100%', height: 140,
      background: 'var(--bg-level-2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, color: 'var(--text-tertiary)', fontFamily: fMono,
      letterSpacing: '0.04em',
    }}>
      {bbox
        ? `${bbox[0].toFixed(2)}, ${bbox[1].toFixed(2)} → ${bbox[2].toFixed(2)}, ${bbox[3].toFixed(2)}`
        : 'Pas de bbox'
      }
    </div>
  );
}
