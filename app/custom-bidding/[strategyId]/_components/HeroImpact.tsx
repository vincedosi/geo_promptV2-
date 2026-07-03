'use client';

/**
 * Bandeau "Hero impact MAGELIAN" : synthétise en 1 coup d'oeil ce que fait
 * l'algo. KPI star = part de la métrique servie sur cible (avant → après).
 * Sparkline cumulative à droite pour montrer la dynamique temporelle.
 */
import { useEffect, useMemo, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import type { TargetingKpis } from '@/lib/bidding-ml/targeting-kpis';
import type { DailyComparison } from '@/lib/bidding-ml/comparison';
import { getMetricLabels, type PrimaryMetric } from '@/lib/bidding-ml/metric-labels';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  /** ID de la stratégie — utilisé pour appeler l'endpoint /narrative. */
  strategyId: string;
  kpis: TargetingKpis;
  daily: DailyComparison[];
  /** Label des zones cibles (ex: "zones à fort taux d'abstention"). */
  targetLabel: string;
  /** Variable INSEE en jeu (ex: "taux d'abstention"). null si non applicable. */
  variableLabel: string | null;
  /** Métrique principale (résolue). */
  metric: PrimaryMetric;
}

interface AgentNarrative {
  narrative: string;
  insight: string;
  confidence: 'high' | 'medium' | 'low';
  model: string;
  cached: boolean;
}

const fmtPct = (v: number, digits = 1) =>
  `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
const fmtPctAbs = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
const fmtEur = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** Format compact d'un grand nombre : 23 456 789 → "23,5 M" / 12 345 → "12,3 k". */
const fmtCompact = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000)     return `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`;
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
};
const fmtFull = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const fmtSigned = (n: number, formatter: (x: number) => string) =>
  `${n >= 0 ? '+' : ''}${formatter(n)}`;

export function HeroImpact({ strategyId, kpis, daily, targetLabel, variableLabel, metric }: Props) {
  const labels = getMetricLabels(metric);
  const [agent, setAgent] = useState<AgentNarrative | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const fetchNarrative = async () => {
    setAgentLoading(true);
    setAgentError(null);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/narrative`, {
        method: 'POST',
        cache: 'no-store',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const data = await res.json() as AgentNarrative;
      setAgent(data);
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentLoading(false);
    }
  };

  useEffect(() => {
    void fetchNarrative();
  }, [strategyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sparkline cumulative (sim seulement, sur la métrique star)
  const spark = useMemo(() => {
    let cumReal = 0, cumSim = 0;
    return daily.map(d => {
      const real = (d as unknown as Record<string, number>)[`${metric}_real`] ?? 0;
      const sim = (d as unknown as Record<string, number>)[`${metric}_sim`] ?? 0;
      cumReal += real;
      cumSim += sim;
      return { date: d.date, real: cumReal, sim: cumSim };
    });
  }, [daily, metric]);

  const maxY = useMemo(() => {
    let m = 1;
    for (const p of spark) {
      if (p.real > m) m = p.real;
      if (p.sim > m) m = p.sim;
    }
    return m;
  }, [spark]);

  const W = 220, H = 56;
  const path = (key: 'real' | 'sim') => {
    if (spark.length === 0) return '';
    const stepX = spark.length > 1 ? W / (spark.length - 1) : W;
    return spark.map((p, i) => {
      const x = i * stepX;
      const y = H - (p[key] / maxY) * H;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  };

  // Hero number = volume absolu d'impressions GAGNÉES sur la cible (avant → après).
  // C'est l'optimisation concrète que l'algo a réalisée — bien plus parlant qu'un
  // delta en points de pourcentage.
  const onTargetDelta = kpis.on_target_sim - kpis.on_target_real;
  const heroNumber = fmtSigned(onTargetDelta, fmtCompact);
  const heroIsPositive = onTargetDelta >= 0;
  const heroLabel = `${labels.name.toLowerCase()} redéployées sur ${targetLabel}`;

  const fallbackNarrative = variableLabel
    ? `Sur ${kpis.n_days} jours et ${kpis.n_zones} zones, MAGELIAN a déplacé ${labels.unitShort} des zones à faible ${variableLabel} vers les ${targetLabel}, sans dépasser le spend de la campagne.`
    : `Sur ${kpis.n_days} jours et ${kpis.n_zones} zones, MAGELIAN a réalloué ${labels.unitShort} vers les zones à fort potentiel, sans dépasser le spend de la campagne.`;

  const narrativeText = agent?.narrative ?? fallbackNarrative;
  const isAgentNarrative = !!agent && !agentError;

  return (
    <div
      style={{
        margin: '12px',
        padding: '16px 18px',
        background: 'var(--bg-level-1)',
        border: '0.5px solid var(--brand-teal)',
        borderLeft: '3px solid var(--brand-teal)',
        borderRadius: 10,
        display: 'flex',
        gap: 18,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {/* Bloc gauche : KPI star + récit */}
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
          <span style={{ fontSize: 10, fontFamily: fInter, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--brand-teal)' }}>
            Impact MAGELIAN
          </span>
          {isAgentNarrative && (
            <span
              title={`Récit généré par ${agent?.model ?? 'agent'} · confiance ${agent?.confidence}${agent?.cached ? ' · cache' : ''}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 6px',
                fontSize: 9, fontFamily: fMono,
                background: 'var(--bg-level-2)',
                color: 'var(--brand-teal)',
                border: '0.5px solid var(--brand-teal)',
                borderRadius: 4,
              }}
            >
              <Sparkles size={10} strokeWidth={1.8} />
              MAGELIAN Agent
            </span>
          )}
          {agentLoading && (
            <span style={{ fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
              <RefreshCw size={10} className="agent-spin" /> récit en cours…
            </span>
          )}
          <button
            type="button"
            onClick={() => { void fetchNarrative(); }}
            disabled={agentLoading}
            title="Régénérer le récit"
            style={{
              marginLeft: 'auto',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 7px', fontSize: 9, fontFamily: fMono,
              background: 'transparent',
              color: 'var(--text-tertiary)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 4, cursor: agentLoading ? 'not-allowed' : 'pointer',
              opacity: agentLoading ? 0.5 : 1,
            }}
          >
            <RefreshCw size={10} strokeWidth={1.8} />
            régénérer
          </button>
          <style>{`
            .agent-spin { animation: agentSpin 1s linear infinite; }
            @keyframes agentSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          `}</style>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div
            style={{
              fontSize: 32, fontFamily: fMono, fontWeight: 500, lineHeight: 1,
              color: heroIsPositive ? 'var(--success)' : 'var(--danger)',
              letterSpacing: '-0.01em',
            }}
          >
            {heroNumber}
          </div>
          <div style={{ fontSize: 12, fontFamily: fInter, color: 'var(--text-secondary)', flex: '1 1 200px', minWidth: 0 }}>
            {heroLabel}
            {/* Trace exacte avant/après : volume absolu + part de la métrique */}
            <div style={{ fontSize: 11, fontFamily: fMono, color: 'var(--text-tertiary)', marginTop: 3 }}>
              {fmtFull(kpis.on_target_real)} → <span style={{ color: 'var(--text-secondary)' }}>{fmtFull(kpis.on_target_sim)}</span>
              {' · '}
              {fmtPctAbs(kpis.on_target_share_real, 0)} → {fmtPctAbs(kpis.on_target_share_sim, 0)} de part
              {' · '}
              <span style={{ color: heroIsPositive ? 'var(--success)' : 'var(--danger)' }}>
                {fmtPct(kpis.on_target_lift_pct, 1)} de lift
              </span>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: fInter, marginTop: 10, lineHeight: 1.5 }}>
          {narrativeText}
        </div>

        {agent?.insight && (
          <div
            style={{
              marginTop: 8,
              padding: '6px 10px',
              fontSize: 11, fontFamily: fInter,
              background: 'var(--bg-level-2)',
              border: '0.5px solid var(--brand-teal)',
              borderLeft: '2px solid var(--brand-teal)',
              borderRadius: 4,
              color: 'var(--text-primary)',
              lineHeight: 1.5,
            }}
          >
            <span style={{ fontSize: 9, fontFamily: fMono, color: 'var(--brand-teal)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6 }}>
              Insight
            </span>
            {agent.insight}
          </div>
        )}

        {agentError && (
          <div style={{ marginTop: 8, fontSize: 10, fontFamily: fMono, color: 'var(--danger)' }}>
            Agent indisponible : {agentError}
          </div>
        )}

        {/* Mini badges synthétiques.
            Le badge "sur cible" porte le chiffre clé que la KpiDeltaCards affichait
            avant — gating expert l'avait fait disparaître en mode simple. */}
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Badge
            label={`${labels.name} sur cible`}
            value={fmtCompact(kpis.on_target_sim)}
            sub={`Δ ${fmtSigned(onTargetDelta, fmtCompact)}`}
            positive={onTargetDelta >= 0}
          />
          <Badge label="Budget" value={fmtEur(kpis.total_spend_sim)} sub={`Δ ${fmtEur(kpis.spend_delta_eur)}`} neutral />
          <Badge
            label="Zones cibles"
            value={kpis.n_target_zones.toLocaleString('fr-FR')}
            sub={`/ ${kpis.n_zones} servies`}
            neutral
          />
        </div>
      </div>

      {/* Bloc droite : sparkline cumulative */}
      {spark.length > 1 && (
        <div style={{ flex: '0 0 240px', minWidth: 0 }}>
          <div style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)', textTransform: 'lowercase', marginBottom: 6 }}>
            cumul {labels.name.toLowerCase()}
          </div>
          <svg width={W} height={H} style={{ display: 'block' }}>
            <path d={path('real')} stroke="var(--text-tertiary)" strokeWidth={1} fill="none" />
            <path d={path('sim')} stroke="var(--brand-teal)" strokeWidth={1.5} fill="none" />
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>— sans algo</span>
            <span style={{ color: 'var(--brand-teal)' }}>— avec algo</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({
  label, value, sub, positive, neutral,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  neutral?: boolean;
}) {
  const color = neutral ? 'var(--text-secondary)' : positive ? 'var(--success)' : 'var(--danger)';
  return (
    <div
      style={{
        padding: '6px 10px',
        background: 'var(--bg-level-2)',
        border: '0.5px solid var(--border-subtle)',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <div style={{ fontSize: 9, fontFamily: fInter, color: 'var(--text-tertiary)', textTransform: 'lowercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 12, fontFamily: fMono, fontWeight: 500, color }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}
