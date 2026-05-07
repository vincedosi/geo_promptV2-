'use client';

/**
 * Overlay Pilotage ML — module Custom Bidding 100% inline dans /map.
 *
 * State machine 3 vues (aucune navigation hors /map) :
 *   • view = 'list'    → liste des stratégies + détail (StrategyHeader, KPI, Choro, Timeline)
 *   • view = 'wizard'  → embarque <StrategyWizard> (création OU édition selon mode/strategyId)
 *   • view = 'history' → audit trail inline via <StrategyHistoryView>
 *
 * Préouverture par query params (lus dans app/map/page.tsx et passés via initialAction) :
 *   • ?overlay=pilotage&action=new&campaign=<id>[&draft=<id>]
 *   • ?overlay=pilotage&action=edit&strategy=<id>
 *   • ?overlay=pilotage&action=history&strategy=<id>
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import {
  aggregateByDate, aggregateByZone, computeGlobalKpis,
  type ComparisonRow, type DailyComparison, type GlobalKpis,
} from '@/lib/bidding-ml/comparison';
import { computeTargetingKpis, selectTargetZones, type TargetingKpis } from '@/lib/bidding-ml/targeting-kpis';
import { resolvePrimaryMetric, resolveWeightingTarget, getMetricLabels } from '@/lib/bidding-ml/metric-labels';
import { StrategyHeader } from '@/app/custom-bidding/[strategyId]/_components/StrategyHeader';
import { HeroImpact } from '@/app/custom-bidding/[strategyId]/_components/HeroImpact';
import { AgentPanel } from '@/app/custom-bidding/[strategyId]/_components/AgentPanel';
import { CurveTranslator } from '@/app/custom-bidding/[strategyId]/_components/CurveTranslator';
import { useViewMode } from '@/lib/bidding-ml/use-view-mode';
import { Eye, Wrench } from 'lucide-react';

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
import { StrategyWizard } from '@/app/strategies/_components/StrategyWizard';
import { StrategyHistoryView } from '@/app/strategies/_components/StrategyHistoryView';
import type { WizardDraftData, ScopeType, WeightingMode, InventoryType, AttributionModel, PacingStrategy, ExecutionMode as WizExecutionMode, AlertSeverity, Subzone } from '@/lib/strategy-wizard/types';

const DualMap = dynamic(
  () => import('@/app/custom-bidding/[strategyId]/_components/DualMap').then(m => ({ default: m.DualMap })),
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
    weighting_mode?: string | null;
    in_zone_weights?: Record<string, unknown> | null;
    activated_at?: string | null;
    status_changed_at?: string | null;
    init_preset_code?: string | null;
  };
  campaign: { id: string; name: string; is_demo: boolean } | null;
  objective: { code: string; required_metrics: string[] | null; display_name_fr?: string | null; display_name?: string | null } | null;
  active_model: { model_version: string } | null;
}

interface DriftEvent { id: string; detected_at: string; postal_code: string | null; severity: string; }

const isoDate = (s: string): string => s.slice(0, 10);

const MODE_COLORS: Record<string, string> = {
  auto: '#3dffa0',
  suggest: '#f7b731',
  monitor_only: '#5b9bd5',
};

interface CampaignLite { id: string; name: string; dsp_source: string }

export type PilotageInitialAction =
  | { type: 'new'; campaignId: string; draftId?: string }
  | { type: 'edit'; strategyId: string }
  | { type: 'history'; strategyId: string };

type View =
  | { kind: 'list' }
  | { kind: 'wizard'; mode: 'create'; campaignId: string; campaignName?: string; draftId?: string }
  | { kind: 'wizard'; mode: 'edit'; strategyId: string }
  | { kind: 'history'; strategyId: string };

interface Props {
  /** Action initiale lue depuis ?action=... dans l'URL au moment de l'ouverture de l'overlay. */
  initialAction?: PilotageInitialAction | null;
  /** Callback appelé après consommation de l'action initiale (le parent peut nettoyer l'URL). */
  onActionConsumed?: () => void;
}

export function PilotageOverlay({ initialAction, onActionConsumed }: Props = {}) {
  const [strategies, setStrategies] = useState<StrategyListItem[] | null>(null);
  const [eligibleCampaigns, setEligibleCampaigns] = useState<CampaignLite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCampaignPicker, setShowCampaignPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    Promise.all([
      adminFetch('/api/bidding/strategies', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : { strategies: [] }),
      adminFetch('/api/digital/campaigns', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : []),
    ]).then(([sResp, cResp]) => {
      const list = (sResp.strategies ?? []) as StrategyListItem[];
      setStrategies(list);
      // /api/digital/campaigns renvoie un tableau direct (pas { campaigns: [...] }) ;
      // on supporte les deux formes pour rester robuste.
      const camps = (Array.isArray(cResp) ? cResp : (cResp?.campaigns ?? [])) as CampaignLite[];
      setEligibleCampaigns(camps.filter(c => (c.dsp_source ?? '').toLowerCase() !== 'adform'));
      const demoAuto = list.find(s => s.is_demo && s.execution_mode === 'auto');
      const fallback = demoAuto ?? list[0] ?? null;
      if (fallback) setSelectedId(fallback.id);
    }).catch(e => setError(String(e)));
  }, [refreshKey]);

  // Consomme initialAction une fois les listes chargées
  useEffect(() => {
    if (!initialAction || strategies === null) return;
    if (initialAction.type === 'new') {
      const camp = eligibleCampaigns.find(c => c.id === initialAction.campaignId);
      setView({
        kind: 'wizard', mode: 'create',
        campaignId: initialAction.campaignId,
        campaignName: camp?.name,
        draftId: initialAction.draftId,
      });
    } else if (initialAction.type === 'edit') {
      setView({ kind: 'wizard', mode: 'edit', strategyId: initialAction.strategyId });
    } else if (initialAction.type === 'history') {
      setView({ kind: 'history', strategyId: initialAction.strategyId });
    }
    onActionConsumed?.();
  }, [initialAction, strategies, eligibleCampaigns, onActionConsumed]);

  const handleCreateNew = (campaignId: string) => {
    setShowCampaignPicker(false);
    const camp = eligibleCampaigns.find(c => c.id === campaignId);
    setView({ kind: 'wizard', mode: 'create', campaignId, campaignName: camp?.name });
  };

  const handleEdit = (strategyId: string) => {
    setView({ kind: 'wizard', mode: 'edit', strategyId });
  };

  const handleShowHistory = (strategyId: string) => {
    setView({ kind: 'history', strategyId });
  };

  const handleBackToList = () => {
    setView({ kind: 'list' });
  };

  const handleWizardCompleted = (strategyId: string) => {
    setSelectedId(strategyId);
    setView({ kind: 'list' });
    setRefreshKey(k => k + 1);
  };

  if (error) {
    return (
      <div style={{ padding: 16, color: 'var(--danger)', fontSize: 12, fontFamily: fMono }}>
        Erreur : {error}
      </div>
    );
  }

  if (strategies === null) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary)' }}>Chargement…</div>;
  }

  // Vue Wizard (create ou edit)
  if (view.kind === 'wizard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <BackBar
          label={view.mode === 'create' ? 'Nouvelle stratégie' : 'Éditer la stratégie'}
          subtitle={view.mode === 'create' ? view.campaignName : undefined}
          onBack={handleBackToList}
        />
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {view.mode === 'create' ? (
            <CreateWizardLoader
              campaignId={view.campaignId}
              campaignName={view.campaignName}
              draftId={view.draftId}
              onCompleted={handleWizardCompleted}
            />
          ) : (
            <EditWizardLoader
              strategyId={view.strategyId}
              onCompleted={handleWizardCompleted}
            />
          )}
        </div>
      </div>
    );
  }

  // Vue Historique
  if (view.kind === 'history') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <BackBar label="Historique de la stratégie" onBack={handleBackToList} />
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <StrategyHistoryView strategyId={view.strategyId} />
        </div>
      </div>
    );
  }

  // Vue Liste (état initial)
  if (strategies.length === 0) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: fInter }}>
        <div style={{
          width: 48, height: 48, margin: '0 auto 12px', borderRadius: 12,
          background: 'var(--brand-teal-10)',
          border: '0.5px solid var(--brand-teal-30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: 'var(--brand-teal)' }}>
            <path d="M12 3l1.9 5.8L20 11l-5.8 1.9L12 19l-1.9-6.1L4 11l6.1-2.2z" />
            <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
          </svg>
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
          Aucune stratégie de Custom Bidding active
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, maxWidth: 360, margin: '0 auto 16px' }}>
          Configurez votre première stratégie ML pour une campagne DSP éligible (TTD, DV360, Meta…).
        </div>

        {eligibleCampaigns.length > 0 ? (
          <button
            onClick={() => setShowCampaignPicker(true)}
            style={{
              padding: '8px 16px', fontSize: 12, fontFamily: fInter, fontWeight: 500,
              background: 'var(--brand-teal)', color: 'var(--bg-level-0)',
              border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            + Nouvelle stratégie
          </button>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            Aucune campagne DSP éligible disponible. Importez une campagne TTD/DV360/Meta dans Admin → Campagnes.
          </div>
        )}

        {showCampaignPicker && (
          <CampaignPicker
            campaigns={eligibleCampaigns}
            onPick={handleCreateNew}
            onClose={() => setShowCampaignPicker(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <StrategyPicker
        strategies={strategies}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreateNew={() => setShowCampaignPicker(true)}
      />
      {showCampaignPicker && (
        <CampaignPicker
          campaigns={eligibleCampaigns}
          onPick={handleCreateNew}
          onClose={() => setShowCampaignPicker(false)}
        />
      )}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {selectedId ? (
          <StrategyDetail
            key={selectedId}
            strategyId={selectedId}
            onEdit={() => handleEdit(selectedId)}
            onShowHistory={() => handleShowHistory(selectedId)}
          />
        ) : (
          <div style={{ padding: 20, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
            Sélectionner une stratégie pour afficher le détail.
          </div>
        )}
      </div>
    </div>
  );
}

function BackBar({ label, subtitle, onBack }: { label: string; subtitle?: string; onBack: () => void }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: '0.5px solid var(--border-subtle)',
        background: 'var(--bg-level-1)',
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '4px 8px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
          background: 'transparent', color: 'var(--text-secondary)',
          border: '0.5px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand-teal)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
      >
        <ChevronLeft size={12} strokeWidth={1.5} />
        Retour
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', fontFamily: fInter, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fInter, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateWizardLoader({
  campaignId, campaignName, draftId, onCompleted,
}: {
  campaignId: string;
  campaignName?: string;
  draftId?: string;
  onCompleted: (strategyId: string) => void;
}) {
  const [initialDraft, setInitialDraft] = useState<{ current_step: number; draft_data: WizardDraftData } | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftId) {
      setLoaded(true);
      return;
    }
    adminFetch(`/api/bidding/strategies/drafts/${draftId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j?.draft) {
          setInitialDraft({
            current_step: j.draft.current_step,
            draft_data: j.draft.draft_data,
          });
        }
        setLoaded(true);
      })
      .catch(e => {
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      });
  }, [draftId]);

  if (!loaded) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary)' }}>Chargement du brouillon…</div>;
  }
  if (loadError) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--danger)' }}>Erreur draft : {loadError}</div>;
  }
  return (
    <StrategyWizard
      campaignId={campaignId}
      campaignName={campaignName}
      consumeDraftId={draftId}
      initialDraft={initialDraft}
      mode="create"
      onCompleted={onCompleted}
    />
  );
}

interface StrategyDetailFull {
  strategy: {
    id: string;
    campaign_id: string;
    name: string;
    description: string | null;
    advertiser: string | null;
    brand: string | null;
    internal_reference: string | null;
    inventory_type: InventoryType | null;
    start_date: string | null;
    end_date: string | null;
    scope_type: ScopeType;
    zone_id: string | null;
    weighting_mode: WeightingMode;
    in_zone_weights: Record<string, unknown>;
    out_zone_weights: Record<string, unknown>;
    algorithm_code: string;
    objective_code: string;
    kpi_target: number | null;
    kpi_secondary: string[] | null;
    attribution_model: AttributionModel | null;
    total_budget: number | null;
    currency: string;
    daily_budget_max: number | null;
    pacing_strategy: PacingStrategy | null;
    dsp_external_id: string | null;
    forecast_cpm: number | null;
    frequency_cap_imps: number | null;
    frequency_cap_period_days: number | null;
    execution_mode: WizExecutionMode;
    init_preset_code: string | null;
    notification_channels: string[] | null;
    alert_severity_threshold: AlertSeverity | null;
  };
  campaign: { id: string; name: string; dsp_source: string } | null;
  subzones: Subzone[];
  agent_autonomy_override: number | null;
}

function EditWizardLoader({ strategyId, onCompleted }: { strategyId: string; onCompleted: (id: string) => void }) {
  const [data, setData] = useState<StrategyDetailFull | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch(`/api/bidding/strategies/${strategyId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => setData(j as StrategyDetailFull))
      .catch(e => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [strategyId]);

  if (loadError) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--danger)' }}>Erreur : {loadError}</div>;
  }
  if (!data) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary)' }}>Chargement de la stratégie…</div>;
  }

  const s = data.strategy;
  const initialDraft: { current_step: number; draft_data: WizardDraftData } = {
    current_step: 1,
    draft_data: {
      identity: {
        name: s.name,
        description: s.description ?? undefined,
        advertiser: s.advertiser ?? undefined,
        brand: s.brand ?? undefined,
        internal_reference: s.internal_reference ?? undefined,
        inventory_type: s.inventory_type ?? undefined,
        start_date: s.start_date ?? undefined,
        end_date: s.end_date ?? undefined,
      },
      geography: {
        scope_type: s.scope_type,
        zone_id: s.zone_id,
        weighting_mode: s.weighting_mode,
        in_zone_weights: s.in_zone_weights ?? {},
        out_zone_weights: s.out_zone_weights ?? {},
        subzones: data.subzones,
      },
      objective: {
        algorithm_code: s.algorithm_code,
        objective_code: s.objective_code,
        kpi_target: s.kpi_target ?? undefined,
        kpi_secondary: s.kpi_secondary ?? undefined,
        attribution_model: s.attribution_model ?? undefined,
      },
      budget: {
        total_budget: s.total_budget ?? undefined,
        currency: s.currency,
        daily_budget_max: s.daily_budget_max ?? undefined,
        pacing_strategy: s.pacing_strategy ?? undefined,
        dsp_external_id: s.dsp_external_id ?? undefined,
        forecast_cpm: s.forecast_cpm ?? undefined,
        frequency_cap_imps: s.frequency_cap_imps ?? undefined,
        frequency_cap_period_days: s.frequency_cap_period_days ?? undefined,
      },
      mlagent: {
        algorithm_code: s.algorithm_code,
        execution_mode: s.execution_mode,
        init_preset_code: s.init_preset_code ?? undefined,
        agent_autonomy_override: data.agent_autonomy_override as 0 | 1 | 2 | 3 | 4 | null,
        notification_channels: s.notification_channels ?? undefined,
        alert_severity_threshold: s.alert_severity_threshold ?? undefined,
      },
    },
  };

  return (
    <StrategyWizard
      campaignId={s.campaign_id}
      campaignName={data.campaign?.name}
      initialDraft={initialDraft}
      mode="edit"
      strategyId={s.id}
      onCompleted={onCompleted}
    />
  );
}

function CampaignPicker({
  campaigns, onPick, onClose,
}: { campaigns: CampaignLite[]; onPick: (id: string) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<string>(campaigns[0]?.id ?? '');
  const selectedCamp = campaigns.find(c => c.id === selected);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-level-1)',
          border: '0.5px solid var(--border-subtle)',
          borderRadius: 8, padding: 16, width: 'min(440px, 90%)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4, fontFamily: fInter }}>
          Choisir la campagne DSP
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, fontFamily: fInter }}>
          La nouvelle stratégie sera attachée à cette campagne (Adform exclu).
        </div>

        {campaigns.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: 12 }}>
            Aucune campagne DSP éligible.
          </div>
        ) : (
          <>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fInter, marginBottom: 6 }}>
              Campagne
            </label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', fontSize: 13, fontFamily: fInter,
                background: 'var(--bg-level-2)', color: 'var(--text-primary)',
                border: '0.5px solid var(--border-subtle)', borderRadius: 6,
                outline: 'none', cursor: 'pointer',
              }}
            >
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} — {(c.dsp_source ?? '').toUpperCase()}
                </option>
              ))}
            </select>
            {selectedCamp && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fMono, marginTop: 8 }}>
                source : <span style={{ color: 'var(--text-secondary)' }}>{(selectedCamp.dsp_source ?? '').toUpperCase()}</span>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 12px', fontSize: 11, fontFamily: fInter,
              background: 'transparent', color: 'var(--text-tertiary)',
              border: '0.5px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            disabled={!selected}
            onClick={() => selected && onPick(selected)}
            style={{
              padding: '6px 14px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
              background: selected ? 'var(--brand-teal)' : 'var(--bg-level-2)',
              color: selected ? 'var(--bg-level-0)' : 'var(--text-tertiary)',
              border: 'none', borderRadius: 6,
              cursor: selected ? 'pointer' : 'not-allowed',
            }}
          >
            Continuer
          </button>
        </div>
      </div>
    </div>
  );
}

function StrategyPicker({
  strategies, selectedId, onSelect, onCreateNew,
}: {
  strategies: StrategyListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fermer le dropdown sur clic extérieur
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = strategies.find(s => s.id === selectedId) ?? null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px',
        borderBottom: '0.5px solid var(--border-subtle)',
      }}
    >
      <label style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)', textTransform: 'lowercase' }}>
        stratégie
      </label>

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', fontSize: 12, fontFamily: fInter, fontWeight: 500,
          background: 'var(--bg-level-2, #111)',
          color: 'var(--text-primary)',
          border: `0.5px solid ${open ? 'rgba(78,205,196,0.5)' : 'var(--border-subtle)'}`,
          borderRadius: 6, cursor: 'pointer', textAlign: 'left',
        }}
      >
        {selected ? <SelectedRow s={selected} /> : <span style={{ color: 'var(--text-tertiary)' }}>Sélectionner une stratégie…</span>}
        <ChevronDown size={14} strokeWidth={1.5} style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }} />
      </button>

      <button
        onClick={onCreateNew}
        style={{
          padding: '8px 12px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
          background: 'transparent', color: 'var(--brand-teal)',
          border: '0.5px solid var(--brand-teal)', borderRadius: 6, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        + Nouvelle
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 12, right: 12,
            zIndex: 40,
            background: 'var(--bg-level-1, #0a0a0a)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 8,
            maxHeight: 360, overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {strategies.length === 0 ? (
            <div style={{ padding: 12, fontSize: 11, fontFamily: fInter, color: 'var(--text-tertiary)' }}>
              Aucune stratégie disponible.
            </div>
          ) : strategies.map(s => {
            const active = s.id === selectedId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { onSelect(s.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '10px 12px', fontSize: 12, fontFamily: fInter,
                  background: active ? 'rgba(78,205,196,0.06)' : 'transparent',
                  color: 'var(--text-primary)',
                  border: 'none', borderBottom: '0.5px solid var(--border-subtle)',
                  cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-level-2, #111)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <SelectedRow s={s} />
                {active && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--brand-teal)', fontFamily: fMono }}>actif</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SelectedRow({ s }: { s: StrategyListItem }) {
  const modeColor = MODE_COLORS[s.execution_mode] ?? 'var(--text-secondary)';
  const campaignName = s.dsp_campaigns?.name ?? s.name;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {campaignName}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: fMono, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.algorithm_code} · {s.name}
        </div>
      </div>
      <span style={{
        fontSize: 9, fontFamily: fMono, color: modeColor,
        padding: '2px 6px', background: `${modeColor}1a`,
        border: `0.5px solid ${modeColor}40`, borderRadius: 4,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {s.execution_mode}
      </span>
      {s.dsp_campaigns?.is_demo && (
        <span style={{
          fontSize: 9, fontFamily: fMono, color: 'var(--warning, #f7b731)',
          padding: '2px 6px', background: 'rgba(247,183,49,0.1)',
          border: '0.5px solid rgba(247,183,49,0.3)', borderRadius: 4,
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          demo
        </span>
      )}
    </div>
  );
}

function StrategyDetail({
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
          Mode d'affichage
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
