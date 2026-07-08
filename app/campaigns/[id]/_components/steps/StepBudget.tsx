'use client';

/**
 * Étape 3/5 — Budget : enveloppe, CPM cible et période. Écrit `total_budget`,
 * `forecast_cpm`, `start_date`, `end_date` dans le brouillon (pré-remplis
 * depuis les dates de la campagne par le cockpit, page.tsx).
 */
import type { StepProps } from './types';
import { B, DateField, FieldBlock, Lead, NumberField, Row2, StandardFooter, StepShell } from './ui';

export function StepBudget({ draft, setDraft, onPrev, onNext }: StepProps & { onPrev: () => void; onNext: () => void }) {
  const nextDisabled = !draft.totalBudget || !draft.startDate || !draft.endDate;

  return (
    <StepShell
      title="Budget"
      stepNumber={3}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>Le budget est un <B>plafond</B>, pas un objectif à cramer.</>,
          <>Le pacing répartit la dépense sur la période pour éviter les à-coups.</>,
        ],
        tip: 'CPM cible = point de départ ; l’algo l’ajuste ensuite par zone.',
        mini: [3, 2, 4],
      }}
      footer={<StandardFooter onPrev={onPrev} nextLabel="Continuer →" onNext={onNext} nextDisabled={nextDisabled} />}
    >
      <Lead>
        Combien, à quel prix, sur quelle période. MAGELIAN pace la dépense pour ne jamais dépasser.
      </Lead>

      <FieldBlock label="Enveloppe">
        <Row2>
          <NumberField
            label="Budget total"
            value={draft.totalBudget}
            onChange={(v) => setDraft((prev) => ({ ...prev, totalBudget: v }))}
            suffix="€"
            placeholder="ex. 45000"
            step={100}
            min={0}
          />
          <NumberField
            label="CPM cible"
            value={draft.forecastCpm}
            onChange={(v) => setDraft((prev) => ({ ...prev, forecastCpm: v }))}
            suffix="€"
            placeholder="ex. 6.20"
            step={0.1}
            min={0}
          />
        </Row2>
      </FieldBlock>

      <FieldBlock label="Période">
        <Row2>
          <DateField label="Début" value={draft.startDate} onChange={(v) => setDraft((prev) => ({ ...prev, startDate: v }))} />
          <DateField label="Fin" value={draft.endDate} onChange={(v) => setDraft((prev) => ({ ...prev, endDate: v }))} />
        </Row2>
      </FieldBlock>
    </StepShell>
  );
}
