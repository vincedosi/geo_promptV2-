'use client';

/**
 * Étape 3/5 — Pression : le pilier MAGELIAN. Combien la cible pèse dans
 * l'enchère par rapport au reste du territoire — un multiplicateur quantifié
 * (×1 = uniforme, ×3 = concentration max), pilotable par le slider OU par les
 * CPM min/max en euros (bidirectionnel). Écrit `pressure`, `forecastCpm` et
 * `diffusion` (zones strictes ×0 hors cible / national avec surpression ×1)
 * dans le brouillon ; la courbe d'enchère est générée au Lancement.
 */
import type { Diffusion, StepProps } from './types';
import { DIFFUSION_META } from './types';
import { B, FieldBlock, Lead, OptionRow, OptsList, StandardFooter, StepShell } from './ui';
import { PressureControl } from './PressureControl';

export function StepPression({
  draft, setDraft, onPrev, onNext,
}: StepProps & { onPrev: () => void; onNext: () => void }) {
  return (
    <StepShell
      title="Pression"
      stepNumber={3}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>La cible dit <B>où</B> viser ; la pression dit <B>avec quelle force</B> : combien de fois plus on enchérit sur la cible que sur le reste.</>,
          <>C&apos;est l&apos;arbitrage couverture ↔ concentration : ×1 diffuse partout pareil, ×3 met l&apos;essentiel du budget sur la cible.</>,
        ],
        tip: 'Fixe le CPM max que ton client accepte : le slider se recale tout seul.',
        mini: [2, 4, 3],
      }}
      footer={<StandardFooter onPrev={onPrev} nextLabel="Continuer →" onNext={onNext} />}
    >
      <Lead>
        Le <B>« combien de fois plus »</B> : le multiplicateur d&apos;enchère appliqué aux zones cibles,
        en chiffres — multiplicateur et CPM en euros.
      </Lead>

      <PressureControl
        pressure={draft.pressure}
        onPressureChange={(p) => setDraft((prev) => ({ ...prev, pressure: p }))}
        cpm={draft.forecastCpm}
        onCpmChange={(v) => setDraft((prev) => ({ ...prev, forecastCpm: v }))}
      />

      {draft.cibles.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <FieldBlock label="Et en dehors de la cible ?">
            <OptsList>
              {(['zones_only', 'national_boost'] as Diffusion[]).map((d) => (
                <OptionRow
                  key={d}
                  selected={draft.diffusion === d}
                  title={DIFFUSION_META[d].title}
                  sub={DIFFUSION_META[d].sub}
                  onClick={() => setDraft((prev) => ({ ...prev, diffusion: d }))}
                />
              ))}
            </OptsList>
          </FieldBlock>
        </div>
      )}
    </StepShell>
  );
}
