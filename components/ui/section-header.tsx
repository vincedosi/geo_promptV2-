'use client'

import { ChevronDown } from 'lucide-react'

interface SectionHeaderProps {
  label: string
  open?: boolean
  onToggle?: () => void
  count?: number
  onReset?: () => void
  sticky?: boolean
}

export function SectionHeader({
  label,
  open,
  onToggle,
  count,
  onReset,
  sticky = false,
}: SectionHeaderProps) {
  const isCollapsible = onToggle !== undefined

  return (
    <div
      onClick={isCollapsible ? onToggle : undefined}
      style={{
        background: 'var(--bg-level-2)',
        borderTop: '1px solid var(--border-subtle)',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: isCollapsible ? 'pointer' : 'default',
        userSelect: 'none',
        ...(sticky ? { position: 'sticky' as const, top: 0, zIndex: 5 } : {}),
      }}
    >
      {/* Teal dot */}
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: 'var(--brand-teal)', flexShrink: 0,
      }} />

      {/* Label */}
      <span style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        fontWeight: 500, fontSize: 12, color: 'var(--text-primary)',
        flex: 1,
      }}>
        {label}
      </span>

      {/* Active count badge */}
      {count !== undefined && count > 0 && (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10, color: 'var(--brand-teal)',
          background: 'var(--brand-teal-10)',
          border: '0.5px solid rgba(78,205,196,0.2)',
          borderRadius: 4,
          padding: '1px 6px',
          lineHeight: 1.4,
        }}>
          {count}
        </span>
      )}

      {/* Reset button */}
      {onReset && count !== undefined && count > 0 && (
        <button
          onClick={e => {
            e.stopPropagation()
            onReset()
          }}
          style={{
            background: 'none', border: 'none',
            fontSize: 10, color: 'var(--text-tertiary)',
            cursor: 'pointer', padding: '0 4px',
            fontFamily: "'Inter', system-ui, sans-serif",
            transition: 'color 150ms var(--ease-hover)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
        >
          Reset
        </button>
      )}

      {/* Chevron */}
      {isCollapsible && (
        <ChevronDown
          size={14}
          style={{
            color: 'var(--text-tertiary)',
            transition: 'transform 200ms var(--ease-out)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            flexShrink: 0,
          }}
        />
      )}
    </div>
  )
}
