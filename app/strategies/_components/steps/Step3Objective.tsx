'use client';

import { useEffect, useMemo, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ObjectiveStep, AttributionModel } from '@/lib/strategy-wizard/types';
import { ATTRIBUTION_LABELS_FR } from '@/lib/strategy-wizard/types';

interface Props {
  data: ObjectiveStep;
  onChange: (next: ObjectiveStep) => void;
}

interface ObjectiveOpt {
  code: string;
  display_name: string;
  optimization_direction?: string;
}

const ATTRIB: AttributionModel[] = ['last_click', 'first_click', 'linear'];

/** Traduction FR des display_name renvoyés par /api/bidding/objectives.
 *  L'API renvoie de l'anglais ("Maximize Impressions") — on l'écrase ici
 *  pour rester cohérent avec le reste du wizard. */
const OBJECTIVE_LABELS_FR: Record<string, string> = {
  maximize_impressions: 'Maximiser les impressions',
  maximize_viewability: 'Maximiser la visibilité',
  maximize_ctr:         'Maximiser le CTR',
  maximize_visits:      'Maximiser les visites',
  maximize_leads:       'Maximiser les leads',
  minimize_cpa:         'Minimiser le CPA',
  minimize_cpc:         'Minimiser le CPC',
  maximize_roas:        'Maximiser le ROAS',
};

/** Unité affichée à droite de la cible quantifiée selon l'objectif choisi. */
const OBJECTIVE_TARGET_UNIT: Record<string, string> = {
  maximize_impressions: 'impressions',
  maximize_viewability: '% visibilité',
  maximize_ctr:         '% CTR',
  maximize_visits:      'visites',
  maximize_leads:       'leads',
  minimize_cpa:         '€ par action',
  minimize_cpc:         '€ par clic',
  maximize_roas:        '× ROAS',
};

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

  const objLabel = (o: ObjectiveOpt) => OBJECTIVE_LABELS_FR[o.code] ?? o.display_name;
  const targetUnit = useMemo(
    () => (data.objective_code ? OBJECTIVE_TARGET_UNIT[data.objective_code] : null),
    [data.objective_code],
  );

  return (
    <div className="grid grid-cols-1 gap-5 max-w-2xl">
      <Field
        label="KPI primaire *"
        tagline="L'algorithme optimisera prioritairement cette métrique."
      >
        <select
          value={data.objective_code ?? ''}
          onChange={(e) => set('objective_code', e.target.value || undefined)}
          className={selectCls}
        >
          <option value="">— Sélectionner —</option>
          {objectives.map(o => (
            <option key={o.code} value={o.code}>{objLabel(o)}</option>
          ))}
        </select>
      </Field>

      <Field
        label="Cible quantifiée *"
        tagline="Valeur cible à atteindre pour le KPI primaire."
      >
        <div className="flex items-center gap-2 max-w-xs">
          <input
            type="number"
            step="0.01"
            value={data.kpi_target ?? ''}
            onChange={(e) => set('kpi_target', e.target.value === '' ? undefined : parseFloat(e.target.value))}
            placeholder="12.5"
            className={inputCls + ' flex-1'}
          />
          {targetUnit && (
            <span className="text-[11px] font-mono text-text-tertiary whitespace-nowrap">{targetUnit}</span>
          )}
        </div>
      </Field>

      <Field
        label="KPIs secondaires"
        tagline="Métriques à surveiller en parallèle (optionnel)."
      >
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
                    ? 'border-accent-teal/50 bg-bg-level-2 text-text-primary'
                    : 'border-border-subtle bg-bg-level-1 text-text-secondary hover:border-border-hover hover:text-text-primary'
                }`}
              >
                {objLabel(o)}
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label="Modèle d'attribution"
        tagline="Quel touchpoint compte pour 100% de la conversion."
      >
        <div className="flex gap-2">
          {ATTRIB.map(a => (
            <button
              key={a}
              type="button"
              onClick={() => set('attribution_model', a)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                data.attribution_model === a
                  ? 'border-accent-teal/50 bg-bg-level-2 text-text-primary'
                  : 'border-border-subtle bg-bg-level-1 text-text-secondary hover:border-border-hover hover:text-text-primary'
              }`}
            >
              {ATTRIBUTION_LABELS_FR[a]}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

const inputCls = 'w-full bg-bg-level-2 border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-teal/50';
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
