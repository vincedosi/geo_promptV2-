'use client';

import { Check } from 'lucide-react';
import type { WizardDraftData } from '@/lib/strategy-wizard/types';
import { AUTONOMY_LABELS_FR, STEP_LABELS_FR } from '@/lib/strategy-wizard/types';

interface Props {
  data: WizardDraftData;
  onJumpToStep: (step: number) => void;
}

export function Step6Recap({ data, onJumpToStep }: Props) {
  const id = data.identity ?? {};
  const geo = data.geography;
  const obj = data.objective ?? {};
  const bud = data.budget ?? {};
  const ml = data.mlagent ?? {};

  return (
    <div className="grid grid-cols-1 gap-4 max-w-3xl">
      <RecapSection title={STEP_LABELS_FR[1]} stepIdx={1} onEdit={() => onJumpToStep(1)}>
        <KV label="Nom" value={id.name ?? '—'} />
        <KV label="Annonceur" value={id.advertiser ?? '—'} />
        <KV label="Marque" value={id.brand ?? '—'} />
        <KV label="Réf. interne" value={id.internal_reference ?? '—'} />
        <KV label="Inventaire" value={id.inventory_type ?? '—'} />
        <KV label="Période" value={`${id.start_date ?? '?'} → ${id.end_date ?? '?'}`} />
      </RecapSection>

      <RecapSection title={STEP_LABELS_FR[2]} stepIdx={2} onEdit={() => onJumpToStep(2)}>
        <KV label="Périmètre" value={geo?.scope_type === 'national' ? 'National (toute la France)' : `Zone custom (${geo?.zone_id?.slice(0, 8) ?? '—'})`} />
        <KV label="Mode pondération" value={geo?.weighting_mode ?? '—'} />
        <KV label="Sous-zones" value={geo?.subzones?.length ? `${geo.subzones.length} définies` : '—'} />
      </RecapSection>

      <RecapSection title={STEP_LABELS_FR[3]} stepIdx={3} onEdit={() => onJumpToStep(3)}>
        <KV label="Algorithme" value={obj.algorithm_code ?? ml.algorithm_code ?? '—'} />
        <KV label="Objectif primaire" value={obj.objective_code ?? '—'} />
        <KV label="Cible" value={obj.kpi_target?.toString() ?? '—'} />
        <KV label="Attribution" value={obj.attribution_model ?? '—'} />
      </RecapSection>

      <RecapSection title={STEP_LABELS_FR[4]} stepIdx={4} onEdit={() => onJumpToStep(4)}>
        <KV label="Budget total" value={bud.total_budget ? `${bud.total_budget} ${bud.currency ?? 'EUR'}` : '—'} />
        <KV label="Budget journalier max" value={bud.daily_budget_max?.toString() ?? '—'} />
        <KV label="DSP externe" value={bud.dsp_external_id ?? '—'} />
        <KV label="CPM forecast" value={bud.forecast_cpm?.toString() ?? '—'} />
        <KV label="Pacing" value={bud.pacing_strategy ?? '—'} />
        <KV label="Frequency cap" value={bud.frequency_cap_imps ? `${bud.frequency_cap_imps} / ${bud.frequency_cap_period_days ?? 1}j` : '—'} />
      </RecapSection>

      <RecapSection title={STEP_LABELS_FR[5]} stepIdx={5} onEdit={() => onJumpToStep(5)}>
        <KV label="Algo" value={ml.algorithm_code ?? '—'} />
        <KV label="Preset init" value={ml.init_preset_code ?? '—'} />
        <KV label="Mode exécution" value={ml.execution_mode ?? 'suggest'} />
        <KV
          label="Autonomie agent"
          value={
            ml.agent_autonomy_override === null || ml.agent_autonomy_override === undefined
              ? 'Hérité du défaut user'
              : `Niveau ${ml.agent_autonomy_override} — ${AUTONOMY_LABELS_FR[ml.agent_autonomy_override]}`
          }
        />
        <KV label="Notifications" value={(ml.notification_channels ?? []).join(', ') || '—'} />
        <KV label="Seuil alerte" value={ml.alert_severity_threshold ?? '—'} />
      </RecapSection>
    </div>
  );
}

function RecapSection({
  title, stepIdx, onEdit, children,
}: { title: string; stepIdx: number; onEdit: () => void; children: React.ReactNode }) {
  return (
    <section className="border border-[#1a1a1a] rounded-md bg-[#0a0a0a]">
      <header className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a1a] bg-[#111]">
        <div className="flex items-center gap-2">
          <Check className="h-3 w-3 text-[#4ecdc4]" />
          <span className="text-[12px] font-medium text-[#f0f0f0]">Step {stepIdx} — {title}</span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="text-[11px] text-[#4ecdc4] hover:text-[#3dbdb5]"
        >
          Modifier
        </button>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 text-[12px]">
        {children}
      </dl>
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[#666]">{label}</dt>
      <dd className="text-[#a0a0a0] font-mono">{value}</dd>
    </>
  );
}
