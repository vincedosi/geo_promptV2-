'use client'

import { Search, X } from 'lucide-react'

interface SearchFilterProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchFilter({
  value,
  onChange,
  placeholder = 'Rechercher...',
}: SearchFilterProps) {
  return (
    <div style={{ position: 'relative' }}>
      <Search
        size={14}
        style={{
          position: 'absolute', left: 10, top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-tertiary)', pointerEvents: 'none',
        }}
      />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          background: 'var(--bg-level-2)',
          border: '0.5px solid var(--border-subtle)',
          borderRadius: 6,
          padding: '7px 30px 7px 32px',
          fontSize: 12,
          color: 'var(--text-primary)',
          fontFamily: "'Inter', system-ui, sans-serif",
          outline: 'none',
          transition: 'border-color 0.15s ease',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{
            position: 'absolute', right: 6, top: '50%',
            transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', padding: 2,
            display: 'flex', alignItems: 'center',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
