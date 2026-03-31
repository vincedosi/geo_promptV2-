'use client'

import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from 'react'
import { X, Check, AlertTriangle, Info } from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ToastVariant = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: number
  title: string
  message?: string
  variant: ToastVariant
  createdAt: number
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
  success: { color: '#3dffa0', Icon: Check },
  error:   { color: '#ff5757', Icon: X },
  warning: { color: '#f7b731', Icon: AlertTriangle },
  info:    { color: '#4ecdc4', Icon: Info },
}

const DURATION = 4000
const MAX_VISIBLE = 3

// ─── Single toast card ─────────────────────────────────────────────────────────

function ToastCard({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  const v = VARIANTS[t.variant]
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    const start = t.createdAt
    const tick = () => {
      const elapsed = Date.now() - start
      const pct = Math.max(0, 100 - (elapsed / DURATION) * 100)
      setProgress(pct)
      if (pct > 0) requestAnimationFrame(tick)
    }
    const raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [t.createdAt])

  return (
    <div
      style={{
        pointerEvents: 'auto',
        background: '#0a0a0a',
        border: '0.5px solid #262626',
        borderLeft: `3px solid ${v.color}`,
        borderRadius: 8,
        minWidth: 280,
        maxWidth: 380,
        overflow: 'hidden',
        animation: 'toast-slide-in 0.3s ease-out',
      }}
    >
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {/* Icon */}
        <v.Icon size={16} strokeWidth={2} style={{ color: v.color, flexShrink: 0, marginTop: 1 }} />

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 500, color: '#f0f0f0',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}>
            {t.title}
          </div>
          {t.message && (
            <div style={{
              fontSize: 12, color: '#a0a0a0', marginTop: 2, lineHeight: 1.5,
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
            color: '#666666', flexShrink: 0, padding: 0,
            display: 'flex', alignItems: 'center',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#f0f0f0' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#666666' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: '#1a1a1a' }}>
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((title: string, message: string | undefined, variant: ToastVariant) => {
    const id = ++toastId
    const now = Date.now()
    setToasts(prev => [...prev.slice(-(MAX_VISIBLE - 1)), { id, title, message, variant, createdAt: now }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, DURATION)
  }, [])

  const toast: ToastAPI = {
    success: useCallback((title: string, message?: string) => push(title, message, 'success'), [push]),
    error:   useCallback((title: string, message?: string) => push(title, message, 'error'), [push]),
    warning: useCallback((title: string, message?: string) => push(title, message, 'warning'), [push]),
    info:    useCallback((title: string, message?: string) => push(title, message, 'info'), [push]),
  }

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

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

      <style>{`
        @keyframes toast-slide-in {
          from { opacity: 0; transform: translateX(100%); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  )
}
