'use client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { CONVERGENCE_TOLERANCE } from '@/lib/demo/constants';
import type { ConvergencePoint } from '@/lib/report/types';

export function ConvergenceChart({ points }: { points: ConvergencePoint[] }) {
  const data = points.map((p) => ({ name: `v${p.version}`, ecart: p.mean_delta }));
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="name" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
          <YAxis stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: 'var(--card)', border: '0.5px solid var(--border-default)', color: 'var(--text-primary)', fontSize: 12 }}
            labelStyle={{ color: 'var(--text-tertiary)' }}
            formatter={(v) => [`${v} pts`, 'écart moyen']}
          />
          <ReferenceLine y={CONVERGENCE_TOLERANCE} stroke="var(--brand-teal)" strokeDasharray="4 4"
            label={{ value: 'seuil', fill: 'var(--text-tertiary)', fontSize: 10, position: 'right' }} />
          <Line type="monotone" dataKey="ecart" stroke="var(--brand-teal)" strokeWidth={2} dot={{ r: 3, fill: 'var(--brand-teal)' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
