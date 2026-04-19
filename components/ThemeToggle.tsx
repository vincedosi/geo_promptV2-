'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme/ThemeProvider'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  // Brief transition flag — triggers the crossfade + blur mask on the icon swap.
  // Emil: blur bridges the visual gap during a crossfade, tricking the eye into
  // perceiving a single smooth transformation instead of two icons swapping.
  const [swapping, setSwapping] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleClick = () => {
    setSwapping(true)
    toggleTheme()
    setTimeout(() => setSwapping(false), 240)
  }

  const next: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={handleClick}
      title={mounted ? `Passer en ${next === 'dark' ? 'mode sombre' : 'mode clair'}` : undefined}
      aria-label={mounted ? `Basculer le thème (actuel : ${theme})` : 'Basculer le thème'}
      suppressHydrationWarning
      onPointerDown={e => { e.currentTarget.style.transform = 'scale(0.92)' }}
      onPointerUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
      onPointerLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        padding: 0,
        borderRadius: 6,
        background: 'transparent',
        border: '0.5px solid transparent',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        transition:
          'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), transform 160ms var(--ease-out)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-level-2)'
        e.currentTarget.style.borderColor = 'var(--border-default)'
        e.currentTarget.style.color = 'var(--text-primary)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.borderColor = 'transparent'
        e.currentTarget.style.color = 'var(--text-secondary)'
      }}
    >
      <span
        suppressHydrationWarning
        style={{
          display: 'inline-flex',
          width: 15,
          height: 15,
          filter: swapping ? 'blur(2px)' : 'blur(0px)',
          opacity: swapping ? 0.55 : 1,
          transform: swapping ? 'rotate(-18deg) scale(0.9)' : 'rotate(0deg) scale(1)',
          transition:
            'filter 220ms cubic-bezier(0.23, 1, 0.32, 1), opacity 220ms cubic-bezier(0.23, 1, 0.32, 1), transform 240ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        {mounted ? (
          theme === 'dark' ? <Sun size={15} strokeWidth={1.5} /> : <Moon size={15} strokeWidth={1.5} />
        ) : null}
      </span>
    </button>
  )
}
