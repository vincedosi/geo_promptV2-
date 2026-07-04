'use client';
import { PACING_STATUS_META } from '@/lib/pacing/compute';
import type { PilotPacing } from '@/lib/demo/pilot-types';

const fInter = 'Inter, sans-serif';

export function PacingCard({ p }: { p: PilotPacing }) {
  return (
    <div style={{ background: 'var(--card)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: 12, fontFamily: fInter, marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>Version <strong style={{ color: 'var(--text-primary)' }}>v{p.version}</strong></span>
        <span>Écart moyen <strong style={{ color: 'var(--text-primary)' }}>{p.mean_delta.toFixed(1)}</strong> pts</span>
        {p.converged && <span style={{ color: 'var(--brand-teal)' }}>conforme</span>}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {[...p.items].sort((a, b) => a.delta_pts - b.delta_pts).map((i) => {
            const meta = PACING_STATUS_META[i.status];
            return (
              <tr key={i.item_id} style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <td style={{ padding: '4px 6px', color: 'var(--text-primary)' }}>{i.item_name}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{(i.expected_share * 100).toFixed(0)}%</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{(i.actual_share * 100).toFixed(0)}%</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: meta.colorVar }}>{i.delta_pts >= 0 ? '+' : ''}{i.delta_pts.toFixed(1)}</td>
                <td style={{ padding: '4px 6px', color: meta.colorVar }}>{meta.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
