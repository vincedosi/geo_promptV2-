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
                  ? 'border-[rgba(78,205,196,0.5)] bg-[#111] text-[#f0f0f0]'
                  : isDone
                    ? 'border-[#1a1a1a] bg-[#0a0a0a] text-[#a0a0a0] hover:border-[rgba(78,205,196,0.3)] hover:text-[#f0f0f0]'
                    : 'border-[#1a1a1a] bg-transparent text-[#666] hover:border-[#333] hover:text-[#a0a0a0]',
              )}
              aria-current={isActive ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium',
                  isActive
                    ? 'bg-[#4ecdc4] text-[#050505]'
                    : isDone
                      ? 'bg-[rgba(78,205,196,0.2)] text-[#4ecdc4]'
                      : 'bg-[#181818] text-[#666]',
                )}
              >
                {isDone && !isActive ? <Check className="h-3 w-3" /> : step}
              </span>
              <span>{STEP_LABELS_FR[step]}</span>
            </button>
            {idx < STEPS.length - 1 && <span className="h-px w-6 bg-[#1a1a1a]" />}
          </div>
        );
      })}
    </nav>
  );
}
