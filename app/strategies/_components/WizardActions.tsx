'use client';

import { Button } from '@/components/ui/button';
import { Loader2, Rocket } from 'lucide-react';

interface Props {
  currentStep: number;
  totalSteps: number;
  isRecap: boolean;
  isSubmitting: boolean;
  isSaving: boolean;
  lastSavedAt: Date | null;
  saveError: string | null;
  onPrev: () => void;
  onNext: () => void;
  onActivate?: () => void;
}

export function WizardActions(props: Props) {
  const { currentStep, totalSteps, isRecap, isSubmitting, isSaving, lastSavedAt, saveError, onPrev, onNext, onActivate } = props;

  const showActivate = isRecap;
  const nextLabel = currentStep === totalSteps ? 'Aperçu' : 'Suivant';

  return (
    <div className="flex items-center justify-between border-t border-border-subtle px-4 py-3 bg-bg-level-1 shrink-0">
      <div className="flex items-center gap-3 text-[11px] font-mono text-text-tertiary">
        {isSaving && (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> sauvegarde…
          </span>
        )}
        {!isSaving && lastSavedAt && (
          <span>brouillon sauvé · {lastSavedAt.toLocaleTimeString('fr-FR')}</span>
        )}
        {saveError && <span className="text-geo-danger">{saveError}</span>}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={onPrev}
          disabled={currentStep === 1 && !isRecap}
        >
          Précédent
        </Button>

        {!showActivate && (
          <Button onClick={onNext} disabled={isSubmitting}>
            {nextLabel}
          </Button>
        )}

        {showActivate && (
          <Button
            onClick={onActivate}
            disabled={isSubmitting}
            className="bg-accent-teal text-bg-level-0 hover:bg-accent-teal-hover"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            Activer la stratégie
          </Button>
        )}
      </div>
    </div>
  );
}
