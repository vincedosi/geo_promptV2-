'use client';

import { useEffect, useRef, useState, useMemo, FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { createClient } from '@supabase/supabase-js';
import type { ZoneData } from '@/types/spatial';
import type { Provider } from './useProviderSelector';

// Singleton browser client — même pattern que lib/admin-fetch.ts
let _sb: ReturnType<typeof createClient> | null = null;
function getSupabaseClient() {
  if (!_sb) {
    _sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _sb;
}

interface UseChatControlsOpts {
  setError: (v: string | null) => void;
  setZoneData: (v: ZoneData | null) => void;
  setIsochroneFromCache: (v: boolean) => void;
  provider: Provider;
}

export function useChatControls({
  setError,
  setZoneData,
  setIsochroneFromCache,
  provider,
}: UseChatControlsOpts) {
  const [input, setInput] = useState('');
  const [sessionTokens, setSessionTokens] = useState({ input: 0, output: 0, total: 0 });
  const msgTokensRef = useRef<Map<string, { in: number; out: number }>>(new Map());
  const forceRecalculateRef = useRef(false);
  const providerRef         = useRef<Provider>(provider);
  const lastUserMessageRef  = useRef<string>('');
  const messagesEndRef      = useRef<HTMLDivElement>(null);

  // Sync providerRef sans recréer le transport
  providerRef.current = provider;

  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    headers: async (): Promise<Record<string, string>> => {
      const { data: { session } } = await getSupabaseClient().auth.getSession();
      if (!session?.access_token) return {};
      return { Authorization: `Bearer ${session.access_token}` };
    },
    prepareSendMessagesRequest: ({ id, messages: msgs, body }) => ({
      body: {
        ...body,
        id,
        messages: msgs,
        forceRecalculate: forceRecalculateRef.current,
        provider: providerRef.current,
      },
    }),
  }), []);

  const {
    messages,
    sendMessage: sendChatMessage,
    status,
    setMessages,
    error: chatError,
  } = useChat({ transport });

  const isLoading = status === 'submitted' || status === 'streaming';

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Compteur tokens : lit messageMetadata injecté par le serveur (se met à jour à chaque finish-step)
  useEffect(() => {
    let changed = false;
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      const meta = (msg as unknown as { metadata?: { tok_in?: number; tok_out?: number } }).metadata;
      if (!meta?.tok_in) continue;
      const existing = msgTokensRef.current.get(msg.id);
      const newIn = Number(meta.tok_in), newOut = Number(meta.tok_out ?? 0);
      if (existing?.in !== newIn || existing?.out !== newOut) {
        msgTokensRef.current.set(msg.id, { in: newIn, out: newOut });
        changed = true;
      }
    }
    if (changed) {
      let totalIn = 0, totalOut = 0;
      for (const v of msgTokensRef.current.values()) { totalIn += v.in; totalOut += v.out; }
      setSessionTokens({ input: totalIn, output: totalOut, total: totalIn + totalOut });
    }
  }, [messages]);

  const sendMessage = (text: string) => {
    if (!text.trim() || isLoading) return;
    setInput('');
    setError(null);
    setZoneData(null);
    lastUserMessageRef.current = text;
    sendChatMessage({ text });
  };

  const recalculerIsochrone = () => {
    const lastMsg = lastUserMessageRef.current;
    if (!lastMsg || isLoading) return;
    setError(null);
    setIsochroneFromCache(false);
    forceRecalculateRef.current = true;
    sendChatMessage({ text: lastMsg });
    setTimeout(() => { forceRecalculateRef.current = false; }, 200);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return {
    input,
    setInput,
    messages,
    setMessages,
    isLoading,
    status,
    chatError,
    sendMessage,
    sendChatMessage,
    recalculerIsochrone,
    handleSubmit,
    handleKeyDown,
    messagesEndRef,
    lastUserMessageRef,
    forceRecalculateRef,
    sessionTokens,
  };
}
