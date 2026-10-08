'use client'

import { useEffect, useState } from 'react'
import { LogoDentsu } from '@/components/ui/LogoDentsu'

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
      {/* Logo group */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {/* Logotype */}
        <div style={{
          opacity: 0,
          animation: 'splash-text 0.5s ease-out 0.2s forwards',
        }}>
          <LogoDentsu hauteur={32} />
        </div>

        {/* Tagline */}
        <div style={{
          fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400,
          fontFamily: "'Inter', system-ui, sans-serif",
          opacity: 0,
          animation: 'splash-text 0.5s ease-out 0.5s forwards',
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
