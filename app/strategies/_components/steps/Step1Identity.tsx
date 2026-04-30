'use client';

import type { IdentityStep, InventoryType } from '@/lib/strategy-wizard/types';

interface Props {
  data: IdentityStep;
  onChange: (next: IdentityStep) => void;
}

const INVENTORY: Array<{ value: InventoryType; label: string }> = [
  { value: 'display', label: 'Display' },
  { value: 'video', label: 'Video' },
  { value: 'dooh', label: 'DOOH' },
  { value: 'ctv', label: 'CTV' },
  { value: 'audio', label: 'Audio' },
];

export function Step1Identity({ data, onChange }: Props) {
  const set = <K extends keyof IdentityStep>(k: K, v: IdentityStep[K]) =>
    onChange({ ...data, [k]: v });

  return (
    <div className="grid grid-cols-1 gap-5 max-w-2xl">
      <Field label="Nom de la stratégie *">
        <input
          type="text"
          value={data.name ?? ''}
          onChange={(e) => set('name', e.target.value)}
          placeholder="ex: Pilotage ML — Renault Captur Q1 2026"
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Annonceur">
          <input type="text" value={data.advertiser ?? ''} onChange={(e) => set('advertiser', e.target.value)} placeholder="Renault" className={inputCls} />
        </Field>
        <Field label="Marque / produit">
          <input type="text" value={data.brand ?? ''} onChange={(e) => set('brand', e.target.value)} placeholder="Captur" className={inputCls} />
        </Field>
      </div>

      <Field label="Référence interne (optionnel)">
        <input type="text" value={data.internal_reference ?? ''} onChange={(e) => set('internal_reference', e.target.value)} placeholder="RNL-CAPT-Q1-26" className={inputCls} />
      </Field>

      <Field label="Type d'inventaire *">
        <div className="flex flex-wrap gap-2">
          {INVENTORY.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set('inventory_type', opt.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                data.inventory_type === opt.value
                  ? 'border-[rgba(78,205,196,0.5)] bg-[#111] text-[#f0f0f0]'
                  : 'border-[#1a1a1a] bg-[#0a0a0a] text-[#a0a0a0] hover:border-[#333] hover:text-[#f0f0f0]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Date de début *">
          <input type="date" value={data.start_date ?? ''} onChange={(e) => set('start_date', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Date de fin *">
          <input type="date" value={data.end_date ?? ''} onChange={(e) => set('end_date', e.target.value)} className={inputCls} />
        </Field>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-[#111] border border-[#1a1a1a] rounded-md px-3 py-2 text-sm text-[#f0f0f0] placeholder:text-[#666] focus:outline-none focus:border-[rgba(78,205,196,0.5)]';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] text-[#666] font-medium">{label}</span>
      {children}
    </label>
  );
}
