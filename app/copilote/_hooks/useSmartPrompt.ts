'use client';

/**
 * app/copilote/_hooks/useSmartPrompt.ts
 * Hook React pour appeler le routeur multi-agents /api/smart-prompt.
 * submit() retourne directement la réponse pour une utilisation dans les handlers.
 */

import { useState, useCallback } from 'react';
import { authFetch } from '@/lib/admin-fetch';
import type { SmartPromptResponse } from '@/lib/smart-prompt/types';

export interface UseSmartPromptState {
  loading:   boolean;
  response:  SmartPromptResponse | null;
  error:     string | null;
}

export function useSmartPrompt() {
  const [state, setState] = useState<UseSmartPromptState>({
    loading:  false,
    response: null,
    error:    null,
  });

  const submit = useCallback(async (message: string): Promise<SmartPromptResponse | null> => {
    if (!message.trim()) return null;

    setState({ loading: true, response: null, error: null });

    try {
      const res = await authFetch('/api/smart-prompt', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as SmartPromptResponse;
      setState({ loading: false, response: data, error: null });
      return data;

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      setState({ loading: false, response: null, error: msg });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ loading: false, response: null, error: null });
  }, []);

  return { ...state, submit, reset };
}
