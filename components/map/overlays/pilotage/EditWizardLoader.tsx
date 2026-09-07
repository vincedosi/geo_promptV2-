'use client';

/**
 * Chargeur du wizard en mode édition — extrait de PilotageOverlay.tsx
 * (2026-09-07).
 *
 * Récupère la stratégie complète, la retourne au format brouillon attendu par
 * <StrategyWizard>, puis monte le wizard sur les données rechargées.
 */

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { StrategyWizard } from '@/app/strategies/_components/StrategyWizard';
import type {
  AlertSeverity, AttributionModel, ExecutionMode as WizExecutionMode,
  InventoryType, PacingStrategy, ScopeType, Subzone,
  WeightingMode, WizardDraftData,
} from '@/lib/strategy-wizard/types';
import { fMono } from './shared';

export interface StrategyDetailFull {
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

export function EditWizardLoader({ strategyId, onCompleted }: { strategyId: string; onCompleted: (id: string) => void }) {
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

