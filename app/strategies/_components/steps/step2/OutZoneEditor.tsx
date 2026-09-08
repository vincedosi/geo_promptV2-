'use client';

/**
 * Éditeur des multipliers HORS de la zone : réduction uniforme, par tier, ou
 * exclusion totale.
 *
 * Extrait de Step2Geography.tsx (2026-09-08), JSX inchangé.
 */

import type { Tier } from '@/lib/strategy-wizard/types';
import { pillCls } from './shared';
import { RichSlider } from './RichSlider';
import { ByTierSliders } from './ByTierSliders';

export function OutZoneEditor({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const mode = (value.mode as string) ?? 'uniform';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange({ mode: 'uniform', value: 0.7 })} className={pillCls(mode === 'uniform')}>Réduction uniforme</button>
        <button type="button" onClick={() => onChange({ mode: 'by_tier', values: { premium_urban: 1.0, urban: 0.8, suburban: 0.6, rural: 0.4 } })} className={pillCls(mode === 'by_tier')}>Par tier</button>
        <button type="button" onClick={() => onChange({ mode: 'exclusion' })} className={pillCls(mode === 'exclusion')}>Exclusion totale (×0)</button>
      </div>

      {mode === 'uniform' && (
        <RichSlider
          value={Number(value.value ?? 0.7)}
          onChange={(v) => onChange({ mode: 'uniform', value: v })}
          label="Multiplier hors de la zone"
        />
      )}
      {mode === 'by_tier' && (
        <ByTierSliders
          values={(value.values as Partial<Record<Tier, number>>) ?? {}}
          onChange={(values) => onChange({ mode: 'by_tier', values })}
        />
      )}
      {mode === 'exclusion' && (
        <p className="text-xs text-text-secondary">Aucune dépense hors de la zone (multiplier ×0).</p>
      )}
    </div>
  );
}
