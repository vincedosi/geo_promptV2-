'use client';

import type { BudgetStep, PacingStrategy } from '@/lib/strategy-wizard/types';

interface Props {
  data: BudgetStep;
  onChange: (next: BudgetStep) => void;
}

const PACING: Array<{ value: PacingStrategy; label: string }> = [
  { value: 'even', label: 'Even' },
  { value: 'front_loaded', label: 'Front-loaded' },
  { value: 'back_loaded', label: 'Back-loaded' },
];

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

      <Field label="ID campagne DSP externe (optionnel)">
        <input
          type="text"
          value={data.dsp_external_id ?? ''}
          onChange={(e) => set('dsp_external_id', e.target.value)}
          placeholder="TTD-987654321"
          className={inputCls}
        />
      </Field>

      <Field label="CPM prévisionnel">
        <input
          type="number"
          step="0.01"
          value={data.forecast_cpm ?? ''}
          onChange={(e) => set('forecast_cpm', e.target.value === '' ? undefined : parseFloat(e.target.value))}
          placeholder="4.00"
          className={inputCls}
        />
      </Field>

      <Field label="Distribution temporelle">
        <div className="flex gap-2">
          {PACING.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => set('pacing_strategy', p.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                data.pacing_strategy === p.value
                  ? 'border-[rgba(78,205,196,0.5)] bg-[#111] text-[#f0f0f0]'
                  : 'border-[#1a1a1a] bg-[#0a0a0a] text-[#a0a0a0] hover:border-[#333] hover:text-[#f0f0f0]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Frequency cap">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={data.frequency_cap_imps ?? ''}
            onChange={(e) => set('frequency_cap_imps', e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
            placeholder="3"
            className={inputCls + ' w-24'}
          />
          <span className="text-xs text-[#a0a0a0]">imps /</span>
          <input
            type="number"
            min={1}
            value={data.frequency_cap_period_days ?? ''}
            onChange={(e) => set('frequency_cap_period_days', e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
            placeholder="1"
            className={inputCls + ' w-24'}
          />
          <span className="text-xs text-[#a0a0a0]">jour(s)</span>
        </div>
      </Field>
    </div>
  );
}

const inputCls = 'bg-[#111] border border-[#1a1a1a] rounded-md px-3 py-2 text-sm text-[#f0f0f0] placeholder:text-[#666] focus:outline-none focus:border-[rgba(78,205,196,0.5)]';
const selectCls = inputCls;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] text-[#666] font-medium">{label}</span>
      {children}
    </label>
  );
}
