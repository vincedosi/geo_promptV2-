'use client';

interface Props {
  sourceTypes: string[];
  value: string | null;
  onChange: (value: string | null) => void;
}

export function SourceTypeFilter({ sourceTypes, value, onChange }: Props) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-subtle)',
        color: 'var(--text-primary)',
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
        padding: '6px 10px',
        borderRadius: 4,
        cursor: 'pointer',
        minWidth: 140,
      }}
    >
      <option value="">Tous les types</option>
      {sourceTypes.map(t => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );
}
