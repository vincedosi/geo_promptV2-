'use client';

import { useEffect, useRef, useState } from 'react';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const SPEEDS = [1, 2, 5, 10] as const;

interface Props {
  dates: string[]; // ISO YYYY-MM-DD, ordered
  currentIndex: number;
  driftDates?: string[];
  onIndexChange: (i: number) => void;
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function PlayControls({ dates, currentIndex, driftDates = [], onIndexChange }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!isPlaying || dates.length === 0) return;
    intervalRef.current = setInterval(() => {
      onIndexChange(Math.min(currentIndex + 1, dates.length - 1));
    }, 1000 / speed);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed, currentIndex, dates.length, onIndexChange]);

  useEffect(() => {
    if (currentIndex >= dates.length - 1 && isPlaying) setIsPlaying(false);
  }, [currentIndex, dates.length, isPlaying]);

  const currentDate = dates[currentIndex] ?? '';
  const driftSet = new Set(driftDates);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.08)',
        borderRadius: 8, margin: '0 12px 8px', flexWrap: 'wrap',
      }}
    >
      <button
        onClick={() => {
          if (currentIndex >= dates.length - 1) {
            onIndexChange(0);
            setIsPlaying(true);
          } else {
            setIsPlaying(p => !p);
          }
        }}
        disabled={dates.length === 0}
        style={{
          width: 32, height: 32, borderRadius: 16,
          background: 'var(--brand-teal, #4ecdc4)', color: '#050505',
          border: 'none', cursor: dates.length === 0 ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 600, fontFamily: fInter,
        }}
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>

      <button
        onClick={() => onIndexChange(0)}
        disabled={dates.length === 0}
        style={{
          padding: '6px 10px', fontSize: 11, fontFamily: fInter,
          background: 'transparent', color: 'var(--text-secondary, #a0a0a0)',
          border: '0.5px solid var(--border-default, #262626)', borderRadius: 6,
          cursor: dates.length === 0 ? 'not-allowed' : 'pointer',
        }}
      >
        Reset
      </button>

      <div style={{ flex: 1, position: 'relative' }}>
        <input
          type="range"
          min={0}
          max={Math.max(0, dates.length - 1)}
          step={1}
          value={currentIndex}
          onChange={e => onIndexChange(Number(e.target.value))}
          style={{
            width: '100%', accentColor: '#4ecdc4',
          }}
        />
        {/* Drift markers */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 0, pointerEvents: 'none' }}>
          {dates.map((d, i) => {
            if (!driftSet.has(d)) return null;
            const left = `${(i / Math.max(dates.length - 1, 1)) * 100}%`;
            return (
              <div
                key={`drift-${d}`}
                style={{
                  position: 'absolute', left, top: -4, transform: 'translateX(-50%)',
                  width: 2, height: 12, background: '#ff5757', borderRadius: 1,
                }}
                title={`Drift event · ${d}`}
              />
            );
          })}
        </div>
      </div>

      <div style={{ minWidth: 110, fontSize: 12, fontFamily: fMono, color: 'var(--text-primary, #f0f0f0)', textAlign: 'right' }}>
        {fmtDate(currentDate)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {SPEEDS.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            style={{
              padding: '4px 8px', fontSize: 10, fontFamily: fMono,
              background: speed === s ? 'var(--bg-level-2, #181818)' : 'transparent',
              color: speed === s ? 'var(--brand-teal, #4ecdc4)' : 'var(--text-tertiary, #666)',
              border: `0.5px solid ${speed === s ? 'var(--brand-teal, #4ecdc4)' : 'var(--border-default, #262626)'}`,
              borderRadius: 4, cursor: 'pointer',
            }}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
