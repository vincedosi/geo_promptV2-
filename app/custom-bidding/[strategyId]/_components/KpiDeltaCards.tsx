'use client';

import type { GlobalKpis } from '@/lib/bidding-ml/comparison';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const fmtCount = (n: number) =>
  n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const fmtEur = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const fmtPct = (n: number) =>
  `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

interface Props {
  kpis: GlobalKpis;
  primaryMetric?: string;
  loading?: boolean;
}

export function KpiDeltaCards({ kpis, primaryMetric = 'leads', loading }: Props) {
  const cards: { label: string; main: string; sub: string; mainColor?: string; mono?: boolean }[] = [
    {
      label: `${primaryMetric} sim. vs réel`,
      main: fmtCount(kpis.total_leads_sim),
      sub: `Δ ${kpis.leads_delta >= 0 ? '+' : ''}${fmtCount(kpis.leads_delta)} (${fmtCount(kpis.total_leads_real)} réels)`,
      mainColor: kpis.leads_delta >= 0 ? '#3dffa0' : '#ff5757',
      mono: true,
    },
    {
      label: 'Lift global',
      main: fmtPct(kpis.lift_pct),
      sub: `${kpis.n_zones} zones · ${kpis.n_days} jours`,
      mainColor: kpis.lift_pct >= 0 ? 'var(--brand-teal, #4ecdc4)' : '#ff5757',
      mono: true,
    },
    {
      label: 'CPL avec algo',
      main: fmtEur(kpis.cpl_sim),
      sub: `Δ ${kpis.cpl_delta_eur >= 0 ? '+' : ''}${fmtEur(kpis.cpl_delta_eur)} vs ${fmtEur(kpis.cpl_real)}`,
      mainColor: kpis.cpl_delta_eur <= 0 ? '#3dffa0' : '#ff5757',
      mono: true,
    },
    {
      label: 'Spend total avec algo',
      main: fmtEur(kpis.total_spend_sim),
      sub: `Δ ${(kpis.total_spend_sim - kpis.total_spend_real) >= 0 ? '+' : ''}${fmtEur(kpis.total_spend_sim - kpis.total_spend_real)}`,
      mono: true,
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: 8,
        padding: 12,
        opacity: loading ? 0.5 : 1,
        transition: 'opacity 120ms',
      }}
    >
      {cards.map((c, i) => (
        <div
          key={i}
          style={{
            padding: '12px 14px',
            background: 'rgba(255,255,255,0.03)',
            border: '0.5px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)', textTransform: 'lowercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            {c.label}
          </div>
          <div
            style={{
              fontSize: 20, fontFamily: c.mono ? fMono : fInter, fontWeight: 500,
              color: c.mainColor ?? 'var(--text-primary)',
              lineHeight: 1.1,
            }}
          >
            {c.main}
          </div>
          <div style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)', marginTop: 4 }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
