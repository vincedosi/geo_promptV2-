'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { logger } from '@/lib/logger';
import { useStrategyDraftAutosave } from '@/lib/strategy-wizard/useStrategyDraftAutosave';
import type {
  WizardDraftData, IdentityStep, GeographyStep, ObjectiveStep, BudgetStep, MLAgentStep, InitPreset,
} from '@/lib/strategy-wizard/types';
import { WizardStepper } from './WizardStepper';
import { WizardActions } from './WizardActions';
import { Step1Identity } from './steps/Step1Identity';
import { Step2Geography } from './steps/Step2Geography';
import { Step3Objective } from './steps/Step3Objective';
import { Step4Budget } from './steps/Step4Budget';
import { Step5MLAgent } from './steps/Step5MLAgent';
import { Step6Recap } from './steps/Step6Recap';

interface Props {
  campaignId: string;
  campaignName?: string;
  consumeDraftId?: string;
  initialDraft?: { current_step: number; draft_data: WizardDraftData };
  mode?: 'create' | 'edit';
  strategyId?: string;
}

const TOTAL_STEPS = 5;

function defaultData(campaignName?: string): WizardDraftData {
  return {
    identity: {
      name: campaignName ? `Pilotage ML — ${campaignName}` : '',
      inventory_type: 'display',
    },
    geography: {
      scope_type: 'national',
      zone_id: null,
      weighting_mode: 'uniform',
      in_zone_weights: { mode: 'uniform', value: 1.5 },
      out_zone_weights: { mode: 'uniform', value: 0.7 },
    },
    objective: {},
    budget: { currency: 'EUR' },
    mlagent: {
      algorithm_code: 'hoeffding_adaptive_tree',
      execution_mode: 'suggest',
      init_preset_code: 'boost_light',
      notification_channels: ['in_app'],
      alert_severity_threshold: 'medium',
    },
  };
}

export function StrategyWizard({ campaignId, campaignName, consumeDraftId, initialDraft, mode = 'create', strategyId }: Props) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(initialDraft?.current_step ?? 1);
  const [draftData, setDraftData] = useState<WizardDraftData>(
    initialDraft?.draft_data ?? defaultData(campaignName),
  );
  const [isRecap, setIsRecap] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Autosave (only en mode create)
  const { isSaving, lastSavedAt, error: saveError } = useStrategyDraftAutosave({
    campaignId,
    currentStep,
    draftData,
    enabled: mode === 'create',
  });

  const completedSteps = useMemo(() => {
    const s = new Set<number>();
    if (draftData.identity?.name && draftData.identity?.inventory_type && draftData.identity?.start_date && draftData.identity?.end_date) s.add(1);
    if (draftData.geography?.scope_type && (draftData.geography.scope_type === 'national' || draftData.geography.zone_id)) s.add(2);
    if (draftData.objective?.objective_code) s.add(3);
    if (draftData.budget?.total_budget) s.add(4);
    if (draftData.mlagent?.execution_mode) s.add(5);
    return s;
  }, [draftData]);

  const updateStep = useCallback(<K extends keyof WizardDraftData>(key: K, value: WizardDraftData[K]) => {
    setDraftData(prev => ({ ...prev, [key]: value }));
  }, []);

  const handlePresetApply = useCallback((preset: InitPreset) => {
    setDraftData(prev => ({
      ...prev,
      mlagent: { ...prev.mlagent, init_preset_code: preset.code },
      geography: {
        ...(prev.geography ?? {
          scope_type: 'national', zone_id: null, weighting_mode: 'uniform',
          in_zone_weights: {}, out_zone_weights: {},
        }),
        weighting_mode: 'uniform',
        in_zone_weights: { mode: 'uniform', value: preset.in_zone_multiplier },
        out_zone_weights: preset.out_zone_multiplier === 0
          ? { mode: 'exclusion' }
          : { mode: 'uniform', value: preset.out_zone_multiplier },
      },
    }));
  }, []);

  const onPrev = () => {
    if (isRecap) { setIsRecap(false); return; }
    setCurrentStep(s => Math.max(1, s - 1));
  };

  const onNext = () => {
    if (currentStep === TOTAL_STEPS) {
      setIsRecap(true);
      return;
    }
    setCurrentStep(s => Math.min(TOTAL_STEPS, s + 1));
  };

  const onStepClick = (step: number) => {
    setIsRecap(false);
    setCurrentStep(step);
  };

  const onActivate = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const payload = buildPayload(campaignId, draftData, consumeDraftId);
      if (mode === 'edit' && strategyId) {
        const res = await adminFetch(`/api/bidding/strategies/${strategyId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        router.push(`/custom-bidding/${strategyId}`);
      } else {
        const res = await adminFetch('/api/bidding/strategies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        if (!j.strategy?.id) throw new Error('Réponse invalide : pas de strategy.id');
        router.push(`/custom-bidding/${j.strategy.id}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('strategy-wizard', `activation failed: ${msg}`);
      setSubmitError(msg);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#050505] text-[#f0f0f0]">
      <header className="border-b border-[#1a1a1a] px-4">
        <WizardStepper
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={onStepClick}
        />
      </header>

      <main className="flex-1 overflow-auto p-6">
        {!isRecap && currentStep === 1 && (
          <Step1Identity
            data={draftData.identity ?? {}}
            onChange={(v: IdentityStep) => updateStep('identity', v)}
          />
        )}
        {!isRecap && currentStep === 2 && (
          <Step2Geography
            data={draftData.geography ?? defaultData().geography!}
            onChange={(v: GeographyStep) => updateStep('geography', v)}
          />
        )}
        {!isRecap && currentStep === 3 && (
          <Step3Objective
            data={draftData.objective ?? {}}
            onChange={(v: ObjectiveStep) => updateStep('objective', v)}
          />
        )}
        {!isRecap && currentStep === 4 && (
          <Step4Budget
            data={draftData.budget ?? {}}
            onChange={(v: BudgetStep) => updateStep('budget', v)}
          />
        )}
        {!isRecap && currentStep === 5 && (
          <Step5MLAgent
            data={draftData.mlagent ?? {}}
            onChange={(v: MLAgentStep) => updateStep('mlagent', v)}
            onPresetApply={handlePresetApply}
          />
        )}
        {isRecap && (
          <Step6Recap
            data={draftData}
            onJumpToStep={(s) => { setIsRecap(false); setCurrentStep(s); }}
          />
        )}

        {submitError && (
          <div className="mt-4 max-w-2xl text-xs text-[#ff5757] bg-[rgba(255,87,87,0.1)] border border-[rgba(255,87,87,0.2)] rounded-md p-3">
            Erreur : {submitError}
          </div>
        )}
      </main>

      <WizardActions
        currentStep={currentStep}
        totalSteps={TOTAL_STEPS}
        isRecap={isRecap}
        isSubmitting={isSubmitting}
        isSaving={isSaving}
        lastSavedAt={lastSavedAt}
        saveError={saveError}
        onPrev={onPrev}
        onNext={onNext}
        onActivate={isRecap ? onActivate : undefined}
      />
    </div>
  );
}

function buildPayload(campaignId: string, d: WizardDraftData, consumeDraftId?: string): Record<string, unknown> {
  const id = d.identity ?? {};
  const geo = d.geography;
  const obj = d.objective ?? {};
  const bud = d.budget ?? {};
  const ml = d.mlagent ?? {};

  return {
    campaign_id: campaignId,
    name: id.name,
    advertiser: id.advertiser,
    brand: id.brand,
    internal_reference: id.internal_reference,
    inventory_type: id.inventory_type,
    start_date: id.start_date,
    end_date: id.end_date,

    scope_type: geo?.scope_type ?? 'national',
    zone_id: geo?.zone_id ?? null,
    weighting_mode: geo?.weighting_mode ?? 'uniform',
    in_zone_weights: geo?.in_zone_weights ?? {},
    out_zone_weights: geo?.out_zone_weights ?? {},
    subzones: geo?.subzones,

    algorithm_code: ml.algorithm_code ?? obj.algorithm_code ?? 'hoeffding_adaptive_tree',
    objective_code: obj.objective_code,
    kpi_target: obj.kpi_target,
    kpi_secondary: obj.kpi_secondary,
    attribution_model: obj.attribution_model,

    total_budget: bud.total_budget,
    currency: bud.currency ?? 'EUR',
    daily_budget_max: bud.daily_budget_max,
    pacing_strategy: bud.pacing_strategy,
    dsp_external_id: bud.dsp_external_id,
    forecast_cpm: bud.forecast_cpm,
    frequency_cap_imps: bud.frequency_cap_imps,
    frequency_cap_period_days: bud.frequency_cap_period_days,

    execution_mode: ml.execution_mode ?? 'suggest',
    init_preset_code: ml.init_preset_code,
    agent_autonomy_override: ml.agent_autonomy_override,
    notification_channels: ml.notification_channels,
    alert_severity_threshold: ml.alert_severity_threshold,

    consume_draft_id: consumeDraftId,
  };
}
