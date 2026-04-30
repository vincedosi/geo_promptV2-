'use client';

/**
 * Overlay Pilotage ML — rend le module Custom Bidding inline dans /map.
 *
 * Vue 1 : liste des stratégies actives (réutilise la logique de
 *         /custom-bidding/page.tsx).
 * Vue 2 : détail d'une stratégie sélectionnée — réutilise les composants
 *         déjà livrés en A4.4 (StrategyHeader, KpiDeltaCards, PlayControls,
 *         ChoroplethSplit, ComparisonTimeline). Aucune navigation hors /map.
 */
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { adminFetch } from '@/lib/admin-fetch';
import {
  aggregateByDate, aggregateByZone, computeGlobalKpis,
  type ComparisonRow, type DailyComparison, type GlobalKpis,
} from '@/lib/bidding-ml/comparison';
import { StrategyHeader } from '@/app/custom-bidding/[strategyId]/_components/StrategyHeader';
import { KpiDeltaCards } from '@/app/custom-bidding/[strategyId]/_components/KpiDeltaCards';
import { PlayControls } from '@/app/custom-bidding/[strategyId]/_components/PlayControls';
import { ComparisonTimeline } from '@/app/custom-bidding/[strategyId]/_components/ComparisonTimeline';

const ChoroplethSplit = dynamic(
  () => import('@/app/custom-bidding/[strategyId]/_components/ChoroplethSplit').then(m => ({ default: m.ChoroplethSplit })),
  { ssr: false },
);

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface StrategyListItem {
  id: string;
  name: string;
  algorithm_code: string;
  objective_code: string;
  execution_mode: 'monitor_only' | 'suggest' | 'auto';
  status: string;
  is_demo: boolean;
  dsp_campaigns?: { id: string; name: string; dsp_source: string; is_demo: boolean } | null;
}

interface StrategyMeta {
  strategy: {
    id: string; name: string; algorithm_code: string; objective_code: string;
    execution_mode: 'monitor_only' | 'suggest' | 'auto';
    is_demo: boolean; status: string;
  };
  campaign: { id: string; name: string; is_demo: boolean } | null;
  objective: { code: string; required_metrics: string[] | null } | null;
  active_model: { model_version: string } | null;
}

interface DriftEvent { id: string; detected_at: string; postal_code: string | null; severity: string; }

const isoDate = (s: string): string => s.slice(0, 10);

const MODE_COLORS: Record<string, string> = {
  auto: '#3dffa0',
  suggest: '#f7b731',
  monitor_only: '#5b9bd5',
};

export function PilotageOverlay() {
  const [strategies, setStrategies] = useState<StrategyListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch('/api/bidding/strategies', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { strategies: [] })
      .then(d => {
        const list = (d.strategies ?? []) as StrategyListItem[];
        setStrategies(list);
        // Auto-select : démo en mode auto en priorité, sinon 1ère.
        const demoAuto = list.find(s => s.is_demo && s.execution_mode === 'auto');
        const fallback = demoAuto ?? list[0] ?? null;
        if (fallback) setSelectedId(fallback.id);
      })
      .catch(e => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div style={{ padding: 16, color: '#ff5757', fontSize: 12, fontFamily: fMono }}>
        Erreur : {error}
      </div>
    );
  }

  if (strategies === null) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary, #666)' }}>Chargement…</div>;
  }

  if (strategies.length === 0) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: fInter }}>
        <div style={{ width: 48, height: 48, margin: '0 auto 12px', borderRadius: 12, background: 'rgba(78,205,196,0.08)', border: '0.5px solid rgba(78,205,196,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ecdc4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l1.9 5.8L20 11l-5.8 1.9L12 19l-1.9-6.1L4 11l6.1-2.2z" />
            <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
          </svg>
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary, #f0f0f0)', marginBottom: 6 }}>
          Aucune stratégie de Custom Bidding active
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #a0a0a0)', lineHeight: 1.5, maxWidth: 360, margin: '0 auto' }}>
          Pour activer une stratégie, ouvrez une campagne DSP éligible depuis l&apos;icône Campagnes
          et cliquez sur « Activer Custom Bidding ».
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <StrategyPicker
        strategies={strategies}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {selectedId ? (
          <StrategyDetail key={selectedId} strategyId={selectedId} />
        ) : (
          <div style={{ padding: 20, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
            Sélectionner une stratégie pour afficher le détail.
          </div>
        )}
      </div>
    </div>
  );
}

function StrategyPicker({
  strategies, selectedId, onSelect,
}: {
  strategies: StrategyListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6,
      padding: '10px 12px',
      borderBottom: '0.5px solid rgba(255,255,255,0.08)',
    }}>
      {strategies.map(s => {
        const active = s.id === selectedId;
        const modeColor = MODE_COLORS[s.execution_mode] ?? '#a0a0a0';
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            title={`${s.dsp_campaigns?.name ?? ''} · ${s.name}`}
            style={{
              padding: '6px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
              background: active ? 'rgba(78,205,196,0.08)' : 'rgba(255,255,255,0.03)',
              color: active ? 'var(--brand-teal)' : 'var(--text-secondary)',
              border: `0.5px solid ${active ? 'var(--brand-teal)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 6, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            }}
          >
            <span>{s.dsp_campaigns?.name ?? s.name}</span>
            <span style={{ fontSize: 9, fontFamily: fMono, color: modeColor }}>{s.execution_mode}</span>
            {s.dsp_campaigns?.is_demo && (
              <span style={{ fontSize: 9, fontFamily: fMono, color: '#f7b731' }}>· demo</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function StrategyDetail({ strategyId }: { strategyId: string }) {
  const [meta, setMeta] = useState<StrategyMeta | null>(null);
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[] | null>(null);
  const [drifts, setDrifts] = useState<DriftEvent[]>([]);
  const [postalGeoJSON, setPostalGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        if (!metaRes.ok) throw new Error(`strategy: ${metaRes.status}`);
        if (!compRes.ok) throw new Error(`comparison: ${compRes.status}`);
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

  const allDates = useMemo(() => {
    if (!comparisonRows) return [] as string[];
    const set = new Set<string>();
    for (const r of comparisonRows) set.add(r.date);
    return [...set].sort();
  }, [comparisonRows]);

  const [currentIndex, setCurrentIndex] = useState(0);
  useEffect(() => { if (allDates.length > 0) setCurrentIndex(allDates.length - 1); }, [allDates.length]);
  const currentDate = allDates[currentIndex] ?? '';

  const daily: DailyComparison[] = useMemo(
    () => comparisonRows ? aggregateByDate(comparisonRows) : [],
    [comparisonRows],
  );

  const rowsCurrentDay = useMemo(
    () => comparisonRows && currentDate ? comparisonRows.filter(r => r.date === currentDate) : [],
    [comparisonRows, currentDate],
  );

  const globalKpis: GlobalKpis = useMemo(
    () => comparisonRows
      ? computeGlobalKpis(comparisonRows)
      : {
          total_leads_real: 0, total_leads_sim: 0,
          total_spend_real: 0, total_spend_sim: 0,
          total_impressions_real: 0, total_impressions_sim: 0,
          cpl_real: 0, cpl_sim: 0, cpl_delta_eur: 0,
          lift_pct: 0, leads_delta: 0, n_zones: 0, n_days: 0,
        },
    [comparisonRows],
  );

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
            impressions: z?.leads_sim ?? 0,
          },
        };
      }),
    };
  }, [postalGeoJSON, rowsCurrentDay]);

  const driftDates = useMemo(
    () => [...new Set(drifts.map(d => isoDate(d.detected_at)))],
    [drifts],
  );

  if (error) {
    return <div style={{ padding: 16, color: '#ff5757', fontSize: 12, fontFamily: fMono }}>{error}</div>;
  }
  if (!meta || !comparisonRows) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary, #666)' }}>Chargement…</div>;
  }

  const primaryMetric = (meta.objective?.required_metrics?.[0] ?? 'leads').toString();

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <StrategyHeader
        strategyId={strategyId}
        strategyName={meta.strategy.name}
        campaignName={meta.campaign?.name ?? 'Campagne inconnue'}
        isDemo={Boolean(meta.campaign?.is_demo)}
        algorithmCode={meta.strategy.algorithm_code}
        initialMode={meta.strategy.execution_mode}
        onActionResult={() => {
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

      <div style={{ padding: '12px 14px', fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)', borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
        Modèle de simulation linéaire (x_sim = x_real × bid_multiplier). Algorithme actif :
        {' '}<span style={{ color: 'var(--text-secondary)' }}>{meta.active_model?.model_version ?? meta.strategy.algorithm_code}</span>
      </div>
    </div>
  );
}
