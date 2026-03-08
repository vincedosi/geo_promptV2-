'use client';

import { useEffect, useRef, useState, useMemo, FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import type { ZoneData } from '@/types/spatial';
import type { Provider } from './useProviderSelector';

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
  const forceRecalculateRef = useRef(false);
  const providerRef         = useRef<Provider>(provider);
  const lastUserMessageRef  = useRef<string>('');
  const messagesEndRef      = useRef<HTMLDivElement>(null);

  // Sync providerRef sans recréer le transport
  providerRef.current = provider;

  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
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
  };
}
