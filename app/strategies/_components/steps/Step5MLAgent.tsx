'use client';

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import type {
  MLAgentStep, ExecutionMode, AlertSeverity, InitPreset,
} from '@/lib/strategy-wizard/types';
import {
  AUTONOMY_LABELS_FR, ALGORITHM_LABELS_FR,
  EXECUTION_MODE_LABELS_FR, EXECUTION_MODE_DESC_FR,
  ALERT_SEVERITY_LABELS_FR, NOTIFICATION_CHANNEL_LABELS_FR,
} from '@/lib/strategy-wizard/types';

interface Props {
  data: MLAgentStep;
  onChange: (next: MLAgentStep) => void;
  onPresetApply?: (preset: InitPreset) => void;
  /** Si true, la section "Initialisation (preset)" est désactivée car
   *  l'utilisateur a déjà configuré explicitement la pondération à l'étape 2. */
  geoConfigured?: boolean;
}

interface AlgoOpt {
  code: string;
  display_name: string;
  family?: string;
  is_baseline?: boolean;
}

const MODES: Array<{ value: ExecutionMode; label: string; desc: string }> = (
  ['monitor_only', 'suggest', 'auto'] as ExecutionMode[]
).map(m => ({
  value: m,
  label: EXECUTION_MODE_LABELS_FR[m],
  desc: EXECUTION_MODE_DESC_FR[m],
}));

const SEVERITIES: AlertSeverity[] = ['low', 'medium', 'high', 'critical'];
const NOTIF_CHANNELS = ['in_app', 'email', 'slack'];

export function Step5MLAgent({ data, onChange, onPresetApply, geoConfigured }: Props) {
  const set = <K extends keyof MLAgentStep>(k: K, v: MLAgentStep[K]) =>
    onChange({ ...data, [k]: v });

  const [algos, setAlgos] = useState<AlgoOpt[]>([]);
  const [presets, setPresets] = useState<InitPreset[]>([]);

  useEffect(() => {
    Promise.all([
      adminFetch('/api/bidding/algorithms', { cache: 'no-store' }).then(r => r.ok ? r.json() : { algorithms: [] }),
      adminFetch('/api/bidding/init-presets', { cache: 'no-store' }).then(r => r.ok ? r.json() : { presets: [] }),
    ]).then(([a, p]) => {
      setAlgos((a.algorithms ?? []) as AlgoOpt[]);
      setPresets((p.presets ?? []) as InitPreset[]);
    }).catch(() => {});
  }, []);

  const toggleChannel = (c: string) => {
    const cur = data.notification_channels ?? [];
    set('notification_channels', cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c]);
  };

  return (
    <div className="grid grid-cols-1 gap-6 max-w-3xl">
      {/* ML */}
      <section>
        <h3 className="flex items-center gap-2 text-[12px] font-medium text-text-primary mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" /> ML
        </h3>

        <div className="grid grid-cols-1 gap-5">
          <Field label="Algorithme *">
            <select
              value={data.algorithm_code ?? 'hoeffding_adaptive_tree'}
              onChange={(e) => set('algorithm_code', e.target.value)}
              className={inputCls}
            >
              {algos.map(a => {
                const frName = ALGORITHM_LABELS_FR[a.code];
                const display = frName
                  ? `${frName} — ${a.display_name}`
                  : a.display_name;
                return (
                  <option key={a.code} value={a.code}>
                    {display}{a.is_baseline ? ' (baseline)' : ''}
                  </option>
                );
              })}
            </select>
          </Field>

          {geoConfigured ? (
            <div className="flex items-start gap-2 p-3 rounded-md border border-border-subtle bg-bg-level-1 text-[11px] text-text-tertiary">
              <Lock className="h-3.5 w-3.5 text-text-tertiary mt-0.5 shrink-0" />
              <div>
                <span className="text-text-secondary font-medium">Pondération déjà configurée à l'étape 2.</span>
                <span> Les presets rapides sont désactivés car vos multipliers détaillés (par sous-zone, tier ou CSV) prennent le dessus.</span>
              </div>
            </div>
          ) : (
            <Field label="Initialisation (preset rapide)">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {presets.map(p => (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => {
                      set('init_preset_code', p.code);
                      onPresetApply?.(p);
                    }}
                    className={`text-left p-3 rounded-md border transition-colors ${
                      data.init_preset_code === p.code
                        ? 'border-accent-teal/50 bg-bg-level-2'
                        : 'border-border-subtle bg-bg-level-1 hover:border-border-hover'
                    }`}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-medium text-text-primary">{p.display_name_fr}</span>
                      <span className="text-[10px] font-mono text-text-secondary">×{p.in_zone_multiplier}/×{p.out_zone_multiplier}</span>
                    </div>
                    <p className="text-[11px] text-text-tertiary mt-1">{p.description_fr}</p>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-tertiary mt-2">
                Configure une pondération initiale rapide. Les détails de l'étape 2 (sous-zones, tiers, CSV) écrasent ces valeurs si présents.
              </p>
            </Field>
          )}

          <Field label="Mode d'exécution *">
            <div className="grid grid-cols-1 gap-2">
              {MODES.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => set('execution_mode', m.value)}
                  className={`flex items-baseline justify-between gap-3 p-3 rounded-md border text-left transition-colors ${
                    data.execution_mode === m.value
                      ? 'border-accent-teal/50 bg-bg-level-2'
                      : 'border-border-subtle bg-bg-level-1 hover:border-border-hover'
                  }`}
                >
                  <div>
                    <div className="text-xs font-medium text-text-primary">{m.label}</div>
                    <div className="text-[11px] text-text-tertiary mt-0.5">{m.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </Field>
        </div>
      </section>

      {/* Agent IA */}
      <section>
        <h3 className="flex items-center gap-2 text-[12px] font-medium text-text-primary mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" /> Agent IA
        </h3>

        <div className="grid grid-cols-1 gap-5">
          <Field label="Niveau d'autonomie pour cette stratégie">
            <select
              value={data.agent_autonomy_override === null || data.agent_autonomy_override === undefined ? '' : data.agent_autonomy_override}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') set('agent_autonomy_override', null);
                else set('agent_autonomy_override', parseInt(v, 10) as 0 | 1 | 2 | 3 | 4);
              }}
              className={inputCls}
            >
              <option value="">— Hériter du défaut user —</option>
              {[0, 1, 2, 3, 4].map(lvl => (
                <option key={lvl} value={lvl}>Niveau {lvl} — {AUTONOMY_LABELS_FR[lvl]}</option>
              ))}
            </select>
          </Field>

          <Field label="Notifications">
            <div className="flex flex-wrap gap-2">
              {NOTIF_CHANNELS.map(c => {
                const sel = (data.notification_channels ?? ['in_app']).includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleChannel(c)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      sel
                        ? 'border-accent-teal/50 bg-bg-level-2 text-text-primary'
                        : 'border-border-subtle bg-bg-level-1 text-text-secondary hover:border-border-hover'
                    }`}
                  >
                    {NOTIFICATION_CHANNEL_LABELS_FR[c] ?? c}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Seuil d'alerte">
            <div className="flex gap-2">
              {SEVERITIES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set('alert_severity_threshold', s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    data.alert_severity_threshold === s
                      ? 'border-accent-teal/50 bg-bg-level-2 text-text-primary'
                      : 'border-border-subtle bg-bg-level-1 text-text-secondary hover:border-border-hover'
                  }`}
                >
                  {ALERT_SEVERITY_LABELS_FR[s]}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </section>
    </div>
  );
}

const inputCls = 'w-full bg-bg-level-2 border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-teal/50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] text-text-tertiary font-medium">{label}</span>
      {children}
    </label>
  );
}
