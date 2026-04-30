'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';
import {
  aggregateByDate, aggregateByZone, computeGlobalKpis,
  type ComparisonRow, type DailyComparison, type GlobalKpis,
} from '@/lib/bidding-ml/comparison';
import { StrategyHeader } from './_components/StrategyHeader';
import { KpiDeltaCards } from './_components/KpiDeltaCards';
import { PlayControls } from './_components/PlayControls';
import { ChoroplethSplit } from './_components/ChoroplethSplit';
import { ComparisonTimeline } from './_components/ComparisonTimeline';
import { useAgent } from '@/app/_components/agent';
import { Sparkles } from 'lucide-react';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface StrategyMeta {
  strategy: {
    id: string; name: string; campaign_id: string; algorithm_code: string;
    objective_code: string; execution_mode: 'monitor_only' | 'suggest' | 'auto';
    is_demo: boolean; start_date: string | null; end_date: string | null; status: string;
  };
  campaign: {
    id: string; name: string; dsp_source: string; is_demo: boolean;
    advertiser: string | null; date_start: string | null; date_end: string | null;
  } | null;
  objective: {
    code: string; optimization_direction: string; required_metrics: string[] | null;
  } | null;
  active_model: {
    id: string; algorithm_code: string; model_version: string;
    performance_metrics: Record<string, unknown>;
  } | null;
}

interface DriftEvent {
  id: string; postal_code: string | null; detected_at: string;
  drift_type: string; severity: 'low' | 'medium' | 'high'; description: string | null;
}

const isoDate = (s: string): string => s.slice(0, 10);

export default function CustomBiddingDetailPage() {
  const { strategyId } = useParams<{ strategyId: string }>();
  const [meta, setMeta] = useState<StrategyMeta | null>(null);
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[] | null>(null);
  const [drifts, setDrifts] = useState<DriftEvent[]>([]);
  const [postalGeoJSON, setPostalGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Charge méta + comparaison + drifts en parallèle.
  useEffect(() => {
    if (!strategyId) return;
    let cancelled = false;
    (async () => {
      try {
        const [metaRes, compRes, driftRes, geoRes] = await Promise.all([
          adminFetch(`/api/bidding/strategies/${strategyId}`, { cache: 'no-store' }),
          adminFetch(`/api/bidding/strategies/${strategyId}/comparison`, { cache: 'no-store' }),
          adminFetch(`/api/bidding/strategies/${strategyId}/drift-events`, { cache: 'no-store' }),
          adminFetch('/api/digital/codes-postaux?bbox=-5.5,41.0,10.0,51.5', { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (!metaRes.ok) throw new Error(`strategy: HTTP ${metaRes.status}`);
        if (!compRes.ok) throw new Error(`comparison: HTTP ${compRes.status}`);
        const m: StrategyMeta = await metaRes.json();
        const c = await compRes.json();
        const d = driftRes.ok ? await driftRes.json() : { events: [] };
        const g = geoRes.ok ? await geoRes.json() : null;
        setMeta(m);
        setComparisonRows((c.rows ?? []) as ComparisonRow[]);
        setDrifts((d.events ?? []) as DriftEvent[]);
        setPostalGeoJSON(g);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [strategyId]);

  // Liste ordonnée des dates (pour le slider).
  const allDates: string[] = useMemo(() => {
    if (!comparisonRows) return [];
    const set = new Set<string>();
    for (const r of comparisonRows) set.add(r.date);
    return [...set].sort();
  }, [comparisonRows]);

  const [currentIndex, setCurrentIndex] = useState(0);
  // Quand les dates arrivent, positionne sur la dernière (vue finale par défaut).
  useEffect(() => {
    if (allDates.length > 0) setCurrentIndex(allDates.length - 1);
  }, [allDates.length]);

  const currentDate = allDates[currentIndex] ?? '';

  // Daily series pour la timeline (calculée une fois, indépendante du slider).
  const daily: DailyComparison[] = useMemo(() => {
    if (!comparisonRows) return [];
    return aggregateByDate(comparisonRows);
  }, [comparisonRows]);

  // Rows filtrées par jour courant pour le choropleth.
  const rowsCurrentDay = useMemo(() => {
    if (!comparisonRows || !currentDate) return [];
    return comparisonRows.filter(r => r.date === currentDate);
  }, [comparisonRows, currentDate]);

  // KPIs globaux : sur TOUTE la fenêtre (pas seulement le jour courant).
  const globalKpis: GlobalKpis = useMemo(() => {
    if (!comparisonRows) return {
      total_leads_real: 0, total_leads_sim: 0,
      total_spend_real: 0, total_spend_sim: 0,
      total_impressions_real: 0, total_impressions_sim: 0,
      cpl_real: 0, cpl_sim: 0, cpl_delta_eur: 0,
      lift_pct: 0, leads_delta: 0, n_zones: 0, n_days: 0,
    };
    return computeGlobalKpis(comparisonRows);
  }, [comparisonRows]);

  // GeoJSON enrichi avec les valeurs du jour courant par CP.
  const enrichedGeoJSON: GeoJSON.FeatureCollection | null = useMemo(() => {
    if (!postalGeoJSON) return null;
    const byZone = new Map(aggregateByZone(rowsCurrentDay).map(z => [z.postal_code, z]));
    return {
      type: 'FeatureCollection',
      features: postalGeoJSON.features.map(f => {
        const cp = String(f.properties?.code_postal ?? '');
        const z = byZone.get(cp);
        return {
          ...f,
          properties: {
            ...(f.properties ?? {}),
            leads_real: z?.leads_real ?? 0,
            leads_sim: z?.leads_sim ?? 0,
            spend_real: z?.spend_real ?? 0,
            spend_sim: z?.spend_sim ?? 0,
            impressions_real: z?.impressions_real ?? 0,
            impressions_sim: z?.impressions_sim ?? 0,
            clicks_real: z?.clicks_real ?? 0,
            clicks_sim: z?.clicks_sim ?? 0,
            bid_multiplier: z?.bid_multiplier ?? 1.0,
            // Champ générique consommé par le hover de SyncMap (metricLabel='Leads')
            impressions: z?.leads_sim ?? 0,
          },
        };
      }),
    };
  }, [postalGeoJSON, rowsCurrentDay]);

  // Drift dates (pour les marqueurs sur le slider et la timeline).
  const driftDates = useMemo(
    () => [...new Set(drifts.map(d => isoDate(d.detected_at)))],
    [drifts],
  );

  if (error) {
    return (
      <div style={{ padding: 32, fontFamily: fInter, color: '#f0f0f0', background: '#050505', minHeight: '100vh' }}>
        <Link href="/custom-bidding" style={{ color: '#4ecdc4', fontSize: 12 }}>← Retour</Link>
        <div style={{ marginTop: 16, padding: 16, background: 'rgba(255,87,87,0.08)', border: '0.5px solid rgba(255,87,87,0.3)', borderRadius: 6, color: '#ff5757', fontSize: 13 }}>
          {error}
        </div>
      </div>
    );
  }

  if (!meta || !comparisonRows) {
    return (
      <div style={{ padding: 32, fontFamily: fMono, fontSize: 12, color: '#666', background: '#050505', minHeight: '100vh' }}>
        Chargement…
      </div>
    );
  }

  const primaryMetric = (meta.objective?.required_metrics?.[0] ?? 'leads').toString();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary, #050505)', color: 'var(--text-primary, #f0f0f0)', fontFamily: fInter, position: 'relative' }}>
      <div style={{ padding: '12px 20px 0' }}>
        <Link href="/custom-bidding" style={{ fontSize: 11, fontFamily: fMono, color: 'var(--text-tertiary, #666)', textDecoration: 'none' }}>
          ← retour aux stratégies
        </Link>
      </div>

      <StrategyHeader
        strategyId={strategyId as string}
        strategyName={meta.strategy.name}
        campaignName={meta.campaign?.name ?? 'Campagne inconnue'}
        isDemo={Boolean(meta.campaign?.is_demo)}
        algorithmCode={meta.strategy.algorithm_code}
        initialMode={meta.strategy.execution_mode}
        onActionResult={() => {
          // Refresh après predict/train pour récupérer les nouveaux multipliers
          setComparisonRows(null);
          adminFetch(`/api/bidding/strategies/${strategyId}/comparison`, { cache: 'no-store' })
            .then(r => r.json())
            .then(d => setComparisonRows((d.rows ?? []) as ComparisonRow[]))
            .catch(() => { /* feedback déjà visible dans header */ });
        }}
      />

      <KpiDeltaCards kpis={globalKpis} primaryMetric={primaryMetric} />

      <PlayControls
        dates={allDates}
        currentIndex={currentIndex}
        driftDates={driftDates}
        onIndexChange={setCurrentIndex}
      />

      <ChoroplethSplit
        geojson={enrichedGeoJSON}
        metric="leads"
        currentDate={currentDate}
      />

      <ComparisonTimeline
        daily={daily}
        currentDate={currentDate}
        driftDates={driftDates}
      />

      {drifts.length > 0 && (
        <DriftEventsList drifts={drifts} strategyId={strategyId as string} />
      )}

      <footer style={{ padding: '20px 24px', fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary, #666)', borderTop: '0.5px solid var(--border-subtle, #1a1a1a)', marginTop: 16 }}>
        Modèle de simulation linéaire (x_sim = x_real × bid_multiplier). Approximation contrefactuelle — cf docs A4.2.
        Algorithme actif : <span style={{ color: 'var(--text-secondary, #a0a0a0)' }}>{meta.active_model?.model_version ?? meta.strategy.algorithm_code}</span>
      </footer>
    </div>
  );
}

const SEV_COLORS: Record<DriftEvent['severity'], string> = {
  low: '#5b9bd5',
  medium: '#f7b731',
  high: '#ff5757',
};

function DriftEventsList({ drifts, strategyId }: { drifts: DriftEvent[]; strategyId: string }) {
  const agent = useAgent();
  const sorted = [...drifts].sort((a, b) =>
    a.detected_at < b.detected_at ? 1 : -1,
  );
  return (
    <section style={{ padding: '0 16px 16px' }}>
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.08)',
        borderRadius: 8, padding: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Sparkles size={12} style={{ color: 'var(--brand-teal, #4ecdc4)' }} />
          <h2 style={{ margin: 0, fontSize: 12, fontFamily: fInter, fontWeight: 500, color: 'var(--text-primary, #f0f0f0)' }}>
            Drift events ({drifts.length})
          </h2>
          <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary, #666)' }}>
            cliquer « Analyser » pour ouvrir GeoAgent
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sorted.map(d => (
            <div
              key={d.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                background: 'rgba(255,255,255,0.02)',
                border: '0.5px solid rgba(255,255,255,0.06)',
                borderRadius: 6,
              }}
            >
              <span style={{
                fontFamily: fMono, fontSize: 9, padding: '2px 6px', borderRadius: 4,
                background: `${SEV_COLORS[d.severity]}1a`,
                border: `0.5px solid ${SEV_COLORS[d.severity]}40`,
                color: SEV_COLORS[d.severity],
              }}>{d.severity}</span>
              <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary, #666)' }}>
                {isoDate(d.detected_at)}
              </span>
              <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-secondary, #a0a0a0)' }}>
                {d.drift_type} · {d.postal_code ?? 'global'}
              </span>
              <span style={{ flex: 1, fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary, #a0a0a0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.description ?? ''}
              </span>
              <button
                onClick={() => agent.open({ drift_event_id: d.id, strategy_id: strategyId })}
                style={{
                  padding: '4px 10px', fontFamily: fInter, fontSize: 10, fontWeight: 500,
                  background: 'rgba(78,205,196,0.08)', color: 'var(--brand-teal, #4ecdc4)',
                  border: '0.5px solid var(--brand-teal, #4ecdc4)',
                  borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <Sparkles size={10} />
                Analyser
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
