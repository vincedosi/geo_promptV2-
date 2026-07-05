'use client';
import { PACING_STATUS_META } from '@/lib/pacing/compute';
import type { ZoneBeforeAfter } from '@/lib/report/types';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const mono = 'JetBrains Mono, monospace';

export function ZoneBeforeAfterTable({ zones }: { zones: ZoneBeforeAfter[] }) {
  const sorted = [...zones].sort((a, b) => b.delta_last - a.delta_last);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
          <th style={{ padding: '6px 8px', fontWeight: 400 }}>Zone</th>
          <th style={{ fontWeight: 400 }}>Cible</th>
          <th style={{ fontWeight: 400 }}>Réel v1</th>
          <th style={{ fontWeight: 400 }}>Réel final</th>
          <th style={{ fontWeight: 400 }}>Δ v1</th>
          <th style={{ fontWeight: 400 }}>Δ final</th>
          <th style={{ fontWeight: 400 }}>Statut</th>
        </tr>
      </thead>
      <tbody style={{ fontFamily: mono }}>
        {sorted.map((z) => (
          <tr key={z.item_id} style={{ borderTop: '0.5px solid var(--border-subtle)' }}>
            <td style={{ padding: '6px 8px', fontFamily: 'Inter, sans-serif', color: 'var(--text-primary)' }}>{z.item_name}</td>
            <td>{pct(z.expected_share)}</td>
            <td>{pct(z.actual_share_first)}</td>
            <td>{pct(z.actual_share_last)}</td>
            <td style={{ color: PACING_STATUS_META[z.status_first].colorVar }}>{signed(z.delta_first)}</td>
            <td style={{ color: PACING_STATUS_META[z.status_last].colorVar }}>{signed(z.delta_last)}</td>
            <td style={{ color: PACING_STATUS_META[z.status_last].colorVar }}>{PACING_STATUS_META[z.status_last].label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
