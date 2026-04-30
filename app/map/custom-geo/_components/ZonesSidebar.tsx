'use client';

import Link from 'next/link';
import { ArrowLeft, Search, X } from 'lucide-react';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Stats {
  total: number;
  total_iris: number;
  total_cp: number;
  by_source_type: Array<{ source_type: string; count: number }>;
}

interface Props {
  orgId: string;
  stats: Stats | null;
  statsLoading: boolean;
  sourceTypeFilter: string | null;
  onSourceTypeChange: (v: string | null) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
}

export function ZonesSidebar({ stats, statsLoading, sourceTypeFilter, onSourceTypeChange, searchQuery, onSearchChange }: Props) {
  const types = stats?.by_source_type ?? [];

  return (
    <div style={{
      width: 260, flexShrink: 0, borderRight: '0.5px solid var(--border-subtle)',
      background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '0.5px solid var(--border-subtle)' }}>
        {/* Retour vers la carte */}
        <Link
          href="/map"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 8px', marginLeft: -8, marginBottom: 10,
            borderRadius: 4, textDecoration: 'none',
            fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
            transition: 'color 150ms var(--ease-hover), background 150ms var(--ease-hover)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-level-2)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
        >
          <ArrowLeft size={12} />
          Retour à la carte
        </Link>

        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
          Zones personnalisees
        </div>
        {stats && !statsLoading && (
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-tertiary)' }}>
            <span><strong style={{ color: 'var(--text-primary)', fontFamily: fMono }}>{stats.total}</strong> zones</span>
            <span><strong style={{ color: 'var(--brand-teal)', fontFamily: fMono }}>{stats.total_iris.toLocaleString('fr-FR')}</strong> IRIS</span>
            <span><strong style={{ fontFamily: fMono }}>{stats.total_cp.toLocaleString('fr-FR')}</strong> CP</span>
          </div>
        )}
      </div>

      {/* Source type filter */}
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border-subtle)', flex: 1, overflow: 'auto' }}>
        <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Type de source
        </div>
        <button
          onClick={() => onSourceTypeChange(null)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 4,
            background: sourceTypeFilter === null ? 'rgba(78,205,196,0.08)' : 'transparent',
            border: 'none', cursor: 'pointer', fontFamily: fInter, fontSize: 12,
            color: sourceTypeFilter === null ? 'var(--brand-teal)' : 'var(--text-secondary)',
            transition: 'background 0.1s',
          }}
        >
          Tous ({stats?.total ?? 0})
        </button>
        {types.map(t => (
          <button
            key={t.source_type}
            onClick={() => onSourceTypeChange(t.source_type)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 4,
              background: sourceTypeFilter === t.source_type ? 'rgba(78,205,196,0.08)' : 'transparent',
              border: 'none', cursor: 'pointer', fontSize: 11,
              fontFamily: fMono, color: sourceTypeFilter === t.source_type ? 'var(--brand-teal)' : 'var(--text-tertiary)',
              transition: 'background 0.1s',
            }}
          >
            {t.source_type} ({t.count})
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Rechercher..."
            style={{
              width: '100%', padding: '7px 30px 7px 32px', borderRadius: 6,
              background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
              color: 'var(--text-primary)', fontFamily: fInter, fontSize: 12, outline: 'none',
            }}
          />
          {searchQuery && (
            <button onClick={() => onSearchChange('')} style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex',
            }}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
