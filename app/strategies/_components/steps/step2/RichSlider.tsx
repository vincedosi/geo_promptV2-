'use client';

/**
 * Slider riche : barre de couleur (gradient via stops), curseur, valeur big,
 * markers aux valeurs charnières (×0, ×0.5, ×1, ×1.5, ×2, ×3, ×5),
 * phrase plain-french en-dessous.
 *
 * Extrait de Step2Geography.tsx (2026-09-08), JSX inchangé.
 */

import { colorForMultiplier, plainFrenchForMultiplier } from '@/lib/strategy-wizard/multiplier';

export function RichSlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const color = colorForMultiplier(value);
  const explanation = plainFrenchForMultiplier(value);
  return (
    <div className="flex flex-col gap-3 max-w-md">
      <span className="text-[11px] text-text-tertiary">{label}</span>

      <div>
        <input
          type="range"
          min={0} max={5} step={0.1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full accent-accent-teal"
          style={{ accentColor: color }}
        />
        <div className="flex justify-between text-[9px] font-mono text-text-tertiary mt-1">
          <span>×0</span><span>×0.5</span><span>×1</span><span>×1.5</span><span>×2</span><span>×3</span><span>×5</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="text-lg font-mono font-medium px-3 py-1 rounded"
          style={{ background: color + '22', color }}
        >
          ×{value.toFixed(2)}
        </div>
        <p className="text-[11px] text-text-secondary">{explanation}</p>
      </div>
    </div>
  );
}

