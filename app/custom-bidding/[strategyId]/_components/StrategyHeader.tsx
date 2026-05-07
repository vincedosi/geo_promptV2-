'use client';

import { useState } from 'react';
import Link from 'next/link';
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
  /** Si fournis, "Éditer" et "Historique" deviennent des callbacks inline (overlay /map). Sinon, fallback vers les Link historiques. */
  onEdit?: () => void;
  onShowHistory?: () => void;
  /** Statut de la stratégie. Si 'completed' on masque les actions opérationnelles ML. */
  status?: string;
  /** Mode de vue. En 'simple' on masque les actions opérationnelles ML. */
  viewMode?: 'simple' | 'expert';
}

const MODES: ExecutionMode[] = ['monitor_only', 'suggest', 'auto'];

export function StrategyHeader({
  strategyId, strategyName, campaignName, isDemo, algorithmCode,
  initialMode, onModeChange, onActionResult, onEdit, onShowHistory,
  status, viewMode = 'simple',
}: Props) {
  // Actions opérationnelles ML : visibles uniquement quand
  //   - la campagne est encore active (pas completed/archived)
  //   - ET on est en vue expert
  const showMlActions = viewMode === 'expert' && status !== 'completed' && status !== 'archived';
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
        padding: '12px 16px',
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        fontFamily: fInter, flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 280px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{campaignName}</h1>
          {isDemo && (
            <span style={{ fontSize: 10, fontFamily: fMono, padding: '2px 8px', borderRadius: 4, background: 'rgba(247,183,49,0.1)', border: '0.5px solid rgba(247,183,49,0.3)', color: '#f7b731' }}>
              demo data
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {strategyName} · <span style={{ fontFamily: fMono, color: 'var(--text-tertiary)' }}>{algorithmCode}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 2, padding: 2, background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 6 }}>
          {MODES.map(m => {
            const active = mode === m;
            return (
              <button
                key={m}
                disabled={busy !== null}
                onClick={() => updateMode(m)}
                style={{
                  padding: '5px 9px', fontSize: 10, fontFamily: fInter, fontWeight: 500,
                  background: active ? 'var(--brand-teal)' : 'transparent',
                  color: active ? '#050505' : 'var(--text-secondary)',
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

        {showMlActions && (
          <div style={{ display: 'flex', gap: 4 }}>
            <ActionButton
              label="Calculer les enchères"
              tooltip="Lance un cycle de prédiction : le modèle ML calcule les multiplicateurs d'enchère pour chaque zone à partir de la courbe et des données récentes, puis les pousse aux configs DSP."
              running={busy === 'predict'}
              disabled={busy !== null}
              primary
              onClick={() => callBidding('predict', 'predict')}
            />
            <ActionButton
              label="Réentraîner le modèle"
              tooltip="Réapprentissage du modèle Hoeffding Adaptive Tree sur les observations récentes. Met à jour les paramètres internes pour mieux refléter la performance réelle."
              running={busy === 'train'}
              disabled={busy !== null}
              onClick={() => callBidding('train', 'train')}
            />
            <ActionButton
              label="Vérifier les déviations"
              tooltip="Détection de drift sur les 7 derniers jours. Identifie les zones où la performance réelle s'écarte significativement de la simulation."
              running={busy === 'drift'}
              disabled={busy !== null}
              onClick={() => callBidding('detect-drift', 'detect-drift')}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 4, marginLeft: 8, paddingLeft: 8, borderLeft: '0.5px solid rgba(255,255,255,0.08)' }}>
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              style={{
                padding: '6px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
                background: 'transparent', color: 'var(--text-secondary)',
                border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 6,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Éditer
            </button>
          ) : (
            <Link
              href={`/map?overlay=pilotage&action=edit&strategy=${strategyId}`}
              style={{
                padding: '6px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
                background: 'transparent', color: 'var(--text-secondary)',
                border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 6,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Éditer
            </Link>
          )}
          {onShowHistory ? (
            <button
              type="button"
              onClick={onShowHistory}
              style={{
                padding: '6px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
                background: 'transparent', color: 'var(--text-tertiary)',
                border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 6,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Historique
            </button>
          ) : (
            <Link
              href={`/map?overlay=pilotage&action=history&strategy=${strategyId}`}
              style={{
                padding: '6px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
                background: 'transparent', color: 'var(--text-tertiary)',
                border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 6,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Historique
            </Link>
          )}
        </div>
      </div>

      {feedback && (
        <div
          style={{
            flexBasis: '100%',
            padding: '6px 10px', fontSize: 11, fontFamily: fMono,
            background: feedback.kind === 'ok' ? 'rgba(61,255,160,0.08)' : 'rgba(255,87,87,0.08)',
            border: `0.5px solid ${feedback.kind === 'ok' ? 'rgba(61,255,160,0.3)' : 'rgba(255,87,87,0.3)'}`,
            color: feedback.kind === 'ok' ? '#3dffa0' : '#ff5757',
            borderRadius: 6,
          }}
        >
          {feedback.msg}
        </div>
      )}
    </header>
  );
}

function ActionButton({ label, tooltip, running, disabled, onClick, primary }: { label: string; tooltip?: string; running: boolean; disabled: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={tooltip}
      style={{
        padding: '6px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
        background: primary ? 'var(--brand-teal)' : 'transparent',
        color: primary ? 'var(--bg-level-0)' : 'var(--brand-teal)',
        border: primary ? 'none' : '0.5px solid var(--brand-teal)',
        borderRadius: 6, whiteSpace: 'nowrap',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !running ? 0.5 : 1,
      }}
    >
      {running ? '…' : label}
    </button>
  );
}
