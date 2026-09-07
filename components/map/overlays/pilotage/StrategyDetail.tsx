'use client';

/**
 * Vue détail d'une stratégie de custom bidding, embarquée dans l'overlay
 * Pilotage ML — extraite de PilotageOverlay.tsx (2026-09-07).
 *
 * Charge en parallèle le méta de la stratégie, les lignes de comparaison
 * témoin/traité, les dérives détectées et la géométrie des codes postaux,
 * puis dérive tout l'affichage par mémos : KPI globaux, jour courant, zones
 * ciblées, choroplèthe enrichie.
 *
 * Les composants lourds restent en `dynamic` : le mode simplifié ne doit pas
 * charger le JS des vues expertes.
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Eye, Wrench } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import {
  aggregateByDate, aggregateByZone, computeGlobalKpis,
  type ComparisonRow, type DailyComparison, type GlobalKpis,
} from '@/lib/bidding-ml/comparison';
import { computeTargetingKpis, selectTargetZones, type TargetingKpis } from '@/lib/bidding-ml/targeting-kpis';
import { resolvePrimaryMetric, resolveWeightingTarget, getMetricLabels } from '@/lib/bidding-ml/metric-labels';
import { useViewMode } from '@/lib/bidding-ml/use-view-mode';
import { StrategyHeader } from '@/app/custom-bidding/[strategyId]/_components/StrategyHeader';
import { HeroImpact } from '@/app/custom-bidding/[strategyId]/_components/HeroImpact';
import { AgentPanel } from '@/app/custom-bidding/[strategyId]/_components/AgentPanel';
import { CurveTranslator } from '@/app/custom-bidding/[strategyId]/_components/CurveTranslator';
import { fInter, fMono, isoDate, type DriftEvent, type StrategyMeta } from './shared';

// Lazy : composants lourds gated par mode (expert / target / temporal).
// Évite leur JS dans le bundle initial du mode simple.
const KpiDeltaCards = dynamic(
  () => import('@/app/custom-bidding/[strategyId]/_components/KpiDeltaCards').then(m => ({ default: m.KpiDeltaCards })),
  { ssr: false },
);
const RevealScatter = dynamic(
  () => import('@/app/custom-bidding/[strategyId]/_components/RevealScatter').then(m => ({ default: m.RevealScatter })),
  { ssr: false },
);
const AbstentionHistogram = dynamic(
  () => import('@/app/custom-bidding/[strategyId]/_components/AbstentionHistogram').then(m => ({ default: m.AbstentionHistogram })),
  { ssr: false },
);
const PlayControls = dynamic(
  () => import('@/app/custom-bidding/[strategyId]/_components/PlayControls').then(m => ({ default: m.PlayControls })),
  { ssr: false },
);
const ComparisonTimeline = dynamic(
  () => import('@/app/custom-bidding/[strategyId]/_components/ComparisonTimeline').then(m => ({ default: m.ComparisonTimeline })),
  { ssr: false },
);
const DualMap = dynamic(
  () => import('@/app/custom-bidding/[strategyId]/_components/DualMap').then(m => ({ default: m.DualMap })),
  { ssr: false },
);

export function StrategyDetail({
  strategyId, onEdit, onShowHistory,
}: {
  strategyId: string;
  onEdit: () => void;
  onShowHistory: () => void;
}) {
  const [meta, setMeta] = useState<StrategyMeta | null>(null);
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[] | null>(null);
  const [drifts, setDrifts] = useState<DriftEvent[]>([]);
  const [postalGeoJSON, setPostalGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const [insseValues, setInsseValues] = useState<Record<string, number> | null>(null);
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

        // Si la stratégie utilise une variable INSEE pour pondérer, on charge
        // les valeurs (ex: taux abstention par CP) pour outliner les zones
        // cibles et calculer les KPI de ciblage.
        const target = resolveWeightingTarget(
          m.strategy.weighting_mode,
          (m.strategy.in_zone_weights ?? null) as Record<string, unknown> | null,
        );
        if (target.variableCode) {
          const vRes = await adminFetch(
            `/api/insee-variables/${encodeURIComponent(target.variableCode)}/values`,
            { cache: 'no-store' },
          );
          if (!cancelled && vRes.ok) {
            const vJson = await vRes.json();
            setInsseValues((vJson?.values ?? {}) as Record<string, number>);
          } else if (!cancelled) {
            setInsseValues({});
          }
        } else {
          setInsseValues({});
        }
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

  // Métrique principale (impressions / clics / leads / spend), résolue depuis
  // bidding_objectives.required_metrics[0]. Pilote tout le wording UI.
  const primaryMetric = useMemo(
    () => resolvePrimaryMetric(meta?.objective?.required_metrics?.[0]),
    [meta],
  );

  // Cible métier (zones top-quartile sur la variable INSEE pondérante)
  const target = useMemo(
    () => meta ? resolveWeightingTarget(
      meta.strategy.weighting_mode,
      (meta.strategy.in_zone_weights ?? null) as Record<string, unknown> | null,
    ) : null,
    [meta],
  );

  const targetSet = useMemo<Set<string>>(() => {
    if (!insseValues || !target) return new Set();
    const { targetSet } = selectTargetZones(insseValues, target.highIsTarget);
    return targetSet;
  }, [insseValues, target]);

  const enrichedGeoJSON: GeoJSON.FeatureCollection | null = useMemo(() => {
    if (!postalGeoJSON) return null;
    const byZone = new Map(aggregateByZone(rowsCurrentDay).map(z => [z.postal_code, z]));
    return {
      type: 'FeatureCollection',
      features: postalGeoJSON.features.map(f => {
        const cp = String(f.properties?.code_postal ?? '');
        const z = byZone.get(cp);
        const leads_real = z?.leads_real ?? 0;
        const leads_sim = z?.leads_sim ?? 0;
        const spend_real = z?.spend_real ?? 0;
        const spend_sim = z?.spend_sim ?? 0;
        const impressions_real = z?.impressions_real ?? 0;
        const impressions_sim = z?.impressions_sim ?? 0;
        const clicks_real = z?.clicks_real ?? 0;
        const clicks_sim = z?.clicks_sim ?? 0;
        // La prop legacy `impressions` est lue par le hover de SyncMap.
        // On la peuple avec la valeur SIM de la métrique principale pour
        // que l'info-bulle reflète bien la métrique pilotée par la stratégie.
        const hoverValue = primaryMetric === 'spend' ? spend_sim
          : primaryMetric === 'clicks' ? clicks_sim
          : primaryMetric === 'leads' ? leads_sim
          : impressions_sim;
        return {
          ...f,
          properties: {
            ...(f.properties ?? {}),
            leads_real, leads_sim,
            spend_real, spend_sim,
            impressions_real, impressions_sim,
            clicks_real, clicks_sim,
            leads_delta: leads_sim - leads_real,
            spend_delta: spend_sim - spend_real,
            impressions_delta: impressions_sim - impressions_real,
            clicks_delta: clicks_sim - clicks_real,
            bid_multiplier: z?.bid_multiplier ?? 1.0,
            impressions: hoverValue,
            is_target: targetSet.has(cp),
          },
        };
      }),
    };
  }, [postalGeoJSON, rowsCurrentDay, targetSet, primaryMetric]);

  const driftDates = useMemo(
    () => [...new Set(drifts.map(d => isoDate(d.detected_at)))],
    [drifts],
  );

  // KPI de ciblage : calculés sur l'ensemble des rows (toutes dates), pas
  // seulement le jour courant. C'est le KPI cumulatif qui parle au pitch.
  const targetingKpis: TargetingKpis | null = useMemo(() => {
    if (!comparisonRows || !insseValues || !target?.variableCode) return null;
    if (Object.keys(insseValues).length === 0) return null;
    return computeTargetingKpis(comparisonRows, insseValues, primaryMetric, target.highIsTarget);
  }, [comparisonRows, insseValues, primaryMetric, target]);

  // Mode de vue (simple/expert) — déclaré AVANT tout early return pour respecter l'ordre des hooks.
  const view = useViewMode();
  const isExpert = view.mode === 'expert';

  if (error) {
    return <div style={{ padding: 16, color: '#ff5757', fontSize: 12, fontFamily: fMono }}>{error}</div>;
  }
  if (!meta || !comparisonRows) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary, #666)' }}>Chargement…</div>;
  }

  const labels = getMetricLabels(primaryMetric);
  const hasTarget = !!target?.variableCode && targetSet.size > 0;
  const isCompleted = meta.strategy.status === 'completed';
  // En vue simplifiée + campagne terminée : on masque les outils temporels
  // (slider date + courbes par jour) qui n'apportent rien à la lecture du bilan.
  const showTemporalTools = isExpert || !isCompleted;

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {/* Toggle vue simplifiée / expert — toujours visible en haut */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px',
        background: 'var(--bg-level-2)',
        borderBottom: '0.5px solid var(--border-subtle)',
        fontFamily: fInter,
      }}>
        <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Mode d&apos;affichage
        </span>
        <div style={{
          display: 'inline-flex', padding: 2, gap: 2,
          background: 'var(--bg-level-1)',
          border: '0.5px solid var(--border-subtle)',
          borderRadius: 5,
        }}>
          <button
            type="button"
            onClick={() => view.setMode('simple')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
              background: !isExpert ? 'var(--brand-teal)' : 'transparent',
              color: !isExpert ? 'var(--bg-level-0)' : 'var(--text-secondary)',
              border: 'none', borderRadius: 3, cursor: 'pointer',
            }}
          >
            <Eye size={11} strokeWidth={1.8} /> Vue simplifiée
          </button>
          <button
            type="button"
            onClick={() => view.setMode('expert')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
              background: isExpert ? 'var(--brand-teal)' : 'transparent',
              color: isExpert ? 'var(--bg-level-0)' : 'var(--text-secondary)',
              border: 'none', borderRadius: 3, cursor: 'pointer',
            }}
          >
            <Wrench size={11} strokeWidth={1.8} /> Vue expert
          </button>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)' }}>
          {isExpert
            ? "Tous les outils sont disponibles"
            : "Vue épurée pour lecture rapide du bilan"}
        </span>
      </div>

      <StrategyHeader
        strategyId={strategyId}
        strategyName={meta.strategy.name}
        campaignName={meta.campaign?.name ?? 'Campagne inconnue'}
        isDemo={Boolean(meta.campaign?.is_demo)}
        algorithmCode={meta.strategy.algorithm_code}
        initialMode={meta.strategy.execution_mode}
        status={meta.strategy.status}
        viewMode={view.mode}
        onEdit={onEdit}
        onShowHistory={onShowHistory}
        onActionResult={() => {
          setComparisonRows(null);
          adminFetch(`/api/bidding/strategies/${strategyId}/comparison`, { cache: 'no-store' })
            .then(r => r.json())
            .then(d => setComparisonRows((d.rows ?? []) as ComparisonRow[]))
            .catch(() => { /* feedback déjà visible dans header */ });
        }}
      />

      {meta.strategy.status === 'completed' && (
        <div style={{
          margin: '12px',
          padding: '8px 14px',
          background: 'var(--bg-level-2)',
          border: '0.5px solid var(--brand-teal)',
          borderLeft: '3px solid var(--brand-teal)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: fInter, fontSize: 11,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--brand-teal)' }} />
          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Campagne terminée</span>
          {meta.strategy.activated_at && meta.strategy.status_changed_at && (
            <span style={{ color: 'var(--text-tertiary)', fontFamily: fMono }}>
              {new Date(meta.strategy.activated_at).toLocaleDateString('fr-FR')} → {new Date(meta.strategy.status_changed_at).toLocaleDateString('fr-FR')}
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontFamily: fMono, fontSize: 10 }}>
            Bilan disponible dans l&apos;onglet « Bilan »
          </span>
        </div>
      )}

      {/* ── §1 Vue d'ensemble (macro) ─────────────────────────────────── */}
      <SectionDivider label="Vue d'ensemble" sub="L'impact de l'algo en un coup d'œil" />
      {targetingKpis && (
        <HeroImpact
          strategyId={strategyId}
          kpis={targetingKpis}
          daily={daily}
          targetLabel={target?.targetLabel ?? 'zones cibles'}
          variableLabel={target?.variableLabel ?? null}
          metric={primaryMetric}
        />
      )}

      {/* ── §2 Impact géographique (macro visuel) ────────────────────── */}
      <SectionDivider label="Impact géographique" sub="Où l'algo redéploie les impressions" />
      <DualMap
        geojson={enrichedGeoJSON}
        insseValues={insseValues}
        metric={primaryMetric}
        targetLabel={target?.targetLabel ?? 'zones cibles'}
        variableLabel={target?.variableLabel ?? null}
        currentDate={currentDate}
      />
      {hasTarget && insseValues && (
        <AbstentionHistogram
          geojson={enrichedGeoJSON}
          insseValues={insseValues}
          metric={primaryMetric}
          variableLabel={target?.variableLabel ?? null}
        />
      )}

      {/* ── §3 Stratégie & ajustements (semi-macro / explicatif) ─────── */}
      <SectionDivider label="Stratégie & ajustements" sub="Comment l'algo a traduit l'objectif" />
      <CurveTranslator
        strategyId={strategyId}
        objectiveLabel={meta.objective?.display_name_fr ?? meta.objective?.display_name ?? meta.strategy.objective_code}
        variableLabel={target?.variableLabel ?? null}
        algorithmCode={meta.strategy.algorithm_code}
        initPresetCode={meta.strategy.init_preset_code ?? null}
        viewMode={view.mode}
      />

      {/* ── §4 Détails experts (micro / temporal) ────────────────────── */}
      {(isExpert || showTemporalTools) && (
        <SectionDivider label="Détails experts" sub="Métriques fines, courbes temporelles, preuve statistique" />
      )}
      {isExpert && (
        <KpiDeltaCards
          kpis={globalKpis}
          primaryMetric={primaryMetric}
          targetingKpis={targetingKpis}
          targetLabel={target?.targetLabel ?? 'zones cibles'}
        />
      )}
      {showTemporalTools && (
        <PlayControls
          dates={allDates}
          currentIndex={currentIndex}
          driftDates={driftDates}
          onIndexChange={setCurrentIndex}
        />
      )}
      {showTemporalTools && (
        <ComparisonTimeline
          daily={daily}
          currentDate={currentDate}
          driftDates={driftDates}
          metric={primaryMetric}
        />
      )}
      {isExpert && targetingKpis && hasTarget && insseValues && (
        <RevealScatter
          rows={comparisonRows}
          insseValues={insseValues}
          metric={primaryMetric}
          variableLabel={target?.variableLabel ?? null}
        />
      )}

      {/* ── §5 Pilotage agent (action / micro) ───────────────────────── */}
      <SectionDivider label="Pilotage agent" sub="Recommandations, drifts, journal" />
      {/* AgentPanel placé en fin de flux narratif (conclusion = bilan + journal) */}
      <AgentPanel
        strategyId={strategyId}
        isCompleted={isCompleted}
        viewMode={view.mode}
        onApplied={() => {
          setComparisonRows(null);
          adminFetch(`/api/bidding/strategies/${strategyId}/comparison`, { cache: 'no-store' })
            .then(r => r.json())
            .then(d => setComparisonRows((d.rows ?? []) as ComparisonRow[]))
            .catch(() => { /* feedback déjà visible */ });
        }}
      />

      <div style={{ padding: '12px 14px', fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)', borderTop: '0.5px solid var(--border-subtle)' }}>
        Métrique principale : <span style={{ color: 'var(--text-secondary)' }}>{labels.name.toLowerCase()}</span>
        {target?.variableLabel && (
          <> · cible : <span style={{ color: 'var(--text-secondary)' }}>{target.variableLabel}</span></>
        )}
        {' · '}algo : <span style={{ color: 'var(--text-secondary)' }}>{meta.active_model?.model_version ?? meta.strategy.algorithm_code}</span>
      </div>
    </div>
  );
}

/**
 * Compartimentation visuelle macro→micro : bandeau plein, dot teal, label +
 * sous-titre court. Pas un composant interactif — juste un séparateur narratif
 * pour rythmer la page Pilotage ML.
 */
function SectionDivider({ label, sub }: { label: string; sub?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: '14px 14px 6px',
        marginTop: 8,
        borderTop: '0.5px solid var(--border-subtle)',
        background: 'var(--bg-level-1)',
        fontFamily: fInter,
      }}
    >
      <span
        style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--brand-teal)',
          alignSelf: 'center',
        }}
      />
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
        {label}
      </span>
      {sub && (
        <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
          — {sub}
        </span>
      )}
    </div>
  );
}
