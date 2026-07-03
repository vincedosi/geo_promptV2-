'use client';

/**
 * Side panel droit GeoAgent. Affiche les messages chat + recommandations.
 * Auto-déclenche l'analyse si openContext.drift_event_id est fourni.
 */
import { useEffect, useRef, useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { MessageList, MessageInput } from '@/lib/prompting/chat-ui';
import type { ChatMessage } from '@/lib/prompting/types';
import type { AutonomyLevel, ProposedAction } from '@/lib/agent/types';
import { useAgent } from './AgentProvider';
import { AgentRecommendationCard } from './AgentRecommendationCard';
import { AgentAutonomyBadge } from './AgentAutonomyBadge';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface AgentResponseShape {
  intent: string;
  response_text: string;
  applied_actions: ProposedAction[];
  suggested_actions: ProposedAction[];
  audit_id: string | null;
  autonomy_level: AutonomyLevel;
}

interface ConversationTurn {
  message: ChatMessage;
  applied?: ProposedAction[];
  suggested?: ProposedAction[];
  audit_id?: string | null;
}

export function AgentPanel() {
  const { isOpen, close, currentContext } = useAgent();
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState<AutonomyLevel | null>(null);
  const lastDriftRef = useRef<string | null>(null);

  // Reset à chaque ouverture/changement de context.
  useEffect(() => {
    if (!isOpen) return;
    setTurns([]);
    setError(null);
    lastDriftRef.current = null;
  }, [isOpen, currentContext.drift_event_id, currentContext.strategy_id]);

  // Auto-déclenche analyze_drift si context.drift_event_id est fourni à l'ouverture.
  useEffect(() => {
    if (!isOpen) return;
    const driftId = currentContext.drift_event_id;
    if (!driftId || lastDriftRef.current === driftId) return;
    lastDriftRef.current = driftId;
    runAnalyzeDrift(driftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentContext.drift_event_id]);

  const runAnalyzeDrift = async (driftId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/agent/analyze-drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drift_event_id: driftId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      const r = body as AgentResponseShape;
      setAutonomy(r.autonomy_level);
      setTurns(prev => [
        ...prev,
        {
          message: { role: 'assistant', content: r.response_text },
          applied: r.applied_actions,
          suggested: r.suggested_actions,
          audit_id: r.audit_id,
        },
      ]);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (text: string) => {
    setTurns(prev => [...prev, { message: { role: 'user', content: text } }]);
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context: currentContext }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      const r = body as AgentResponseShape;
      setAutonomy(r.autonomy_level);
      setTurns(prev => [
        ...prev,
        {
          message: { role: 'assistant', content: r.response_text },
          applied: r.applied_actions,
          suggested: r.suggested_actions,
          audit_id: r.audit_id,
        },
      ]);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <aside
      role="dialog"
      aria-label="GeoAgent"
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 420, maxWidth: '95vw', zIndex: 60,
        background: 'var(--card-overlay, rgba(10,10,10,0.94))',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        borderLeft: '0.5px solid rgba(255,255,255,0.08)',
        display: 'flex', flexDirection: 'column',
        animation: 'agentSlide 200ms var(--ease-out, ease) both',
      }}
    >
      <header
        style={{
          padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8,
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
          fontFamily: fInter,
        }}
      >
        <Sparkles size={14} style={{ color: 'var(--brand-teal)' }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>GeoAgent</span>
        {autonomy !== null && <AgentAutonomyBadge level={autonomy} />}
        <span style={{ flex: 1 }} />
        <button
          onClick={close}
          aria-label="Fermer"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 4, color: 'var(--text-tertiary)', display: 'flex',
          }}
        >
          <X size={16} />
        </button>
      </header>

      {/* Context badge */}
      {(currentContext.drift_event_id || currentContext.strategy_id) && (
        <div style={{
          padding: '8px 14px',
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
          fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)',
          display: 'flex', flexWrap: 'wrap', gap: 8,
        }}>
          {currentContext.drift_event_id && (
            <span title={currentContext.drift_event_id}>drift · {currentContext.drift_event_id.slice(0, 8)}…</span>
          )}
          {currentContext.strategy_id && (
            <span title={currentContext.strategy_id}>stratégie · {currentContext.strategy_id.slice(0, 8)}…</span>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {turns.length === 0 && !loading && (
          <div style={{ padding: 20, fontSize: 12, fontFamily: fInter, color: 'var(--text-tertiary)', textAlign: 'center' }}>
            Posez une question ou cliquez sur un drift event pour lancer une analyse.
          </div>
        )}
        <MessageList
          messages={turns.map(t => t.message)}
          loading={loading}
          error={error}
          assistantLabel="A"
          maxHeight={700}
        />
        {/* Recommandations attachées au dernier turn assistant */}
        {turns.length > 0 && (() => {
          const lastAssistantIdx = [...turns].reverse().findIndex(t => t.message.role === 'assistant');
          if (lastAssistantIdx === -1) return null;
          const turn = turns[turns.length - 1 - lastAssistantIdx];
          const auditId = turn.audit_id ?? '';
          const applied = turn.applied ?? [];
          const suggested = turn.suggested ?? [];
          if (applied.length === 0 && suggested.length === 0) return null;
          return (
            <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {applied.map((a, i) => (
                <AgentRecommendationCard key={`a-${i}`} action={a} index={i} auditId={auditId} autoApplied />
              ))}
              {suggested.map((a, i) => (
                <AgentRecommendationCard key={`s-${i}`} action={a} index={applied.length + i} auditId={auditId} />
              ))}
            </div>
          );
        })()}
      </div>

      <MessageInput
        onSend={handleSend}
        loading={loading}
        placeholder="Demandez à GeoAgent…"
      />

      <style>{`
        @keyframes agentSlide {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </aside>
  );
}
