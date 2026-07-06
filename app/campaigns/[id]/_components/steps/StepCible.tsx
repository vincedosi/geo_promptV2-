'use client';

/**
 * Étape 1/5 — Cible : le « qui ». Choix de la variable de ciblage (une seule
 * disponible : taux d'abstention présidentielle 2022) + l'intensité de la
 * sur-pondération. Écrit `weighting_mode='by_insee_variable'` +
 * `in_zone_weights={mode, variable_code, curve}` dans le brouillon.
 */
import type { Intensity, StepProps } from './types';
import { INTENSITY_META } from './types';
import { B, FieldBlock, Lead, OptionRow, OptsList, StandardFooter, StepShell } from './ui';

const INTENSITIES: Intensity[] = ['doux', 'marque', 'fort'];

export function StepCible({ draft, setDraft, onNext }: StepProps & { onNext: () => void }) {
  return (
    <StepShell
      title="Cible"
      stepNumber={1}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>La cible reste <B>fixe</B> pendant toute la campagne : c&apos;est le cap.</>,
          <>À l&apos;inverse, l&apos;<B>enchère</B> bouge chaque jour pour tenir ce cap — c&apos;est l&apos;étape Stratégie, plus loin.</>,
        ],
        tip: "On sépare le quoi viser (ici) du comment enchérir (étape 4).",
        mini: [1, 3, 4],
      }}
      footer={<StandardFooter onPrev={() => {}} isFirst nextLabel="Continuer →" onNext={onNext} />}
    >
      <Lead>
        Le <B>« qui »</B> : la variable qui définit les zones à privilégier. MAGELIAN sur-pondère la diffusion
        là où cette valeur est forte.
      </Lead>

      <FieldBlock label="Variable de ciblage">
        <OptsList>
          <OptionRow
            selected
            onClick={() => {}}
            title="Taux d'abstention (présidentielle 2022)"
            sub="INSEE · par code postal"
            value="▲ fort = cible"
          />
        </OptsList>
      </FieldBlock>

      <FieldBlock label="Intensité du ciblage">
        <OptsList>
          {INTENSITIES.map((i) => (
            <OptionRow
              key={i}
              selected={draft.intensity === i}
              onClick={() => setDraft((prev) => ({ ...prev, intensity: i }))}
              title={INTENSITY_META[i].title}
              sub={INTENSITY_META[i].sub}
            />
          ))}
        </OptsList>
      </FieldBlock>
    </StepShell>
  );
}
