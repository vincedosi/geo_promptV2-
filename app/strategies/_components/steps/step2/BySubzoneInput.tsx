'use client';

/**
 * Saisie manuelle des sous-zones (nom + liste de CPs + multiplier), utilisée
 * quand la zone custom n'a pas de sous-zones natives.
 *
 * Extrait de Step2Geography.tsx (2026-09-08), JSX inchangé.
 */

import { Plus, Trash2 } from 'lucide-react';
import type { Subzone } from '@/lib/strategy-wizard/types';
import { colorForMultiplier } from '@/lib/strategy-wizard/multiplier';
import { inputCls } from './shared';
import { RichSlider } from './RichSlider';

export function BySubzoneInput({ subzones, onChange, fallbackValue, onFallbackChange }: {
  subzones: Subzone[];
  onChange: (s: Subzone[]) => void;
  fallbackValue: number;
  onFallbackChange: (v: number) => void;
}) {
  const add = () => onChange([...subzones, { name: '', postal_codes: [], multiplier: 1.0 }]);
  const update = (i: number, patch: Partial<Subzone>) =>
    onChange(subzones.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(subzones.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-3">
      {subzones.map((sz, i) => {
        const v = sz.multiplier;
        const color = colorForMultiplier(v);
        return (
          <div key={i} className="flex items-center gap-2 border border-border-subtle rounded-md p-2 bg-bg-level-1">
            <input
              type="text"
              placeholder="Nom de la sous-zone"
              value={sz.name}
              onChange={(e) => update(i, { name: e.target.value })}
              className={inputCls + ' flex-1'}
            />
            <input
              type="text"
              placeholder="CPs (75001,75002,…)"
              value={sz.postal_codes.join(',')}
              onChange={(e) => update(i, { postal_codes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              className={inputCls + ' flex-[2]'}
            />
            <input
              type="number"
              min={0} max={5} step={0.1}
              value={sz.multiplier}
              onChange={(e) => update(i, { multiplier: parseFloat(e.target.value) || 0 })}
              className={inputCls + ' w-20 text-right'}
              style={{ borderColor: color + '88' }}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-2 text-text-tertiary hover:text-geo-danger"
              aria-label="supprimer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-2 text-xs text-accent-teal hover:text-accent-teal-hover py-2"
      >
        <Plus className="h-4 w-4" /> Ajouter une sous-zone
      </button>

      <div className="border-t border-border-subtle pt-3 mt-2">
        <RichSlider
          value={fallbackValue}
          onChange={onFallbackChange}
          label="Multiplier des CPs non assignés à une sous-zone"
        />
      </div>
    </div>
  );
}
