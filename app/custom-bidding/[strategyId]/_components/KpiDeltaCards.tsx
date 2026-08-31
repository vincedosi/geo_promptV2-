'use client';

/**
 * Cartes KPI métier-aware. La métrique principale est passée en props
 * (résolue depuis bidding_objectives.required_metrics[0]).
 *
 * Lorsque des KPI de ciblage sont fournis (campagne pondérée par variable
 * INSEE), on remplace les libellés génériques par des libellés "ciblage" :
 * part on-cible, concentration, redéploiement.
 */
import type { GlobalKpis } from '@/lib/bidding-ml/comparison';
import type { TargetingKpis } from '@/lib/bidding-ml/targeting-kpis';
import { getMetricLabels, type PrimaryMetric } from '@/lib/bidding-ml/metric-labels';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const fmtCount = (n: number) =>
  Math.round(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const fmtEur = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtSignedPct = (n: number, digits = 1) =>
  `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
const fmtSignedEur = (n: number) =>
  `${n >= 0 ? '+' : ''}${fmtEur(n)}`;

interface Card {
  label: string;
  main: string;
  sub: string;
  mainColor?: string;
  mono?: boolean;
}

interface Props {
  kpis: GlobalKpis;
  /** Métrique principale (impressions / clics / leads / spend). */
  primaryMetric: PrimaryMetric;
  /** Si fournis, remplacent les libellés génériques par les KPI de ciblage. */
  targetingKpis?: TargetingKpis | null;
  /** Label des zones cibles (pour les sous-titres). */
  targetLabel?: string;
  loading?: boolean;
}

export function KpiDeltaCards({ kpis, primaryMetric, targetingKpis, targetLabel = 'zones cibles', loading }: Props) {
  const labels = getMetricLabels(primaryMetric);

  const cards: Card[] = targetingKpis
    ? buildTargetingCards(targetingKpis, labels.name, targetLabel)
    : buildGenericCards(kpis, primaryMetric);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
            background: 'var(--bg-level-1)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)', letterSpacing: '0.02em', marginBottom: 6 }}>
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

function buildTargetingCards(t: TargetingKpis, metricName: string, targetLabel: string): Card[] {
  const isPositiveCorr = t.correlation_sim >= t.correlation_real;
  const spendDelta = t.spend_delta_eur;
  const spendIsoBudget = Math.abs(spendDelta) < 0.01 * Math.max(t.total_spend_real, 1);

  // Note: le KPI star "% on-cible avant→après" est déjà affiché dans le HeroImpact —
  // on ne le dédouble pas ici (UX: pas de redondance).
  void targetLabel;

  return [
    {
      label: `Volume ${metricName.toLowerCase()} sur cible`,
      main: fmtCount(t.on_target_sim),
      sub: `Δ ${t.on_target_sim - t.on_target_real >= 0 ? '+' : ''}${fmtCount(t.on_target_sim - t.on_target_real)} vs ${fmtCount(t.on_target_real)}`,
      mainColor: t.on_target_sim - t.on_target_real >= 0 ? 'var(--brand-teal)' : 'var(--danger)',
      mono: true,
    },
    {
      label: 'Concentration sur cible',
      main: t.correlation_sim.toFixed(2),
      sub: `avant ${t.correlation_real.toFixed(2)} · corrélation Pearson`,
      mainColor: isPositiveCorr ? 'var(--success)' : 'var(--danger)',
      mono: true,
    },
    {
      label: 'Budget respecté',
      main: fmtEur(t.total_spend_sim),
      sub: spendIsoBudget
        ? `iso-budget · ${fmtSignedEur(spendDelta)}`
        : `Δ ${fmtSignedEur(spendDelta)} vs ${fmtEur(t.total_spend_real)}`,
      mainColor: spendIsoBudget ? 'var(--text-primary)' : 'var(--warning)',
      mono: true,
    },
  ];
}

function buildGenericCards(kpis: GlobalKpis, metric: PrimaryMetric): Card[] {
  const labels = getMetricLabels(metric);
  const totalReal = pickTotal(kpis, metric, 'real');
  const totalSim = pickTotal(kpis, metric, 'sim');
  const delta = totalSim - totalReal;
  const lift = totalReal > 0 ? (delta / totalReal) * 100 : 0;
  const isPositive = delta >= 0;

  return [
    {
      label: `${labels.name} servi(e)s`,
      main: labels.formatMain(totalSim),
      sub: `Δ ${delta >= 0 ? '+' : ''}${labels.formatMain(delta)} vs ${labels.formatMain(totalReal)}`,
      mainColor: isPositive ? 'var(--success)' : 'var(--danger)',
      mono: true,
    },
    {
      label: 'Performance',
      main: fmtSignedPct(lift),
      sub: `${kpis.n_zones} zones · ${kpis.n_days} jours`,
      mainColor: lift >= 0 ? 'var(--brand-teal)' : 'var(--danger)',
      mono: true,
    },
    {
      label: `${labels.costName} optimisé`,
      main: fmtEur(kpis.cpl_sim),
      sub: `Δ ${kpis.cpl_delta_eur >= 0 ? '+' : ''}${fmtEur(kpis.cpl_delta_eur)} vs ${fmtEur(kpis.cpl_real)}`,
      mainColor: kpis.cpl_delta_eur <= 0 ? 'var(--success)' : 'var(--danger)',
      mono: true,
    },
    {
      label: 'Budget consommé',
      main: fmtEur(kpis.total_spend_sim),
      sub: `Δ ${fmtSignedEur(kpis.total_spend_sim - kpis.total_spend_real)}`,
      mono: true,
    },
  ];
}

function pickTotal(kpis: GlobalKpis, metric: PrimaryMetric, side: 'real' | 'sim'): number {
  if (metric === 'impressions') return side === 'real' ? kpis.total_impressions_real : kpis.total_impressions_sim;
  if (metric === 'spend') return side === 'real' ? kpis.total_spend_real : kpis.total_spend_sim;
  if (metric === 'leads') return side === 'real' ? kpis.total_leads_real : kpis.total_leads_sim;
  // clicks : pas agrégé dans GlobalKpis. Le mode `targetingKpis` est utilisé
  // pour les campagnes pondérées (cas pitch). Fallback à 0 sinon.
  return 0;
}
