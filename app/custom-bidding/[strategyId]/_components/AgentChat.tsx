'use client';

/**
 * AgentChat — interface de conversation avec l'agent Gemini sur la stratégie.
 * Streaming progressif, persistance Supabase 7j, reset, affichage des tool calls.
 */
import { useEffect, useRef, useState } from 'react';
import { Send, RotateCcw, MessageSquare, Search } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Msg {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: Array<{ toolName: string; args?: Record<string, unknown> }> | null;
  pending?: boolean;
}

interface Props {
  strategyId: string;
}

export function AgentChat({ strategyId }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadHistory = async () => {
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/chat`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const msgs = (data.messages ?? []) as Array<{ id: string; role: 'user' | 'assistant' | 'tool'; content: string; tool_calls: unknown }>;
      setMessages(msgs.filter(m => m.role !== 'tool').map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        tool_calls: (m.tool_calls as Msg['tool_calls']) ?? null,
      })));
    } catch { /* ignore */ }
  };

  useEffect(() => { void loadHistory(); }, [strategyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const txt = input.trim();
    if (!txt || sending) return;
    setSending(true);
    setError(null);
    setInput('');
    setMessages(m => [...m, { role: 'user', content: txt }, { role: 'assistant', content: '', pending: true }]);

    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/chat`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: txt }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        acc += chunk;
        setMessages(m => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: acc, pending: false };
          return copy;
        });
      }
      // Recharge pour récupérer les tool_calls persistés
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages(m => m.filter(x => !x.pending));
    } finally {
      setSending(false);
    }
  };

  const reset = async () => {
    setSending(true);
    try {
      await adminFetch(`/api/bidding/strategies/${strategyId}/chat`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '__init__', reset: true }),
      });
      setMessages([]);
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  return (
    <div style={{ padding: 12, fontFamily: fInter, color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', height: 460 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <MessageSquare size={12} strokeWidth={1.8} color="var(--brand-teal)" />
        <span style={{ fontSize: 11, fontWeight: 500 }}>Chat avec l&apos;agent</span>
        <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
          gemini-2.5-flash · function calling
        </span>
        <button
          type="button"
          onClick={() => { void reset(); }}
          disabled={sending}
          title="Réinitialiser la conversation"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', fontSize: 10, fontFamily: fMono,
            background: 'transparent', color: 'var(--text-tertiary)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 4, cursor: 'pointer',
          }}
        >
          <RotateCcw size={10} /> reset
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', minHeight: 0,
          padding: 10,
          background: 'var(--bg-level-2)',
          border: '0.5px solid var(--border-subtle)',
          borderRadius: 6,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)', padding: 20 }}>
            Pose une question : <em>&quot;Pourquoi le 93 reçoit autant d&apos;impressions ?&quot;</em>, <em>&quot;Compare avec une stratégie uniforme&quot;</em>, etc.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '85%',
                padding: '8px 12px',
                background: m.role === 'user' ? 'var(--brand-teal)' : 'var(--bg-level-1)',
                color: m.role === 'user' ? 'var(--bg-level-0)' : 'var(--text-primary)',
                border: m.role === 'user' ? 'none' : '0.5px solid var(--border-subtle)',
                borderRadius: 6,
                fontSize: 11, fontFamily: fInter, lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content || (m.pending ? '…' : '')}
            </div>
            {m.tool_calls && m.tool_calls.length > 0 && (
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {m.tool_calls.map((tc, j) => (
                  <span key={j} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)',
                    padding: '2px 6px',
                    background: 'var(--bg-level-1)',
                    border: '0.5px solid var(--border-subtle)',
                    borderRadius: 3,
                  }}>
                    <Search size={9} />
                    {tc.toolName}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 11, fontFamily: fMono, color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          type="text"
          name="agent-chat-message"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-form-type="other"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          disabled={sending}
          placeholder="Pose une question à l'agent…"
          style={{
            flex: 1, padding: '8px 12px', fontSize: 12, fontFamily: fInter,
            background: 'var(--bg-level-2)',
            color: 'var(--text-primary)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 5, outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => { void send(); }}
          disabled={sending || !input.trim()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '8px 12px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
            background: sending || !input.trim() ? 'var(--bg-level-2)' : 'var(--brand-teal)',
            color: sending || !input.trim() ? 'var(--text-tertiary)' : 'var(--bg-level-0)',
            border: '0.5px solid var(--brand-teal)',
            borderRadius: 5, cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          <Send size={11} />
        </button>
      </div>
    </div>
  );
}
