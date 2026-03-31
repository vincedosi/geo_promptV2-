'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ToastVariant = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ─── Variant styles ────────────────────────────────────────────────────────────

const VARIANT_STYLES: Record<ToastVariant, { borderColor: string; color: string }> = {
  success: { borderColor: '#3dffa0', color: '#3dffa0' },
  error:   { borderColor: '#ff5757', color: '#ff5757' },
  warning: { borderColor: '#f7b731', color: '#f7b731' },
  info:    { borderColor: '#4ecdc4', color: '#4ecdc4' },
}

// ─── Provider ──────────────────────────────────────────────────────────────────

let toastId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, variant }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast container — fixed top-right */}
      <div
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => {
          const vs = VARIANT_STYLES[t.variant]
          return (
            <div
              key={t.id}
              style={{
                pointerEvents: 'auto',
                background: '#0a0a0a',
                border: '0.5px solid #1a1a1a',
                borderLeft: `3px solid ${vs.borderColor}`,
                borderRadius: 6,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minWidth: 260,
                maxWidth: 380,
                animation: 'slideUp 0.2s ease-out',
              }}
            >
              <span
                style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: vs.borderColor, flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1, fontSize: 13, color: '#f0f0f0',
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}
              >
                {t.message}
              </span>
              <button
                onClick={() => dismiss(t.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#666666', flexShrink: 0, padding: 0,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
