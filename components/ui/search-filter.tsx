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
          color: '#666666', pointerEvents: 'none',
        }}
      />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          background: '#111111',
          border: '0.5px solid #1a1a1a',
          borderRadius: 6,
          padding: '7px 30px 7px 32px',
          fontSize: 12,
          color: '#f0f0f0',
          fontFamily: "'Inter', system-ui, sans-serif",
          outline: 'none',
          transition: 'border-color 0.15s ease',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)' }}
        onBlur={e => { e.currentTarget.style.borderColor = '#1a1a1a' }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{
            position: 'absolute', right: 6, top: '50%',
            transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#666666', padding: 2,
            display: 'flex', alignItems: 'center',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#a0a0a0' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#666666' }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
