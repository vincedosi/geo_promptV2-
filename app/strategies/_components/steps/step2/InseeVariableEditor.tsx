'use client';

/**
 * Mode `by_insee_variable` : dropdown de variable INSEE, 3 presets narratifs,
 * CurveEditor et bandeau « impact de votre courbe ».
 *
 * Extrait de Step2Geography.tsx (2026-09-08), calculs et JSX inchangés.
 */

import { useMemo } from 'react';
import { interpolateOnCurve } from '@/lib/strategy-wizard/multiplier';
import { CurveEditor, type CurvePoint } from '../CurveEditor';
import type { InseeVariableMeta } from './shared';
import { selectCls } from './shared';
import { PRESET_LABELS, PRESET_TAGLINES, type PresetKey } from './presets';

export function InseeVariableEditor({
  variables, variableCode, curve, onVariableChange, onCurveChange, onPresetApply, inseeValues,
}: {
  variables: InseeVariableMeta[];
  variableCode: string;
  curve: CurvePoint[];
  onVariableChange: (code: string) => void;
  onCurveChange: (curve: CurvePoint[]) => void;
  onPresetApply: (key: PresetKey) => void;
  inseeValues: Record<string, number>;
}) {
  const variable = variables.find(v => v.code === variableCode);

  // Calcul "ratio sociétal" : combien de CPs / inscrits sont concernés par boost > 1.5
  const ratio = useMemo(() => {
    if (!variable || Object.keys(inseeValues).length === 0) return null;
    const total = Object.keys(inseeValues).length;
    let boosted = 0;
    let valSum = 0;
    let boostedValSum = 0;
    for (const cp in inseeValues) {
      const v = inseeValues[cp];
      const m = interpolateOnCurve(curve, v);
      if (m > 1.5) {
        boosted++;
        boostedValSum += v;
      }
      valSum += v;
    }
    return {
      n_total: total,
      n_boosted: boosted,
      pct_boosted: total > 0 ? (boosted / total) * 100 : 0,
      avg_value_boosted: boosted > 0 ? boostedValSum / boosted : 0,
      avg_value_total: total > 0 ? valSum / total : 0,
    };
  }, [variable, inseeValues, curve]);

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      {/* Dropdown variable */}
      <div>
        <label className="block text-[11px] text-text-tertiary mb-1">Variable de pondération</label>
        <select
          value={variableCode}
          onChange={(e) => onVariableChange(e.target.value)}
          className={selectCls}
        >
          {variables.length === 0 && <option value="abstention_pres_2022">Chargement…</option>}
          {variables.map(v => (
            <option key={v.code} value={v.code}>
              {v.icon} {v.label_fr} ({v.source_year})
            </option>
          ))}
        </select>
        {variable && (
          <p className="text-[11px] text-text-tertiary mt-1.5">{variable.description_fr}</p>
        )}
      </div>

      {/* Presets narratifs */}
      <div>
        <div className="text-[11px] text-text-tertiary mb-1.5">Stratégie de ciblage rapide</div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PRESET_LABELS) as PresetKey[]).map(key => (
            <button
              key={key}
              type="button"
              onClick={() => onPresetApply(key)}
              title={PRESET_TAGLINES[key]}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-accent-teal/40 bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/20 transition-colors"
            >
              {PRESET_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {/* CurveEditor */}
      {variable && (
        <div className="border border-border-subtle rounded-md bg-bg-level-1 p-3">
          <div className="text-[11px] text-text-tertiary mb-1">Courbe de pondération · drag les poignées</div>
          <CurveEditor
            value={curve}
            onChange={onCurveChange}
            xMin={0}
            xMax={Math.ceil(variable.max / 5) * 5}
            xUnit={variable.unit}
            xMedian={variable.median}
            height={200}
          />
        </div>
      )}

      {/* Bandeau ratio sociétal */}
      {ratio && variable && (
        <div className="border border-accent-teal/30 bg-accent-teal/5 rounded-md p-3">
          <div className="text-[11px] text-accent-teal font-medium mb-1">📊 Impact de votre courbe</div>
          <p className="text-[12px] text-text-secondary leading-relaxed">
            <span className="text-text-primary font-medium">{ratio.n_boosted.toLocaleString('fr-FR')}</span> CPs ciblés (boost ≥ ×1.5) sur {ratio.n_total.toLocaleString('fr-FR')} —
            soit <span className="text-text-primary font-medium">{ratio.pct_boosted.toFixed(0)}%</span> du territoire.{' '}
            {ratio.n_boosted > 0 && (
              <>
                Sur ces zones, la {variable.label_fr.toLowerCase()} moyenne est de{' '}
                <span className="text-text-primary font-medium">{ratio.avg_value_boosted.toFixed(1)}{variable.unit}</span>
                {' '}(vs {ratio.avg_value_total.toFixed(1)}{variable.unit} en moyenne France).
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
