'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type {
  MLAgentStep, ExecutionMode, AlertSeverity, InitPreset,
} from '@/lib/strategy-wizard/types';
import { AUTONOMY_LABELS_FR } from '@/lib/strategy-wizard/types';

interface Props {
  data: MLAgentStep;
  onChange: (next: MLAgentStep) => void;
  onPresetApply?: (preset: InitPreset) => void;
}

interface AlgoOpt {
  code: string;
  display_name: string;
  family?: string;
  is_baseline?: boolean;
}

const MODES: Array<{ value: ExecutionMode; label: string; desc: string }> = [
  { value: 'monitor_only', label: 'Monitor', desc: "L'algo observe sans agir" },
  { value: 'suggest', label: 'Suggest', desc: 'Propose, vous validez (recommandé)' },
  { value: 'auto', label: 'Auto', desc: "L'algo agit seul" },
];

const SEVERITIES: AlertSeverity[] = ['low', 'medium', 'high', 'critical'];
const NOTIF_CHANNELS: Array<{ value: string; label: string }> = [
  { value: 'in_app', label: 'In-app' },
  { value: 'email', label: 'Email' },
  { value: 'slack', label: 'Slack' },
];

export function Step5MLAgent({ data, onChange, onPresetApply }: Props) {
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
        <h3 className="flex items-center gap-2 text-[12px] font-medium text-[#f0f0f0] mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4ecdc4]" /> ML
        </h3>

        <div className="grid grid-cols-1 gap-5">
          <Field label="Algorithme *">
            <select
              value={data.algorithm_code ?? 'hoeffding_adaptive_tree'}
              onChange={(e) => set('algorithm_code', e.target.value)}
              className={inputCls}
            >
              {algos.map(a => (
                <option key={a.code} value={a.code}>{a.display_name}{a.is_baseline ? ' (baseline)' : ''}</option>
              ))}
            </select>
          </Field>

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
                      ? 'border-[rgba(78,205,196,0.5)] bg-[#111]'
                      : 'border-[#1a1a1a] bg-[#0a0a0a] hover:border-[#333]'
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium text-[#f0f0f0]">{p.display_name_fr}</span>
                    <span className="text-[10px] font-mono text-[#a0a0a0]">×{p.in_zone_multiplier}/×{p.out_zone_multiplier}</span>
                  </div>
                  <p className="text-[11px] text-[#666] mt-1">{p.description_fr}</p>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#666] mt-2">
              Note : les multipliers détaillés du Step 2 prennent le dessus.
            </p>
          </Field>

          <Field label="Mode d'exécution *">
            <div className="grid grid-cols-1 gap-2">
              {MODES.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => set('execution_mode', m.value)}
                  className={`flex items-baseline justify-between gap-3 p-3 rounded-md border text-left transition-colors ${
                    data.execution_mode === m.value
                      ? 'border-[rgba(78,205,196,0.5)] bg-[#111]'
                      : 'border-[#1a1a1a] bg-[#0a0a0a] hover:border-[#333]'
                  }`}
                >
                  <div>
                    <div className="text-xs font-medium text-[#f0f0f0]">{m.label}</div>
                    <div className="text-[11px] text-[#666] mt-0.5">{m.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </Field>
        </div>
      </section>

      {/* Agent IA */}
      <section>
        <h3 className="flex items-center gap-2 text-[12px] font-medium text-[#f0f0f0] mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4ecdc4]" /> Agent IA
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
                const sel = (data.notification_channels ?? ['in_app']).includes(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => toggleChannel(c.value)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      sel
                        ? 'border-[rgba(78,205,196,0.5)] bg-[#111] text-[#f0f0f0]'
                        : 'border-[#1a1a1a] bg-[#0a0a0a] text-[#a0a0a0] hover:border-[#333]'
                    }`}
                  >
                    {c.label}
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
                      ? 'border-[rgba(78,205,196,0.5)] bg-[#111] text-[#f0f0f0]'
                      : 'border-[#1a1a1a] bg-[#0a0a0a] text-[#a0a0a0] hover:border-[#333]'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </section>
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
