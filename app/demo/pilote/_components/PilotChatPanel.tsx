'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { PacingCard } from './PacingCard';
import type { PilotPacing } from '@/lib/demo/pilot-types';

const fInter = 'Inter, sans-serif';
const PILOT_TOOLS = ['tool-demarrer_pilotage', 'tool-mesurer', 'tool-corriger_enchere'];

export function PilotChatPanel() {
  const [mode, setMode] = useState<'guide' | 'autonome'>('guide');
  const [input, setInput] = useState('');
  const modeRef = useMemo(() => ({ current: mode }), []);
  modeRef.current = mode;

  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/pilot',
    headers: async (): Promise<Record<string, string>> => {
      // Session cookie-based (@supabase/ssr) : le token est dans le cookie sb-<ref>-auth-token,
      // pas dans localStorage — getSession() d'un client plain renverrait null.
      const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0];
      const c = document.cookie.split('; ').find((x) => x.startsWith(`sb-${ref}-auth-token=`));
      if (!c) return {};
      let val = decodeURIComponent(c.substring(c.indexOf('=') + 1));
      if (val.startsWith('base64-')) { try { val = atob(val.slice(7)); } catch { return {}; } }
      try {
        const token = JSON.parse(val).access_token as string | undefined;
        return token ? { Authorization: `Bearer ${token}` } : {};
      } catch { return {}; }
    },
    prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, messages, mode: modeRef.current } }),
  }), [modeRef]);

  const { messages, sendMessage, status } = useChat({ transport });
  const isLoading = status === 'submitted' || status === 'streaming';

  const submit = (e: FormEvent) => { e.preventDefault(); if (!input.trim() || isLoading) return; sendMessage({ text: input }); setInput(''); };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16, fontFamily: fInter, color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['guide', 'autonome'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            padding: '6px 12px', fontSize: 12, fontFamily: fInter, cursor: 'pointer', borderRadius: 6,
            background: 'transparent', border: `0.5px solid ${mode === m ? 'var(--brand-teal)' : 'var(--border-default)'}`,
            color: mode === m ? 'var(--brand-teal)' : 'var(--text-secondary)',
          }}>{m === 'guide' ? 'Guidé' : 'Autonome'}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {messages.map((msg) => {
          const text = msg.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
          const pacingParts = msg.role === 'assistant'
            ? (msg.parts as Array<{ type: string; state?: string; output?: unknown }>).filter((p) =>
                PILOT_TOOLS.includes(p.type) && p.state === 'output-available' && p.output && !(p.output as { error?: string }).error)
            : [];
          return (
            <div key={msg.id} style={{ fontSize: 13, color: msg.role === 'user' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {text && <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>}
              {pacingParts.map((p, i) => <PacingCard key={i} p={p.output as PilotPacing} />)}
            </div>
          );
        })}
        {isLoading && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Pilotage en cours…</div>}
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ex. « lance le pilotage »"
          style={{ flex: 1, background: 'var(--elevated)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)' }} />
        <button type="submit" disabled={isLoading} style={{ background: 'var(--brand-teal)', color: '#050505', border: 'none', borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 13, cursor: 'pointer' }}>Envoyer</button>
      </form>
    </div>
  );
}
