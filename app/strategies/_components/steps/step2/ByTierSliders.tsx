'use client';

/**
 * Un slider de multiplier par tier de densité urbaine — extrait de
 * Step2Geography.tsx (2026-09-08), JSX inchangé.
 */

import type { Tier } from '@/lib/strategy-wizard/types';
import { TIER_LABELS_FR } from '@/lib/strategy-wizard/types';
import { colorForMultiplier } from '@/lib/strategy-wizard/multiplier';
import { TIERS, TIER_DOT } from './shared';

export function ByTierSliders({ values, onChange }: { values: Partial<Record<Tier, number>>; onChange: (v: Partial<Record<Tier, number>>) => void }) {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {TIERS.map(t => {
        const v = values[t] ?? 1.0;
        const color = colorForMultiplier(v);
        const delta = v - 1;
        return (
          <div key={t} className="flex items-center gap-3">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: TIER_DOT[t] }}
            />
            <span className="w-32 text-xs text-text-secondary shrink-0">{TIER_LABELS_FR[t]}</span>
            <input
              type="range"
              min={0} max={5} step={0.1}
              value={v}
              onChange={(e) => onChange({ ...values, [t]: parseFloat(e.target.value) })}
              className="flex-1"
              style={{ accentColor: color }}
            />
            <span className="w-16 text-right text-xs font-mono" style={{ color }}>×{v.toFixed(2)}</span>
            <span className="w-16 text-right text-[10px] font-mono text-text-tertiary">
              {delta > 0 ? `+${Math.round(delta * 100)}%` : delta < 0 ? `${Math.round(delta * 100)}%` : 'base'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

