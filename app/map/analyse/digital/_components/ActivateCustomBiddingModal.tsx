'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface AlgoOption {
  code: string;
  display_name: string;
  family?: string;
  is_baseline?: boolean;
}
interface ObjectiveOption {
  code: string;
  display_name: string;
  optimization_direction?: string;
}

interface Props {
  campaignId: string;
  campaignName: string;
  open: boolean;
  onClose: () => void;
}

const MODES = [
  { value: 'suggest', label: 'Suggest', desc: "L'algo propose, vous validez (recommandé)" },
  { value: 'auto', label: 'Auto', desc: "L'algo agit seul, sans validation" },
  { value: 'monitor_only', label: 'Monitor', desc: "L'algo observe sans agir" },
] as const;

export function ActivateCustomBiddingModal({ campaignId, campaignName, open, onClose }: Props) {
  const router = useRouter();
  const [name, setName] = useState(`Pilotage ML — ${campaignName}`);
  const [algos, setAlgos] = useState<AlgoOption[] | null>(null);
  const [objectives, setObjectives] = useState<ObjectiveOption[] | null>(null);
  const [algoCode, setAlgoCode] = useState('');
  const [objectiveCode, setObjectiveCode] = useState('');
  const [executionMode, setExecutionMode] = useState<'suggest' | 'auto' | 'monitor_only'>('suggest');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(`Pilotage ML — ${campaignName}`);
    setError(null);
    Promise.all([
      adminFetch('/api/bidding/algorithms', { cache: 'no-store' }).then(r => r.ok ? r.json() : { algorithms: [] }),
      adminFetch('/api/bidding/objectives', { cache: 'no-store' }).then(r => r.ok ? r.json() : { objectives: [] }),
    ]).then(([a, o]) => {
      const aList = (a.algorithms ?? []) as AlgoOption[];
      const oList = (o.objectives ?? []) as ObjectiveOption[];
      setAlgos(aList);
      setObjectives(oList);
      if (aList.length > 0) setAlgoCode(aList[0].code);
      if (oList.length > 0) setObjectiveCode(oList[0].code);
    }).catch(e => setError(String(e)));
  }, [open, campaignName]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!algoCode || !objectiveCode || !name.trim()) {
      setError('Tous les champs sont requis');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await adminFetch('/api/bidding/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          name: name.trim(),
          algorithm_code: algoCode,
          objective_code: objectiveCode,
          execution_mode: executionMode,
          scope_type: 'national',
          is_demo: false,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const strategyId = body?.strategy?.id;
      if (strategyId) {
        router.push(`/custom-bidding/${strategyId}`);
      }
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', fontFamily: fInter,
      }}
    >
      <div
        style={{
          width: 480, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto',
          background: 'var(--bg-card, #0a0a0a)',
          border: '0.5px solid var(--border-default, #262626)',
          borderRadius: 8, padding: 0,
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '0.5px solid var(--border-subtle, #1a1a1a)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal, #4ecdc4)' }} />
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--text-primary, #f0f0f0)' }}>
            Activer Custom Bidding
          </h2>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Campagne">
            <div style={{ fontSize: 12, fontFamily: fMono, color: 'var(--text-secondary, #a0a0a0)', padding: '8px 10px', background: 'var(--bg-level-2, #181818)', borderRadius: 4 }}>
              {campaignName}
            </div>
          </Field>

          <Field label="Nom de la stratégie">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              style={inputStyle}
              disabled={submitting}
            />
          </Field>

          <Field label="Algorithme">
            <select
              value={algoCode}
              onChange={e => setAlgoCode(e.target.value)}
              style={inputStyle}
              disabled={submitting || !algos}
            >
              {algos === null && <option value="">Chargement…</option>}
              {algos?.map(a => (
                <option key={a.code} value={a.code}>
                  {a.display_name}{a.is_baseline ? ' · baseline' : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Objectif d'optimisation">
            <select
              value={objectiveCode}
              onChange={e => setObjectiveCode(e.target.value)}
              style={inputStyle}
              disabled={submitting || !objectives}
            >
              {objectives === null && <option value="">Chargement…</option>}
              {objectives?.map(o => (
                <option key={o.code} value={o.code}>{o.display_name}</option>
              ))}
            </select>
          </Field>

          <Field label="Mode d'exécution">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {MODES.map(m => {
                const active = executionMode === m.value;
                return (
                  <label
                    key={m.value}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '10px 12px', borderRadius: 6, cursor: submitting ? 'not-allowed' : 'pointer',
                      background: active ? 'rgba(78,205,196,0.06)' : 'var(--bg-level-2, #181818)',
                      border: `0.5px solid ${active ? 'var(--brand-teal, #4ecdc4)' : 'var(--border-default, #262626)'}`,
                    }}
                  >
                    <input
                      type="radio"
                      name="exec_mode"
                      value={m.value}
                      checked={active}
                      onChange={() => setExecutionMode(m.value)}
                      disabled={submitting}
                      style={{ marginTop: 3, accentColor: '#4ecdc4' }}
                    />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: active ? 'var(--brand-teal, #4ecdc4)' : 'var(--text-primary, #f0f0f0)' }}>
                        {m.label}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary, #666)', marginTop: 2 }}>
                        {m.desc}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </Field>

          {error && (
            <div style={{ padding: '8px 10px', fontSize: 11, fontFamily: fMono, background: 'rgba(255,87,87,0.08)', border: '0.5px solid rgba(255,87,87,0.3)', borderRadius: 4, color: '#ff5757' }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '0.5px solid var(--border-subtle, #1a1a1a)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '8px 14px', fontSize: 12, fontFamily: fInter,
              background: 'transparent', border: '0.5px solid var(--border-default, #262626)',
              color: 'var(--text-secondary, #a0a0a0)', borderRadius: 6,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !algoCode || !objectiveCode}
            style={{
              padding: '8px 14px', fontSize: 12, fontFamily: fInter, fontWeight: 500,
              background: 'var(--brand-teal, #4ecdc4)', color: '#050505',
              border: 'none', borderRadius: 6,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting || !algoCode || !objectiveCode ? 0.6 : 1,
            }}
          >
            {submitting ? 'Activation…' : 'Activer'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 12,
  fontFamily: "'Inter', system-ui, sans-serif",
  background: 'var(--bg-level-2, #181818)',
  color: 'var(--text-primary, #f0f0f0)',
  border: '0.5px solid var(--border-default, #262626)',
  borderRadius: 4, outline: 'none',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: 'Inter, system-ui, sans-serif', color: 'var(--text-tertiary, #666)', textTransform: 'lowercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}
