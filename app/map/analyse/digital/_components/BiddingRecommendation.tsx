'use client';

import { useState, useMemo } from 'react';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface BiddingRow {
  code: string;
  nom: string;
  pct_imp: number;
  pct_pop: number;
  ecart: number;
}

interface BiddingRecommendationProps {
  data: BiddingRow[];
  aggregation: string;
}

function computeCoeff(pctImp: number, pctPop: number, intensity: number): number {
  if (!pctPop || pctPop === 0) return 1.0;
  const ratio = pctImp / pctPop;
  let coeff: number;
  if (ratio > 1) {
    coeff = 1 / Math.pow(ratio, intensity);
  } else if (ratio < 1) {
    coeff = Math.pow(1 / ratio, intensity);
  } else {
    coeff = 1.0;
  }
  return Math.max(0.1, Math.min(3.0, coeff));
}

export function BiddingRecommendation({ data, aggregation }: BiddingRecommendationProps) {
  const [intensity, setIntensity] = useState(1.0);

  const rows = useMemo(() => {
    return data
      .filter(d => d.pct_pop != null && d.pct_pop > 0)
      .map(d => ({
        ...d,
        ratio: d.pct_imp / d.pct_pop,
        coeff: computeCoeff(d.pct_imp, d.pct_pop, intensity),
      }))
      .sort((a, b) => b.coeff - a.coeff);
  }, [data, intensity]);

  const exportCsv = () => {
    const header = 'code,nom,ratio,ecart,coefficient\n';
    const lines = rows.map(r => `${r.code},${r.nom.replace(/,/g, ' ')},${r.ratio.toFixed(3)},${r.ecart},${r.coeff.toFixed(2)}`).join('\n');
    const blob = new Blob([header + lines], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bidding_coefficients_${aggregation}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const intensityLabel = intensity <= 0.6 ? 'Conservateur' : intensity >= 1.3 ? 'Agressif' : 'Modere';

  if (!rows.length) return null;

  return (
    <div style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--border-subtle)' }}>
        <span style={{ fontFamily: fInter, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Recommandation bidding</span>
        <button onClick={exportCsv} style={{
          padding: '5px 12px', fontFamily: fInter, fontSize: 10, cursor: 'pointer',
          background: 'rgba(78,205,196,0.08)', border: '0.5px solid var(--brand-teal)',
          borderRadius: 4, color: 'var(--brand-teal)',
        }}>Exporter CSV</button>
      </div>

      {/* Intensity slider */}
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>Intensite du bid</span>
        <input type="range" min={0.3} max={1.8} step={0.1} value={intensity}
          onChange={e => setIntensity(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--brand-teal)', minWidth: 90, textAlign: 'right' }}>{intensity.toFixed(1)}x — {intensityLabel}</span>
      </div>

      {/* Table */}
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Zone', 'Ratio', 'Ecart', 'Coeff.'].map(h => (
                <th key={h} style={{
                  textAlign: h === 'Zone' ? 'left' : 'right', padding: '6px 12px',
                  fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--brand-teal)',
                  borderBottom: '0.5px solid var(--border-subtle)', position: 'sticky', top: 0, background: 'var(--bg-level-2)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.code} style={{ borderBottom: '0.5px solid var(--bg-surface)' }}>
                <td style={{ padding: '5px 12px', fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>{r.code} — {r.nom}</td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontFamily: fMono, fontSize: 11, color: 'var(--text-primary)' }}>{r.ratio.toFixed(2)}</td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontFamily: fMono, fontSize: 11, color: r.ecart > 0 ? '#EF4444' : '#3B82F6', fontWeight: 600 }}>
                  {r.ecart > 0 ? '+' : ''}{r.ecart.toFixed(2)}
                </td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontFamily: fMono, fontSize: 12, fontWeight: 700, color: r.coeff > 1.1 ? 'var(--success)' : r.coeff < 0.9 ? 'var(--danger)' : 'var(--text-tertiary)' }}>
                  {r.coeff.toFixed(2)}x {r.coeff > 1.05 ? '▲' : r.coeff < 0.95 ? '▼' : '─'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
