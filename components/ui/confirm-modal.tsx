'use client'

import { useEffect, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string | ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  loading?: boolean
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'default',
  loading = false,
}: ConfirmModalProps) {
  // Escape key to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, loading, onClose])

  if (!open) return null

  const isDanger = variant === 'danger'

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(5,5,5,0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'confirm-overlay-in 0.15s ease-out',
      }}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border-default)',
          borderRadius: 12,
          maxWidth: 420,
          width: 'calc(100% - 32px)',
          padding: '24px',
          animation: 'confirm-card-in 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
          {isDanger && (
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'rgba(255,87,87,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <AlertTriangle size={18} strokeWidth={1.5} style={{ color: 'var(--danger)' }} />
            </div>
          )}
          <div>
            <div style={{
              fontSize: 16, fontWeight: 500, color: 'var(--text-primary)',
              fontFamily: "'Inter', system-ui, sans-serif",
              marginBottom: 6,
            }}>
              {title}
            </div>
            <div style={{
              fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}>
              {message}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'transparent',
              border: '0.5px solid var(--border-default)',
              borderRadius: 6,
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--border-hover)'
              e.currentTarget.style.background = 'var(--bg-level-2)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border-default)'
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              background: isDanger ? 'var(--danger)' : 'var(--text-primary)',
              border: 'none',
              borderRadius: 6,
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: 500,
              color: isDanger ? 'var(--text-primary)' : 'var(--bg-primary)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1,
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              if (!loading) e.currentTarget.style.opacity = '0.85'
            }}
            onMouseLeave={e => {
              if (!loading) e.currentTarget.style.opacity = '1'
            }}
          >
            {loading ? 'En cours...' : confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes confirm-overlay-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes confirm-card-in {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
