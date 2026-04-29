'use client';

import { useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

type ExecutionMode = 'monitor_only' | 'suggest' | 'auto';

interface Props {
  strategyId: string;
  strategyName: string;
  campaignName: string;
  isDemo: boolean;
  algorithmCode: string;
  initialMode: ExecutionMode;
  onModeChange?: (m: ExecutionMode) => void;
  onActionResult?: (label: string, payload: Record<string, unknown> | string) => void;
}

const MODES: ExecutionMode[] = ['monitor_only', 'suggest', 'auto'];

export function StrategyHeader({
  strategyId, strategyName, campaignName, isDemo, algorithmCode,
  initialMode, onModeChange, onActionResult,
}: Props) {
  const [mode, setMode] = useState<ExecutionMode>(initialMode);
  const [busy, setBusy] = useState<null | 'predict' | 'train' | 'drift' | 'mode'>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const updateMode = async (next: ExecutionMode) => {
    if (next === mode) return;
    setBusy('mode');
    setFeedback(null);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execution_mode: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMode(next);
      onModeChange?.(next);
      setFeedback({ kind: 'ok', msg: `mode → ${next}` });
    } catch (e) {
      setFeedback({ kind: 'err', msg: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const callBidding = async (path: 'predict' | 'train' | 'detect-drift', label: string) => {
    const key = path === 'detect-drift' ? 'drift' : path;
    setBusy(key as 'predict' | 'train' | 'drift');
    setFeedback(null);
    try {
      const res = await adminFetch(`/api/bidding/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_id: strategyId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      onActionResult?.(label, body);
      const summary = body.n_persisted != null
        ? `${label} ok — ${body.n_persisted} rows (${body.duration_ms ?? '?'}ms)`
        : body.n_drifts_detected != null
          ? `${label} ok — ${body.n_drifts_detected} drift(s) (${body.duration_ms ?? '?'}ms)`
          : `${label} ok`;
      setFeedback({ kind: 'ok', msg: summary });
    } catch (e) {
      setFeedback({ kind: 'err', msg: String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        padding: '14px 20px',
        background: 'var(--bg-card, #0a0a0a)',
        borderBottom: '0.5px solid var(--border-subtle, #1a1a1a)',
        fontFamily: fInter,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal, #4ecdc4)', flexShrink: 0 }} />
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: 'var(--text-primary, #f0f0f0)' }}>{campaignName}</h1>
          {isDemo && (
            <span style={{ fontSize: 10, fontFamily: fMono, padding: '2px 8px', borderRadius: 4, background: 'rgba(247,183,49,0.1)', border: '0.5px solid rgba(247,183,49,0.3)', color: '#f7b731' }}>
              demo data
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #a0a0a0)', marginTop: 4 }}>
          {strategyName} · <span style={{ fontFamily: fMono, color: 'var(--text-tertiary, #666)' }}>{algorithmCode}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 2, background: 'var(--bg-level-2, #111)', border: '0.5px solid var(--border-default, #262626)', borderRadius: 6 }}>
          {MODES.map(m => {
            const active = mode === m;
            return (
              <button
                key={m}
                disabled={busy !== null}
                onClick={() => updateMode(m)}
                style={{
                  padding: '6px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
                  background: active ? 'var(--brand-teal, #4ecdc4)' : 'transparent',
                  color: active ? '#050505' : 'var(--text-secondary, #a0a0a0)',
                  border: 'none', borderRadius: 4,
                  cursor: busy !== null ? 'not-allowed' : 'pointer',
                  opacity: busy !== null && busy !== 'mode' ? 0.5 : 1,
                }}
              >
                {m}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <ActionButton
            label="Lancer l'algo"
            running={busy === 'predict'}
            disabled={busy !== null}
            primary
            onClick={() => callBidding('predict', 'predict')}
          />
          <ActionButton
            label="Ré-entraîner"
            running={busy === 'train'}
            disabled={busy !== null}
            onClick={() => callBidding('train', 'train')}
          />
          <ActionButton
            label="Détecter drifts"
            running={busy === 'drift'}
            disabled={busy !== null}
            onClick={() => callBidding('detect-drift', 'detect-drift')}
          />
        </div>
      </div>

      {feedback && (
        <div
          style={{
            position: 'absolute', top: 56, right: 24, zIndex: 5,
            padding: '8px 12px', fontSize: 11, fontFamily: fMono,
            background: feedback.kind === 'ok' ? 'rgba(61,255,160,0.08)' : 'rgba(255,87,87,0.08)',
            border: `0.5px solid ${feedback.kind === 'ok' ? 'rgba(61,255,160,0.3)' : 'rgba(255,87,87,0.3)'}`,
            color: feedback.kind === 'ok' ? '#3dffa0' : '#ff5757',
            borderRadius: 6, maxWidth: 420,
          }}
        >
          {feedback.msg}
        </div>
      )}
    </header>
  );
}

function ActionButton({ label, running, disabled, onClick, primary }: { label: string; running: boolean; disabled: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '8px 14px', fontSize: 12, fontFamily: fInter, fontWeight: 500,
        background: primary ? 'var(--brand-teal, #4ecdc4)' : 'transparent',
        color: primary ? '#050505' : 'var(--brand-teal, #4ecdc4)',
        border: primary ? 'none' : '0.5px solid var(--brand-teal, #4ecdc4)',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !running ? 0.5 : 1,
      }}
    >
      {running ? '…' : label}
    </button>
  );
}
