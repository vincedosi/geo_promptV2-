'use client';

import { useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ProposedAction } from '@/lib/agent/types';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const RISK_COLORS = {
  low: '#3dffa0',
  medium: '#f7b731',
  high: '#ff5757',
} as const;

interface Props {
  action: ProposedAction;
  index: number;
  auditId: string;
  /** True si l'action a déjà été auto-appliquée par enforceAutonomy. */
  autoApplied?: boolean;
  onResult?: (status: 'approved' | 'rejected') => void;
}

export function AgentRecommendationCard({ action, index, auditId, autoApplied, onResult }: Props) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [done, setDone] = useState<null | 'approved' | 'rejected'>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    setError(null);
    try {
      const res = await adminFetch('/api/agent/apply-recommendation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audit_id: auditId, action_index: index, decision }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setDone(decision === 'approve' ? 'approved' : 'rejected');
      onResult?.(decision === 'approve' ? 'approved' : 'rejected');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  const finalState = autoApplied ? 'auto-applied' : done;

  return (
    <div
      style={{
        padding: 12,
        background: 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          style={{
            fontFamily: fMono, fontSize: 10, padding: '2px 6px', borderRadius: 4,
            background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)',
          }}
        >
          {action.type}
        </span>
        <span
          style={{
            fontFamily: fMono, fontSize: 10, padding: '2px 6px', borderRadius: 4,
            background: `${RISK_COLORS[action.risk]}1a`,
            border: `0.5px solid ${RISK_COLORS[action.risk]}40`,
            color: RISK_COLORS[action.risk],
          }}
        >
          {action.risk}
        </span>
      </div>
      <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 8 }}>
        {action.reasoning}
      </div>
      {Object.keys(action.params).length > 0 && (
        <pre style={{
          margin: '0 0 8px', padding: '6px 8px', fontSize: 10, fontFamily: fMono,
          background: 'rgba(0,0,0,0.25)', color: 'var(--text-tertiary)',
          borderRadius: 4, overflowX: 'auto', maxHeight: 80,
        }}>
{JSON.stringify(action.params, null, 2)}
        </pre>
      )}
      {finalState === 'auto-applied' && (
        <span style={{ fontSize: 11, fontFamily: fMono, color: '#3dffa0' }}>✓ auto-appliqué</span>
      )}
      {finalState === 'approved' && (
        <span style={{ fontSize: 11, fontFamily: fMono, color: '#3dffa0' }}>✓ approuvé</span>
      )}
      {finalState === 'rejected' && (
        <span style={{ fontSize: 11, fontFamily: fMono, color: 'var(--text-tertiary)' }}>✗ rejeté</span>
      )}
      {!finalState && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            disabled={busy !== null}
            onClick={() => submit('approve')}
            style={{
              padding: '5px 10px', fontFamily: fInter, fontSize: 11, fontWeight: 500,
              background: 'var(--brand-teal)', color: '#050505',
              border: 'none', borderRadius: 4, cursor: busy ? 'wait' : 'pointer',
            }}
          >{busy === 'approve' ? '…' : 'Appliquer'}</button>
          <button
            disabled={busy !== null}
            onClick={() => submit('reject')}
            style={{
              padding: '5px 10px', fontFamily: fInter, fontSize: 11,
              background: 'transparent', color: 'var(--text-secondary)',
              border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 4,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >{busy === 'reject' ? '…' : 'Rejeter'}</button>
        </div>
      )}
      {error && (
        <div style={{ marginTop: 6, fontSize: 10, fontFamily: fMono, color: '#ff5757' }}>{error}</div>
      )}
    </div>
  );
}
