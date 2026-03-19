'use client';

import { useState, useEffect, useCallback } from 'react';

export type Provider = 'mistral' | 'gemini';

export interface ProviderStatus {
  mistral: { remaining: number; limit: number } | null;
  gemini: { available: boolean; keyPresent: boolean } | null;
}

export function useProviderSelector() {
  const [provider, setProvider] = useState<Provider>('gemini');
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({
    mistral: null,
    gemini: null,
  });
  const [statusLoading, setStatusLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch('/api/providers/status');
      if (res.ok) {
        const data = await res.json();
        setProviderStatus(data);
      }
    } catch {
      // silencieux
    } finally {
      setStatusLoading(false);
    }
  }, []);

  // Charger le statut au montage
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  return { provider, setProvider, providerStatus, statusLoading, refreshStatus };
}
