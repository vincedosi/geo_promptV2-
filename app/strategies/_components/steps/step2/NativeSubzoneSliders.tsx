'use client';

/**
 * Pondération native par sous-zone (issu de la zone custom multi-POI).
 * 1 slider par sous-zone, pastille couleur identique à la légende de la mini-map.
 *
 * Extrait de Step2Geography.tsx (2026-09-08), JSX inchangé.
 */

import { colorForMultiplier } from '@/lib/strategy-wizard/multiplier';
import type { SubzoneNative } from '../WeightingMiniMap';

export function NativeSubzoneSliders({
  subzones, onChange,
}: {
  subzones: SubzoneNative[];
  onChange: (subzoneId: string, mult: number) => void;
}) {
  const SUBZONE_COLORS = ['#4ecdc4', '#f7b731', '#e879f9', '#60a5fa', '#fb923c', '#34d399', '#f472b6', '#a78bfa'];
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {subzones.map((sz, i) => {
        const v = sz.multiplier;
        const color = colorForMultiplier(v);
        const accent = SUBZONE_COLORS[i % SUBZONE_COLORS.length];
        const delta = v - 1;
        return (
          <div key={sz.id} className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: accent }} />
            <div className="w-44 shrink-0 min-w-0">
              <div className="text-xs text-text-primary truncate">{sz.name}</div>
              <div className="text-[10px] font-mono text-text-tertiary">{sz.cp_count} CPs · {sz.iris_count} IRIS</div>
            </div>
            <input
              type="range"
              min={0} max={5} step={0.1}
              value={v}
              onChange={(e) => onChange(sz.id, parseFloat(e.target.value))}
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

