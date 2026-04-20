'use client';

import { MapPin } from 'lucide-react';
import { useAdminCustomZonesStats } from '../../_hooks/useAdminCustomZonesStats';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  onClick?: () => void;
}

export function CustomZonesStatsCard({ onClick }: Props) {
  const { stats, loading } = useAdminCustomZonesStats();

  const total = stats?.total_zones ?? 0;
  const iris = stats?.total_iris ?? 0;
  const cp = stats?.total_cp ?? 0;

  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-subtle)',
        borderRadius: 2,
        padding: '14px 16px',
        cursor: onClick ? 'pointer' : 'default',
        textAlign: 'left',
        transition: 'border-color 0.2s ease',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = 'var(--brand-teal)'; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{
          width: 16, height: 16, borderRadius: 3,
          background: 'rgba(78,205,196,0.1)',
          border: '0.5px solid var(--brand-teal-30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--brand-teal)',
        }}>
          <MapPin size={10} />
        </div>
        <span style={{ fontFamily: fInter, fontSize: 9, fontWeight: 500, color: 'var(--text-secondary)' }}>
          Zones perso
        </span>
      </div>
      <div style={{
        fontFamily: fMono, fontSize: 22, fontWeight: 700,
        color: 'var(--brand-teal)', lineHeight: 1, marginBottom: 4,
      }}>
        {loading ? '…' : total.toLocaleString('fr-FR')}
      </div>
      <div style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
        {iris.toLocaleString('fr-FR')} IRIS · {cp.toLocaleString('fr-FR')} CP résolus
      </div>
    </button>
  );
}
