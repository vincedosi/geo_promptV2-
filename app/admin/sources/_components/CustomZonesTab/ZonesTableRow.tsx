'use client';

import { Trash2 } from 'lucide-react';
import type { AdminCustomZone } from '../../_hooks/useAdminCustomZones';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  zone: AdminCustomZone;
  onDelete: (zone: AdminCustomZone) => void;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ZonesTableRow({ zone, onDelete }: Props) {
  return (
    <tr style={{ borderBottom: '0.5px solid var(--border-subtle)' }}>
      <td style={{ padding: '10px 12px', fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)' }}>
        <div>{zone.name}</div>
        {zone.description && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{zone.description}</div>
        )}
      </td>
      <td style={{ padding: '10px 12px', fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)' }}>
        {zone.org_name ?? <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
      </td>
      <td style={{ padding: '10px 12px', fontFamily: fMono, fontSize: 10, color: 'var(--text-secondary)' }}>
        {zone.source_type}
      </td>
      <td style={{ padding: '10px 12px', fontFamily: fMono, fontSize: 11, color: 'var(--text-primary)', textAlign: 'right' }}>
        {zone.feature_count_iris.toLocaleString('fr-FR')}
      </td>
      <td style={{ padding: '10px 12px', fontFamily: fMono, fontSize: 11, color: 'var(--text-primary)', textAlign: 'right' }}>
        {zone.feature_count_cp.toLocaleString('fr-FR')}
      </td>
      <td style={{ padding: '10px 12px', fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
        {fmtDate(zone.created_at)}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
        <button
          onClick={() => onDelete(zone)}
          title="Supprimer la zone"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            display: 'inline-flex',
            padding: 6,
            borderRadius: 4,
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'rgba(255,87,87,0.08)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
        >
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}
