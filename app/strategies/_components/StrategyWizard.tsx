'use client';

import { useCallback, useMemo, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { logger } from '@/lib/logger';
import { useStrategyDraftAutosave } from '@/lib/strategy-wizard/useStrategyDraftAutosave';
import type {
  WizardDraftData, IdentityStep, GeographyStep, ObjectiveStep, BudgetStep, MLAgentStep, InitPreset,
} from '@/lib/strategy-wizard/types';
import { humanizeActivationError, type ZodIssue } from '@/lib/strategy-wizard/error-mapping';
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
  onCompleted?: (strategyId: string) => void;
  /**
   * Quand `true`, le wizard est monté à l'intérieur d'un shell hôte (ex. le cockpit
   * campagne) qui affiche déjà sa propre navigation d'étapes (FilAriane) : ne pas
   * rendre le <WizardStepper> interne pour éviter un double stepper empilé.
   * Le contenu d'étape + le footer Précédent/Suivant restent inchangés.
   * Défaut `false` → comportement identique à l'existant (overlay carte
   * CreateWizardLoader/EditWizardLoader non concernés).
   */
  embedded?: boolean;
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

export function StrategyWizard({ campaignId, campaignName, consumeDraftId, initialDraft, mode = 'create', strategyId, onCompleted, embedded = false }: Props) {
  const [currentStep, setCurrentStep] = useState(initialDraft?.current_step ?? 1);
  const [draftData, setDraftData] = useState<WizardDraftData>(
    initialDraft?.draft_data ?? defaultData(campaignName),
  );
  const [isRecap, setIsRecap] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{
    summary: string;
    fields: Array<{ stepIdx: number; stepLabel: string; field: string; reason: string }>;
  } | null>(null);

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
      const url = mode === 'edit' && strategyId
        ? `/api/bidding/strategies/${strategyId}`
        : '/api/bidding/strategies';
      const method = mode === 'edit' && strategyId ? 'PATCH' : 'POST';

      const res = await adminFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Erreur structurée Zod : { error: 'invalid_body', issues: [...] }
        if (j?.issues && Array.isArray(j.issues)) {
          const humanized = humanizeActivationError(j.issues as ZodIssue[]);
          setSubmitError(humanized);
          // Saute automatiquement vers le 1er step incomplet
          if (humanized.fields[0]) {
            setIsRecap(false);
            setCurrentStep(humanized.fields[0].stepIdx);
          }
        } else {
          setSubmitError({ summary: j.error ?? `HTTP ${res.status}`, fields: [] });
        }
        setIsSubmitting(false);
        return;
      }

      if (mode === 'edit' && strategyId) {
        onCompleted?.(strategyId);
      } else {
        if (!j.strategy?.id) throw new Error('Réponse invalide : pas de strategy.id');
        onCompleted?.(j.strategy.id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('strategy-wizard', `activation failed: ${msg}`);
      setSubmitError({ summary: msg, fields: [] });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-level-0 text-text-primary">
      {!embedded && (
        <header className="border-b border-border-subtle px-4 shrink-0">
          <WizardStepper
            currentStep={currentStep}
            completedSteps={completedSteps}
            onStepClick={onStepClick}
          />
        </header>
      )}

      <main className="flex-1 min-h-0 overflow-auto p-6">
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
            geoConfigured={
              draftData.geography?.scope_type === 'custom_zone'
              && !!draftData.geography?.zone_id
              && draftData.geography?.weighting_mode !== 'uniform'
            }
          />
        )}
        {isRecap && (
          <Step6Recap
            data={draftData}
            onJumpToStep={(s) => { setIsRecap(false); setCurrentStep(s); }}
          />
        )}

        {submitError && (
          <div className="mt-4 max-w-2xl text-xs bg-geo-danger/10 border border-geo-danger/20 rounded-md p-3">
            <div className="text-geo-danger font-medium mb-1">{submitError.summary}</div>
            {submitError.fields.length > 0 && (
              <ul className="mt-2 space-y-1.5 text-text-secondary">
                {submitError.fields.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => { setIsRecap(false); setCurrentStep(f.stepIdx); }}
                      className="text-accent-teal hover:text-accent-teal-hover whitespace-nowrap text-[11px] font-medium"
                    >
                      Étape {f.stepIdx} →
                    </button>
                    <span className="text-text-tertiary">{f.field}&nbsp;:</span>
                    <span>{f.reason}</span>
                  </li>
                ))}
              </ul>
            )}
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
