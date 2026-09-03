'use client'

import { useEffect, useState } from 'react'

interface SplashScreenProps {
  onComplete?: () => void
  minDuration?: number
}

export function SplashScreen({ onComplete, minDuration = 2500 }: SplashScreenProps) {
  const [phase, setPhase] = useState<'loading' | 'fading' | 'done'>('loading')

  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase('fading'), minDuration)
    const doneTimer = setTimeout(() => {
      setPhase('done')
      onComplete?.()
    }, minDuration + 500)
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer) }
  }, [minDuration, onComplete])

  if (phase === 'done') return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'var(--bg-primary)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        opacity: phase === 'fading' ? 0 : 1,
        transition: 'opacity 0.5s ease',
      }}
    >
      {/* Background hex grid — very subtle */}
      <svg
        width="400" height="400" viewBox="0 0 400 400"
        style={{ position: 'absolute', opacity: 0.03 }}
      >
        {Array.from({ length: 8 }, (_, row) =>
          Array.from({ length: 8 }, (_, col) => {
            const x = col * 50 + (row % 2 ? 25 : 0)
            const y = row * 44
            return (
              <polygon
                key={`${row}-${col}`}
                points={hexPts(x + 25, y + 22, 20)}
                fill="none" stroke="#f0f0f0" strokeWidth="0.5"
              />
            )
          })
        )}
      </svg>

      {/* Logo group */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>

        {/* Hexagon icon — draw animation */}
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
          <path
            d="M28 4L50 16V40L28 52L6 40V16L28 4Z"
            stroke="#4ecdc4" strokeWidth="1.5" fill="none"
            strokeDasharray="180" strokeDashoffset="180"
            style={{ animation: 'splash-draw 1.5s ease-out forwards' }}
          />
          <path
            d="M28 14L40 20.5V33.5L28 40L16 33.5V20.5L28 14Z"
            stroke="#4ecdc4" strokeWidth="0.8" fill="rgba(78,205,196,0.04)"
            strokeDasharray="100" strokeDashoffset="100"
            style={{ animation: 'splash-draw 1.2s ease-out 0.3s forwards' }}
          />
          <circle cx="28" cy="27" r="3" fill="#4ecdc4" opacity="0"
            style={{ animation: 'splash-dot 0.4s ease-out 1s forwards' }}
          />
        </svg>

        {/* Logotype */}
        <div style={{
          opacity: 0,
          animation: 'splash-text 0.5s ease-out 0.8s forwards',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logotype SVG : next/image n'optimise pas le SVG, et DESIGN_SYSTEM.md impose la balise img pour /magelian-icon.svg partout */}
          <img
            src="/magelian-icon.svg"
            alt="MAGELIAN"
            style={{ height: 24, width: 'auto', display: 'block' }}
          />
        </div>

        {/* Tagline */}
        <div style={{
          fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400,
          fontFamily: "'Inter', system-ui, sans-serif",
          opacity: 0,
          animation: 'splash-text 0.5s ease-out 1.1s forwards',
        }}>
          Geospatial intelligence
        </div>
      </div>

      {/* Progress bar — bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 2, background: 'var(--border-subtle)',
      }}>
        <div style={{
          height: '100%', background: 'var(--brand-teal)',
          animation: `splash-progress ${minDuration}ms ease-in-out forwards`,
        }} />
      </div>

      <style>{`
        @keyframes splash-draw {
          to { stroke-dashoffset: 0; }
        }
        @keyframes splash-dot {
          to { opacity: 0.5; }
        }
        @keyframes splash-text {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes splash-progress {
          from { width: 0%; }
          to   { width: 100%; }
        }
      `}</style>
    </div>
  )
}

function hexPts(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
  }).join(' ')
}
