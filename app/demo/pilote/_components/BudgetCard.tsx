'use client';
import type { BudgetSummary } from '@/lib/report/types';

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const signedPct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const mono = 'JetBrains Mono, monospace';

export function BudgetCard({ budget }: { budget: BudgetSummary }) {
  const over = budget.variance_pct > 0;
  const row = { display: 'flex', justifyContent: 'space-between' } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
      <div style={row}>
        <span>Budget planifié (vol)</span>
        <strong style={{ fontFamily: mono, color: 'var(--text-primary)' }}>{eur(budget.planned_total)}</strong>
      </div>
      <div style={row}>
        <span>Dépensé (vol)</span>
        <strong style={{ fontFamily: mono, color: over ? 'var(--warning)' : 'var(--brand-teal)' }}>
          {eur(budget.spent_total)} ({signedPct(budget.variance_pct)})
        </strong>
      </div>
      <div style={{ ...row, color: 'var(--text-tertiary)', fontSize: 12 }}>
        <span>État final (dernière période)</span>
        <span style={{ fontFamily: mono }}>{eur(budget.spent_last)} / {eur(budget.planned_last)}</span>
      </div>
      <div style={{ ...row, color: 'var(--text-tertiary)', fontSize: 12 }}>
        <span>Hors-plan (spillover)</span>
        <span style={{ fontFamily: mono }}>{budget.spillover_pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}
