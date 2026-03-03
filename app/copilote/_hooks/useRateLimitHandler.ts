'use client';

import { useEffect, useRef, useState } from 'react';

interface UseRateLimitHandlerOpts {
  chatError: Error | undefined;
  setError: (msg: string | null) => void;
  sendChatMessage: (opts: { text: string }) => void;
  lastUserMessageRef: React.MutableRefObject<string>;
}

export function useRateLimitHandler({
  chatError,
  setError,
  sendChatMessage,
  lastUserMessageRef,
}: UseRateLimitHandlerOpts) {
  const [rateLimitCooldown, setRateLimitCooldown] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Propager les erreurs de streaming vers l'UI
  useEffect(() => {
    if (!chatError) return;
    const msg = chatError.message ?? '';

    // Format "RATE_LIMIT:45" encodé par /api/chat (délai exact en secondes)
    const match = msg.match(/RATE_LIMIT:(\d+)/);
    if (match) {
      setRateLimitCooldown(parseInt(match[1], 10));
      return;
    }

    // Fallback : Mistral 429 passé directement par le SDK
    if (msg.includes('RATE_LIMIT') || msg.toLowerCase().includes('rate limit') || msg.includes('429')) {
      setRateLimitCooldown(15);
      return;
    }

    // Timeout réseau (ORS ou autre service)
    if (msg.includes('AbortError') || msg.toLowerCase().includes('timeout')) {
      setError('⏱ Service indisponible — réessaie dans quelques secondes');
      return;
    }

    setError(`Erreur IA : ${msg}`);
  }, [chatError, setError]);

  // Décompte + retry automatique quand rateLimitCooldown atteint 0
  useEffect(() => {
    if (rateLimitCooldown <= 0) return;
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setRateLimitCooldown(prev => {
        if (prev <= 1) {
          clearInterval(cooldownTimerRef.current!);
          cooldownTimerRef.current = null;
          const lastMsg = lastUserMessageRef.current;
          if (lastMsg) sendChatMessage({ text: lastMsg });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateLimitCooldown]);

  const cancelCooldown = () => {
    setRateLimitCooldown(0);
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  };

  return { rateLimitCooldown, cancelCooldown };
}
