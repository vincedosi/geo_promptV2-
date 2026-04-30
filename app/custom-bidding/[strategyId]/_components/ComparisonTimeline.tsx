'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { DailyComparison } from '@/lib/bidding-ml/comparison';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  daily: DailyComparison[];
  currentDate?: string;
  driftDates?: string[];
}

const fmtDay = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};

interface TooltipPayload {
  payload?: DailyComparison;
}

function CustomTooltip({ active, label, payload }: { active?: boolean; label?: string; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length || !label) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{ background: 'var(--bg-level-2, #111)', border: '0.5px solid var(--border-default, #262626)', borderRadius: 6, padding: '8px 10px', fontFamily: fMono, fontSize: 11, color: 'var(--text-primary, #f0f0f0)' }}>
      <div style={{ marginBottom: 4 }}>{fmtDay(label)}</div>
      <div style={{ color: 'var(--text-tertiary, #666)' }}>réel : <span style={{ color: 'var(--text-primary, #f0f0f0)' }}>{d.leads_real.toLocaleString('fr-FR')}</span></div>
      <div style={{ color: 'var(--text-tertiary, #666)' }}>sim. : <span style={{ color: 'var(--brand-teal, #4ecdc4)' }}>{d.leads_sim.toLocaleString('fr-FR')}</span></div>
      <div style={{ color: 'var(--text-tertiary, #666)' }}>lift : <span style={{ color: d.lift_pct >= 0 ? '#3dffa0' : '#ff5757' }}>{d.lift_pct >= 0 ? '+' : ''}{d.lift_pct.toFixed(1)}%</span></div>
    </div>
  );
}

export function ComparisonTimeline({ daily, currentDate, driftDates = [] }: Props) {
  return (
    <div style={{ padding: '8px 12px 16px' }}>
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '0.5px solid rgba(255,255,255,0.08)',
          borderRadius: 8, padding: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
          <h2 style={{ margin: 0, fontSize: 11, fontWeight: 500, fontFamily: fInter, color: 'var(--text-primary)' }}>
            Leads par jour
          </h2>
          <Legend color="#a0a0a0" label="réel" />
          <Legend color="#4ecdc4" label="simulé (avec algo)" />
          {driftDates.length > 0 && <Legend color="#ff5757" label={`${driftDates.length} drift event${driftDates.length > 1 ? 's' : ''}`} dashed />}
        </div>

        <div style={{ width: '100%', height: 180 }}>
          <ResponsiveContainer>
            <LineChart data={daily} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <XAxis
                dataKey="date"
                tick={{ fill: '#666', fontSize: 10, fontFamily: fMono }}
                tickLine={false} axisLine={{ stroke: '#1a1a1a' }}
                tickFormatter={fmtDay}
              />
              <YAxis
                tick={{ fill: '#666', fontSize: 10, fontFamily: fMono }}
                tickLine={false} axisLine={{ stroke: '#1a1a1a' }}
                width={50}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#262626', strokeWidth: 1 }} />
              <Line type="monotone" dataKey="leads_real" stroke="#a0a0a0" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="leads_sim" stroke="#4ecdc4" strokeWidth={2} dot={false} isAnimationActive={false} />
              {driftDates.map(d => (
                <ReferenceLine key={d} x={d} stroke="#ff5757" strokeDasharray="3 3" strokeOpacity={0.6} />
              ))}
              {currentDate && (
                <ReferenceLine x={currentDate} stroke="#f0f0f0" strokeWidth={1} strokeOpacity={0.5} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary, #666)' }}>
      <span style={{ width: 16, height: 0, borderTop: dashed ? `1.5px dashed ${color}` : `1.5px solid ${color}` }} />
      {label}
    </span>
  );
}
