'use client'

import { createContext, useCallback, useContext, useState, useEffect, useRef, type ReactNode } from 'react'
import { X, Check, AlertTriangle, Info } from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ToastVariant = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: number
  title: string
  message?: string
  variant: ToastVariant
  createdAt: number
  exiting?: boolean
}

interface ToastAPI {
  success: (title: string, message?: string) => void
  error:   (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  info:    (title: string, message?: string) => void
}

interface ToastContextValue {
  toast: ToastAPI
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ─── Variant config ────────────────────────────────────────────────────────────

const VARIANTS: Record<ToastVariant, { color: string; Icon: typeof Check }> = {
  success: { color: 'var(--success)', Icon: Check },
  error:   { color: 'var(--danger)', Icon: X },
  warning: { color: 'var(--warning)', Icon: AlertTriangle },
  info:    { color: 'var(--brand-teal)', Icon: Info },
}

const DURATION = 4000
const MAX_VISIBLE = 3

// ─── Single toast card ─────────────────────────────────────────────────────────

function ToastCard({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  const v = VARIANTS[t.variant]
  const [progress, setProgress] = useState(100)
  const [mounted, setMounted] = useState(false)

  // Transition-based entry (interruptible if a new toast arrives mid-anim).
  // Emil: keyframes restart from zero on interruption — CSS transitions retarget.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (t.exiting) return
    const start = t.createdAt
    const tick = () => {
      const elapsed = Date.now() - start
      const pct = Math.max(0, 100 - (elapsed / DURATION) * 100)
      setProgress(pct)
      if (pct > 0) requestAnimationFrame(tick)
    }
    const raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [t.createdAt, t.exiting])

  const visible = mounted && !t.exiting

  return (
    <div
      style={{
        pointerEvents: 'auto',
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
        borderLeft: `3px solid ${v.color}`,
        borderRadius: 8,
        minWidth: 280,
        maxWidth: 380,
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateX(0) scale(1)' : 'translateX(100%) scale(0.97)',
        transition: 'opacity 260ms cubic-bezier(0.23, 1, 0.32, 1), transform 320ms cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {/* Icon */}
        <v.Icon size={16} strokeWidth={2} style={{ color: v.color, flexShrink: 0, marginTop: 1 }} />

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}>
            {t.title}
          </div>
          {t.message && (
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}>
              {t.message}
            </div>
          )}
        </div>

        {/* Close */}
        <button
          onClick={onDismiss}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', flexShrink: 0, padding: 0,
            display: 'flex', alignItems: 'center',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: 'var(--border-subtle)' }}>
        <div style={{
          height: '100%', background: v.color, opacity: 0.4,
          width: `${progress}%`,
          transition: 'width 0.1s linear',
        }} />
      </div>
    </div>
  )
}

// ─── Provider ──────────────────────────────────────────────────────────────────

let toastId = 0
const EXIT_MS = 280

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const hardRemove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const dismiss = useCallback((id: number) => {
    // Flag exiting → CSS transition plays → actual removal after EXIT_MS
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, exiting: true } : t)))
    setTimeout(() => hardRemove(id), EXIT_MS)
  }, [hardRemove])

  const push = useCallback((title: string, message: string | undefined, variant: ToastVariant) => {
    const id = ++toastId
    const now = Date.now()
    setToasts(prev => [...prev.slice(-(MAX_VISIBLE - 1)), { id, title, message, variant, createdAt: now }])
    const tid = setTimeout(() => dismiss(id), DURATION)
    timersRef.current.set(id, tid)
  }, [dismiss])

  const toast: ToastAPI = {
    success: useCallback((title: string, message?: string) => push(title, message, 'success'), [push]),
    error:   useCallback((title: string, message?: string) => push(title, message, 'error'), [push]),
    warning: useCallback((title: string, message?: string) => push(title, message, 'warning'), [push]),
    info:    useCallback((title: string, message?: string) => push(title, message, 'info'), [push]),
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Container — fixed top-right */}
      <div
        style={{
          position: 'fixed', top: 12, right: 12, zIndex: 10000,
          display: 'flex', flexDirection: 'column', gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => (
          <ToastCard key={t.id} t={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
