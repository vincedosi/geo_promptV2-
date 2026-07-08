'use client';

/**
 * Étape 4/5 — Stratégie : le « comment ». Autonomie de l'agent ML qui tient
 * l'enchère jour après jour. Écrit `execution_mode` dans le brouillon.
 */
import type { ExecutionMode, StepProps } from './types';
import { EXECUTION_MODE_META } from './types';
import { B, FieldBlock, Lead, OptionRow, OptsList, StandardFooter, StepShell } from './ui';

const MODES: ExecutionMode[] = ['monitor_only', 'suggest', 'auto'];

export function StepStrategie({ draft, setDraft, onPrev, onNext }: StepProps & { onPrev: () => void; onNext: () => void }) {
  return (
    <StepShell
      title="Stratégie"
      stepNumber={4}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>La cible dit <B>où</B> viser ; la stratégie dit <B>de combien</B> pousser l&apos;enchère jour après jour.</>,
          <>En automatique, l&apos;agent redéploie les impressions vers les zones-cibles et rend compte de ses décisions.</>,
        ],
        tip: 'Tu peux démarrer en suggestion puis passer en auto quand tu as confiance.',
        mini: [4, 2, 4],
      }}
      footer={<StandardFooter onPrev={onPrev} nextLabel="Continuer →" onNext={onNext} />}
    >
      <Lead>
        Le <B>« comment »</B> : comment l&apos;enchère bouge chaque jour pour tenir la cible sans dépasser le budget.
        C&apos;est le moteur de pilotage.
      </Lead>

      <FieldBlock label="Autonomie de l'agent">
        <OptsList>
          {MODES.map((m) => (
            <OptionRow
              key={m}
              selected={draft.executionMode === m}
              onClick={() => setDraft((prev) => ({ ...prev, executionMode: m }))}
              title={EXECUTION_MODE_META[m].title}
              sub={EXECUTION_MODE_META[m].sub}
            />
          ))}
        </OptsList>
      </FieldBlock>
    </StepShell>
  );
}
