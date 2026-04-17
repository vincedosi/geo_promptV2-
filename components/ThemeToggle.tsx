'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme/ThemeProvider'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const next: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={mounted ? `Passer en ${next === 'dark' ? 'mode sombre' : 'mode clair'}` : undefined}
      aria-label={mounted ? `Basculer le thème (actuel : ${theme})` : 'Basculer le thème'}
      suppressHydrationWarning
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
        transition: 'all 0.15s ease',
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
      <span suppressHydrationWarning style={{ display: 'inline-flex', width: 15, height: 15 }}>
        {mounted ? (
          theme === 'dark' ? <Sun size={15} strokeWidth={1.5} /> : <Moon size={15} strokeWidth={1.5} />
        ) : null}
      </span>
    </button>
  )
}
