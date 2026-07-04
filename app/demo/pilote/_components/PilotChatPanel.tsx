'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { PacingCard } from './PacingCard';
import type { PilotPacing } from '@/lib/demo/pilot-types';

const fInter = 'Inter, sans-serif';
let _sb: ReturnType<typeof createClient> | null = null;
function sb() { return _sb ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!); }
const PILOT_TOOLS = ['tool-demarrer_pilotage', 'tool-mesurer', 'tool-corriger_enchere'];

export function PilotChatPanel() {
  const [mode, setMode] = useState<'guide' | 'autonome'>('guide');
  const [input, setInput] = useState('');
  const modeRef = useMemo(() => ({ current: mode }), []);
  modeRef.current = mode;

  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/pilot',
    headers: async (): Promise<Record<string, string>> => {
      const { data: { session } } = await sb().auth.getSession();
      return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
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
