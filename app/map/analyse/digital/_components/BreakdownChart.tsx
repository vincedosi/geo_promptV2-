'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface BreakdownRow {
  code: string;
  nom: string;
  impressions: number;
  pop_value: number;
  pct_imp: number;
  pct_pop: number;
  ecart: number;
}

interface BreakdownChartProps {
  data: BreakdownRow[];
  aggregation: string;
  metric?: 'impressions' | 'unique';
  onBarClick?: (code: string) => void;
}

function CustomTooltip({ active, payload, impLabel }: { active?: boolean; payload?: Array<{ payload: BreakdownRow }>; impLabel: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#0a0a0a', border: '0.5px solid #262626', borderRadius: 4, padding: '8px 10px', fontFamily: fInter, fontSize: 11 }}>
      <div style={{ fontWeight: 600, color: '#f0f0f0', marginBottom: 4 }}>{d.code} — {d.nom}</div>
      <div style={{ color: '#a0a0a0' }}>{impLabel}: <span style={{ color: '#4ecdc4', fontFamily: fMono }}>{d.pct_imp.toFixed(2)}%</span> ({d.impressions.toLocaleString('fr-FR')})</div>
      <div style={{ color: '#a0a0a0' }}>Pop: <span style={{ color: '#f0f0f0', fontFamily: fMono }}>{d.pct_pop.toFixed(2)}%</span> ({d.pop_value.toLocaleString('fr-FR')})</div>
      <div style={{ color: d.ecart > 0 ? '#EF4444' : '#3B82F6', fontFamily: fMono, fontWeight: 600, marginTop: 4 }}>
        {d.ecart > 0 ? '+' : ''}{d.ecart.toFixed(2)} pts {d.ecart > 0 ? 'sur-servi' : 'sous-servi'}
      </div>
    </div>
  );
}

export function BreakdownChart({ data, aggregation, metric = 'impressions', onBarClick }: BreakdownChartProps) {
  const impLabel = metric === 'unique' ? 'Imp. uniques' : 'Imp.';
  if (!data.length) return <div style={{ padding: 16, fontFamily: fInter, fontSize: 11, color: '#666666' }}>Aucune donnee</div>;

  const sorted = [...data].sort((a, b) => b.ecart - a.ecart);
  const barHeight = 22;
  const chartHeight = Math.max(sorted.length * barHeight + 40, 120);

  return (
    <div style={{ background: '#050505', borderRadius: 4, border: '0.5px solid #1a1a1a', overflow: 'hidden' }}>
      <div style={{ padding: '8px 10px', fontFamily: fInter, fontSize: 11, fontWeight: 500, color: '#a0a0a0', borderBottom: '0.5px solid #1a1a1a' }}>
        Écart {metric === 'unique' ? 'imp. uniques' : 'imp.'} vs pop. — {aggregation === 'region' ? 'Regions' : aggregation === 'dept' ? 'Departements' : 'Codes postaux'}
      </div>
      <ResponsiveContainer key={`${aggregation}-${sorted.length}`} width="100%" height={chartHeight}>
        <BarChart data={sorted} layout="vertical" margin={{ left: 80, right: 20, top: 8, bottom: 8 }}>
          <XAxis type="number" tick={{ fill: '#666666', fontSize: 9, fontFamily: fMono }} axisLine={{ stroke: '#1a1a1a' }} tickLine={false} />
          <YAxis type="category" dataKey="nom" tick={{ fill: '#a0a0a0', fontSize: 10, fontFamily: fInter }} axisLine={false} tickLine={false} width={75} />
          <Tooltip content={<CustomTooltip impLabel={impLabel} />} cursor={false} />
          <ReferenceLine x={0} stroke="#333333" strokeDasharray="3 3" />
          <Bar dataKey="ecart" radius={[2, 2, 2, 2]} onClick={(_d, _i, e) => { const code = (e as unknown as { payload?: { code?: string } })?.payload?.code; if (code) onBarClick?.(code); }} style={{ cursor: aggregation === 'cp' ? 'default' : 'pointer' }}>
            {sorted.map((entry) => (
              <Cell key={entry.code} fill={entry.ecart > 0 ? '#EF4444' : '#3B82F6'} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
