'use client';

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
  onRowClick?: (code: string) => void;
}

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString('fr-FR');
}

export function ActionListTable({ data, onRowClick }: ActionListTableProps) {
  const [tab, setTab] = useState<'over' | 'under'>('over');

  const filtered = tab === 'over'
    ? data.filter(d => d.ecart > 0).sort((a, b) => b.ecart - a.ecart)
    : data.filter(d => d.ecart < 0).sort((a, b) => a.ecart - b.ecart);

  const top = filtered.slice(0, 20);

  return (
    <div style={{ background: '#050505', borderRadius: 4, border: '0.5px solid #1a1a1a', overflow: 'hidden' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid #1a1a1a' }}>
        {([['over', 'Sur-servis', '#EF4444'], ['under', 'Sous-servis', '#3B82F6']] as const).map(([id, label, color]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, padding: '7px 0', fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            background: tab === id ? '#111111' : 'transparent',
            border: 'none', borderBottom: tab === id ? `2px solid ${color}` : '2px solid transparent',
            color: tab === id ? color : '#666666', transition: 'all 0.15s',
          }}>{label} ({(tab === id ? filtered : data.filter(d => id === 'over' ? d.ecart > 0 : d.ecart < 0)).length})</button>
        ))}
      </div>

      {/* Table */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Zone', 'Imp.', 'Pop.', 'Ecart'].map(h => (
                <th key={h} style={{
                  textAlign: h === 'Zone' ? 'left' : 'right', padding: '5px 8px',
                  fontFamily: fInter, fontSize: 9, fontWeight: 500, color: '#4ecdc4',
                  borderBottom: '0.5px solid #1a1a1a', position: 'sticky', top: 0, background: '#0a0a0a',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top.map((row, i) => (
              <tr key={row.code} onClick={() => onRowClick?.(row.code)}
                style={{ cursor: 'pointer', borderBottom: '0.5px solid #111111' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#111111'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <td style={{ padding: '4px 8px', fontFamily: fInter, fontSize: 10, color: '#a0a0a0' }}>
                  <span style={{ color: '#666666', marginRight: 4 }}>{i + 1}.</span>{row.code} — {row.nom}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 10, color: '#f0f0f0' }}>{fmt(row.impressions)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 10, color: '#a0a0a0' }}>{fmt(row.pop_value)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 10, fontWeight: 600, color: row.ecart > 0 ? '#EF4444' : '#3B82F6' }}>
                  {row.ecart > 0 ? '+' : ''}{row.ecart.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
