'use client';

/**
 * AgentLogs — feed des actions agent (table bidding_agent_actions) +
 * recommandations appliquées (table agent_recommendations).
 */
import { useEffect, useState } from 'react';
import { ScrollText, RefreshCw, Bot, User } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface AppliedReco {
  id: string;
  category: string;
  title: string;
  status: 'applied' | 'ignored';
  applied_at: string | null;
  proposed_action: { type?: string } | null;
}

interface Props {
  strategyId: string;
}

export function AgentLogs({ strategyId }: Props) {
  const [recos, setRecos] = useState<AppliedReco[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [appliedRes, ignoredRes] = await Promise.all([
        adminFetch(`/api/bidding/strategies/${strategyId}/recommendations?status=applied`, { cache: 'no-store' }),
        adminFetch(`/api/bidding/strategies/${strategyId}/recommendations?status=ignored`, { cache: 'no-store' }),
      ]);
      const aJson = appliedRes.ok ? await appliedRes.json() : { recommendations: [] };
      const iJson = ignoredRes.ok ? await ignoredRes.json() : { recommendations: [] };
      const all: AppliedReco[] = [...(aJson.recommendations ?? []), ...(iJson.recommendations ?? [])];
      all.sort((a, b) => (b.applied_at ?? '').localeCompare(a.applied_at ?? ''));
      setRecos(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [strategyId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: 12, fontFamily: fInter, color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <ScrollText size={12} strokeWidth={1.8} color="var(--brand-teal)" />
        <span style={{ fontSize: 11, fontWeight: 500 }}>Journal des actions</span>
        {recos && (
          <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
            ({recos.length} entrées)
          </span>
        )}
        <button
          type="button"
          onClick={() => { void load(); }}
          disabled={loading}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 9px', fontSize: 10, fontFamily: fMono,
            background: 'transparent', color: 'var(--text-tertiary)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 4, cursor: 'pointer',
          }}
        >
          <RefreshCw size={10} className={loading ? 'agent-spin' : undefined} /> rafraîchir
        </button>
      </div>

      {error && (
        <div style={{
          padding: '6px 10px', background: 'var(--bg-level-2)',
          border: '0.5px solid var(--danger)', borderRadius: 5,
          fontSize: 11, fontFamily: fMono, color: 'var(--danger)', marginBottom: 8,
        }}>{error}</div>
      )}

      {recos && recos.length === 0 && (
        <div style={{
          padding: 16, textAlign: 'center',
          fontSize: 11, fontFamily: fInter, color: 'var(--text-tertiary)',
          background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
          borderRadius: 8,
        }}>
          Aucune action enregistrée pour le moment.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(recos ?? []).map(r => {
          const isApplied = r.status === 'applied';
          const date = r.applied_at ? new Date(r.applied_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
          const Icon = isApplied ? Bot : User;
          return (
            <div
              key={r.id}
              style={{
                padding: '6px 10px',
                background: 'var(--bg-level-2)',
                border: '0.5px solid var(--border-subtle)',
                borderLeft: `2px solid ${isApplied ? 'var(--brand-teal)' : 'var(--text-tertiary)'}`,
                borderRadius: 4,
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 11, fontFamily: fInter,
              }}
            >
              <Icon size={11} strokeWidth={1.8} color={isApplied ? 'var(--brand-teal)' : 'var(--text-tertiary)'} />
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.title}</span>
              <span style={{
                fontSize: 9, fontFamily: fMono, padding: '1px 6px', borderRadius: 3,
                background: 'var(--bg-level-1)',
                color: isApplied ? 'var(--brand-teal)' : 'var(--text-tertiary)',
                border: `0.5px solid ${isApplied ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
              }}>
                {isApplied ? 'appliqué' : 'ignoré'}
              </span>
              {r.proposed_action?.type && (
                <span style={{ fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
                  ↳ {r.proposed_action.type}
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
                {date}
              </span>
            </div>
          );
        })}
      </div>

      <style>{`
        .agent-spin { animation: agentSpin 1s linear infinite; }
        @keyframes agentSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
