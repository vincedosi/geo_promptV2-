'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STEP_LABELS_FR } from '@/lib/strategy-wizard/types';

interface Props {
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (step: number) => void;
}

const STEPS = [1, 2, 3, 4, 5];

export function WizardStepper({ currentStep, completedSteps, onStepClick }: Props) {
  return (
    <nav className="flex items-center gap-2 overflow-x-auto py-4 px-2" aria-label="wizard-stepper">
      {STEPS.map((step, idx) => {
        const isActive = step === currentStep;
        const isDone = completedSteps.has(step);
        return (
          <div key={step} className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onStepClick(step)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors border',
                isActive
                  ? 'border-accent-teal/50 bg-bg-level-2 text-text-primary'
                  : isDone
                    ? 'border-border-subtle bg-bg-level-1 text-text-secondary hover:border-accent-teal/30 hover:text-text-primary'
                    : 'border-border-subtle bg-transparent text-text-tertiary hover:border-border-hover hover:text-text-secondary',
              )}
              aria-current={isActive ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium',
                  isActive
                    ? 'bg-accent-teal text-bg-level-0'
                    : isDone
                      ? 'bg-accent-teal/20 text-accent-teal'
                      : 'bg-bg-level-3 text-text-tertiary',
                )}
              >
                {isDone && !isActive ? <Check className="h-3 w-3" /> : step}
              </span>
              <span>{STEP_LABELS_FR[step]}</span>
            </button>
            {idx < STEPS.length - 1 && <span className="h-px w-6 bg-border-subtle" />}
          </div>
        );
      })}
    </nav>
  );
}
