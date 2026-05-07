'use client';

import type { BudgetStep, PacingStrategy } from '@/lib/strategy-wizard/types';
import { PACING_LABELS_FR } from '@/lib/strategy-wizard/types';

interface Props {
  data: BudgetStep;
  onChange: (next: BudgetStep) => void;
}

const PACING: PacingStrategy[] = ['even', 'front_loaded', 'back_loaded'];

export function Step4Budget({ data, onChange }: Props) {
  const set = <K extends keyof BudgetStep>(k: K, v: BudgetStep[K]) =>
    onChange({ ...data, [k]: v });

  return (
    <div className="grid grid-cols-1 gap-5 max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Budget total *">
          <div className="flex gap-2">
            <input
              type="number"
              step="0.01"
              value={data.total_budget ?? ''}
              onChange={(e) => set('total_budget', e.target.value === '' ? undefined : parseFloat(e.target.value))}
              placeholder="250000.00"
              className={inputCls}
            />
            <select
              value={data.currency ?? 'EUR'}
              onChange={(e) => set('currency', e.target.value)}
              className={selectCls + ' w-24'}
            >
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
        </Field>
        <Field label="Budget journalier max">
          <input
            type="number"
            step="0.01"
            value={data.daily_budget_max ?? ''}
            onChange={(e) => set('daily_budget_max', e.target.value === '' ? undefined : parseFloat(e.target.value))}
            placeholder="10000.00"
            className={inputCls}
          />
        </Field>
      </div>

      <Field
        label="ID campagne DSP externe (optionnel)"
        tagline="Identifiant de la campagne dans votre DSP (TTD, DV360, Meta…) — facilite la réconciliation."
      >
        <input
          type="text"
          value={data.dsp_external_id ?? ''}
          onChange={(e) => set('dsp_external_id', e.target.value)}
          placeholder="TTD-987654321"
          className={inputCls}
        />
      </Field>

      <Field
        label="CPM prévisionnel"
        tagline="Coût pour mille impressions estimé — sert au calcul du pacing budget."
      >
        <input
          type="number"
          step="0.01"
          value={data.forecast_cpm ?? ''}
          onChange={(e) => set('forecast_cpm', e.target.value === '' ? undefined : parseFloat(e.target.value))}
          placeholder="4.00"
          className={inputCls}
        />
      </Field>

      <Field
        label="Distribution temporelle"
        tagline="Répartition du budget sur la durée de la campagne."
      >
        <div className="flex gap-2">
          {PACING.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => set('pacing_strategy', p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                data.pacing_strategy === p
                  ? 'border-accent-teal/50 bg-bg-level-2 text-text-primary'
                  : 'border-border-subtle bg-bg-level-1 text-text-secondary hover:border-border-hover hover:text-text-primary'
              }`}
            >
              {PACING_LABELS_FR[p]}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Plafond de répétition par utilisateur"
        tagline="Nombre maximum d'expositions par utilisateur sur une période donnée."
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={data.frequency_cap_imps ?? ''}
            onChange={(e) => set('frequency_cap_imps', e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
            placeholder="3"
            className={inputCls + ' w-24'}
          />
          <span className="text-xs text-text-secondary">impressions /</span>
          <input
            type="number"
            min={1}
            value={data.frequency_cap_period_days ?? ''}
            onChange={(e) => set('frequency_cap_period_days', e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
            placeholder="1"
            className={inputCls + ' w-24'}
          />
          <span className="text-xs text-text-secondary">jour(s)</span>
        </div>
      </Field>
    </div>
  );
}

const inputCls = 'bg-bg-level-2 border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-teal/50';
const selectCls = inputCls;

function Field({ label, tagline, children }: { label: string; tagline?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-text-tertiary font-medium">{label}</span>
      {tagline && <span className="text-[11px] text-text-tertiary -mt-0.5">{tagline}</span>}
      {children}
    </div>
  );
}
