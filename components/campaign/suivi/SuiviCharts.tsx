'use client';

/**
 * SuiviCharts — les deux graphes du cockpit de suivi (spec 2026-07-17) :
 *   1. budget cumulé (spend) vs droite idéale (total_budget × t) ± 10 % ;
 *   2. CPM quotidien vs CPM prévu (ligne de référence pointillée).
 * Données 100 % locales (payload.daily) — aucun fetch. Couleurs en tokens
 * CSS var(--…) uniquement (règle DESIGN_SYSTEM).
 */
import {
  Area, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtCpm, fmtInt, type SuiviPayload } from '@/lib/campaigns/suivi-metrics';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const tooltipStyle = {
  background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
  borderRadius: 6, fontFamily: fMono, fontSize: 11,
} as const;

function dayLabel(iso: string): string {
  return iso.slice(8, 10) + '/' + iso.slice(5, 7);
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 6px' }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
      <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{children}</span>
    </div>
  );
}

export function SuiviCharts({ payload }: { payload: SuiviPayload }) {
  const { daily, pacing, cpm } = payload;
  if (daily.length === 0) return null;

  // Cumul du spend + droite idéale jour par jour sur la période de la stratégie.
  const start = payload.start_date ?? daily[0].date;
  const end = payload.end_date ?? daily[daily.length - 1].date;
  const durationDays = Math.max(1,
    (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000 + 1);
  let cum = 0;
  const budgetData = daily.map((d) => {
    cum += d.spend;
    const dayIndex = (new Date(d.date).getTime() - new Date(start).getTime()) / 86_400_000 + 1;
    const ideal = pacing.total_budget != null
      ? (pacing.total_budget * dayIndex) / durationDays
      : null;
    return {
      date: d.date,
      cumul: Math.round(cum),
      ideal: ideal != null ? Math.round(ideal) : null,
      idealLow: ideal != null ? Math.round(ideal * 0.9) : null,
      idealBand: ideal != null ? Math.round(ideal * 0.2) : null, // épaisseur de la bande ±10 %
    };
  });

  const axisProps = {
    stroke: 'var(--text-tertiary)',
    tick: { fontFamily: fMono, fontSize: 10, fill: 'var(--text-tertiary)' },
    tickLine: false, axisLine: false,
  } as const;

  return (
    <div>
      <SectionLabel>Budget cumulé vs idéal</SectionLabel>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={budgetData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="date" tickFormatter={dayLabel} {...axisProps} minTickGap={30} />
            <YAxis width={54} tickFormatter={(v: number) => fmtInt(v)} {...axisProps} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => dayLabel(String(v))}
              formatter={(value, name) => [
                `${fmtInt(Number(value))} €`,
                name === 'cumul' ? 'dépensé' : name === 'ideal' ? 'idéal' : null,
              ]}
            />
            {/* Bande de tolérance ±10 % : aire empilée transparente puis bande translucide. */}
            <Area dataKey="idealLow" stackId="band" stroke="none" fill="transparent" activeDot={false} legendType="none" name=" " />
            <Area dataKey="idealBand" stackId="band" stroke="none" fill="var(--brand-teal-10)" activeDot={false} legendType="none" name=" " />
            <Line dataKey="ideal" stroke="var(--text-tertiary)" strokeDasharray="4 4" dot={false} strokeWidth={1} name="ideal" />
            <Line dataKey="cumul" stroke="var(--brand-teal)" dot={false} strokeWidth={2} name="cumul" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <SectionLabel>CPM quotidien vs prévu</SectionLabel>
      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="date" tickFormatter={dayLabel} {...axisProps} minTickGap={30} />
            <YAxis width={54} domain={['auto', 'auto']} tickFormatter={(v: number) => fmtCpm(v)} {...axisProps} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => dayLabel(String(v))}
              formatter={(value) => [fmtCpm(Number(value)), 'CPM']}
            />
            {cpm.forecast != null && (
              <ReferenceLine y={cpm.forecast} stroke="var(--text-tertiary)" strokeDasharray="4 4" />
            )}
            <Line dataKey="cpm" stroke="var(--brand-teal)" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
