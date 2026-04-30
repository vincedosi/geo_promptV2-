'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ObjectiveStep, AttributionModel } from '@/lib/strategy-wizard/types';

interface Props {
  data: ObjectiveStep;
  onChange: (next: ObjectiveStep) => void;
}

interface ObjectiveOpt {
  code: string;
  display_name: string;
  optimization_direction?: string;
}

const ATTRIB: Array<{ value: AttributionModel; label: string }> = [
  { value: 'last_click', label: 'Last-click' },
  { value: 'first_click', label: 'First-click' },
  { value: 'linear', label: 'Linéaire' },
];

export function Step3Objective({ data, onChange }: Props) {
  const set = <K extends keyof ObjectiveStep>(k: K, v: ObjectiveStep[K]) =>
    onChange({ ...data, [k]: v });

  const [objectives, setObjectives] = useState<ObjectiveOpt[]>([]);

  useEffect(() => {
    adminFetch('/api/bidding/objectives', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { objectives: [] })
      .then(j => setObjectives((j.objectives ?? []) as ObjectiveOpt[]))
      .catch(() => setObjectives([]));
  }, []);

  const toggleSecondary = (code: string) => {
    const cur = data.kpi_secondary ?? [];
    set('kpi_secondary', cur.includes(code) ? cur.filter(c => c !== code) : [...cur, code]);
  };

  return (
    <div className="grid grid-cols-1 gap-5 max-w-2xl">
      <Field label="KPI primaire *">
        <select
          value={data.objective_code ?? ''}
          onChange={(e) => set('objective_code', e.target.value || undefined)}
          className={selectCls}
        >
          <option value="">— Sélectionner —</option>
          {objectives.map(o => (
            <option key={o.code} value={o.code}>{o.display_name}</option>
          ))}
        </select>
      </Field>

      <Field label="Cible quantifiée *">
        <input
          type="number"
          step="0.01"
          value={data.kpi_target ?? ''}
          onChange={(e) => set('kpi_target', e.target.value === '' ? undefined : parseFloat(e.target.value))}
          placeholder="12.5"
          className={inputCls}
        />
      </Field>

      <Field label="KPIs secondaires (à monitorer, optionnel)">
        <div className="flex flex-wrap gap-2">
          {objectives.filter(o => o.code !== data.objective_code).map(o => {
            const sel = (data.kpi_secondary ?? []).includes(o.code);
            return (
              <button
                key={o.code}
                type="button"
                onClick={() => toggleSecondary(o.code)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  sel
                    ? 'border-[rgba(78,205,196,0.5)] bg-[#111] text-[#f0f0f0]'
                    : 'border-[#1a1a1a] bg-[#0a0a0a] text-[#a0a0a0] hover:border-[#333] hover:text-[#f0f0f0]'
                }`}
              >
                {o.display_name}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Modèle d'attribution">
        <div className="flex gap-2">
          {ATTRIB.map(a => (
            <button
              key={a.value}
              type="button"
              onClick={() => set('attribution_model', a.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                data.attribution_model === a.value
                  ? 'border-[rgba(78,205,196,0.5)] bg-[#111] text-[#f0f0f0]'
                  : 'border-[#1a1a1a] bg-[#0a0a0a] text-[#a0a0a0] hover:border-[#333] hover:text-[#f0f0f0]'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

const inputCls = 'w-full bg-[#111] border border-[#1a1a1a] rounded-md px-3 py-2 text-sm text-[#f0f0f0] placeholder:text-[#666] focus:outline-none focus:border-[rgba(78,205,196,0.5)]';
const selectCls = inputCls;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] text-[#666] font-medium">{label}</span>
      {children}
    </label>
  );
}
