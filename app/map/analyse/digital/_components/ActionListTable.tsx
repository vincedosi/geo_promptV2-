'use client';
import { logger } from '@/lib/logger';

import { useState } from 'react';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface ActionRow {
  code: string;
  nom: string;
  impressions: number;
  pop_value: number;
  pct_imp: number;
  pct_pop: number;
  ecart: number;
}

interface ActionListTableProps {
  data: ActionRow[];
  metric?: string;
  aggregation?: 'region' | 'dept' | 'cp';
  onRowClick?: (code: string) => void;
}

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString('fr-FR');
}

export function ActionListTable({ data, metric = 'impressions', aggregation = 'region', onRowClick }: ActionListTableProps) {
  const [tab, setTab] = useState<'over' | 'under'>('over');
  const impHeader = metric === 'unique' ? 'Imp. uniq.' : 'Imp.';
  const zoneHeader = aggregation === 'region' ? 'Region' : aggregation === 'dept' ? 'Departement' : 'Code postal';
  const canDrill = aggregation !== 'cp';

  const filtered = tab === 'over'
    ? data.filter(d => d.ecart > 0).sort((a, b) => b.ecart - a.ecart)
    : data.filter(d => d.ecart < 0).sort((a, b) => a.ecart - b.ecart);

  const top = filtered.slice(0, 20);

  return (
    <div style={{ background: 'var(--bg-primary)', borderRadius: 4, border: '0.5px solid var(--border-subtle)', overflow: 'hidden' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border-subtle)' }}>
        {([['over', 'Sur-servis', '#EF4444'], ['under', 'Sous-servis', '#3B82F6']] as const).map(([id, label, color]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, padding: '7px 0', fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            background: tab === id ? 'var(--bg-level-2)' : 'transparent',
            border: 'none', borderBottom: tab === id ? '2px solid var(--brand-teal)' : '2px solid transparent',
            color: tab === id ? color : 'var(--text-tertiary)', transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover)',
          }}>{label} ({(tab === id ? filtered : data.filter(d => id === 'over' ? d.ecart > 0 : d.ecart < 0)).length})</button>
        ))}
      </div>

      {/* Table */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[zoneHeader, impHeader, 'Pop.', 'Ecart'].map(h => (
                <th key={h} style={{
                  textAlign: h === zoneHeader ? 'left' : 'right', padding: '5px 8px',
                  fontFamily: fInter, fontSize: 9, fontWeight: 500, color: 'var(--brand-teal)',
                  borderBottom: '0.5px solid var(--border-subtle)', position: 'sticky', top: 0, background: 'var(--bg-surface)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top.map((row, i) => (
              <tr key={row.code} onClick={() => { logger.debug('drilldown', `ActionListTable row clicked ${row.code}`); onRowClick?.(row.code); }}
                style={{ cursor: canDrill ? 'pointer' : 'default', borderBottom: '0.5px solid var(--bg-level-2)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = canDrill ? 'var(--bg-level-2)' : 'transparent'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <td style={{ padding: '4px 8px', fontFamily: fInter, fontSize: 10, color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-tertiary)', marginRight: 4 }}>{i + 1}.</span>{row.code} — {row.nom}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 10, color: 'var(--text-primary)' }}>{fmt(row.impressions)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 10, color: 'var(--text-secondary)' }}>{fmt(row.pop_value)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 10, fontWeight: 600, color: row.ecart > 0 ? '#EF4444' : '#3B82F6' }}>
                  {row.ecart > 0 ? '+' : ''}{row.ecart.toFixed(2)}
                </td>
              </tr>
            ))}
            {top.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '20px 12px', textAlign: 'center', fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                Aucune zone {tab === 'over' ? 'sur-servie' : 'sous-servie'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
