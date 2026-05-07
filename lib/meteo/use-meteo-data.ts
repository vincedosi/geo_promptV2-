'use client';

/**
 * useMeteoData — hook réutilisable pour fetcher la météo Open-Meteo agrégée
 * par zones admin via /api/meteo-geo (NDJSON streaming).
 *
 * Indépendant du module digital — utilisable dans /map ou ailleurs.
 */
import { useCallback, useRef, useState } from 'react';
import type {
  MeteoParams, MeteoScale, MeteoZoneChunk, MeteoZoneMeta, MeteoZoneValue,
} from './types';
import { adminFetch } from '@/lib/admin-fetch';

export interface MeteoProgress {
  current: number;
  total: number;
  etaMs?: number;
}

export interface UseMeteoData {
  data: Record<string, MeteoZoneValue> | null;
  meta: MeteoZoneMeta | null;
  loading: boolean;
  progress: MeteoProgress | null;
  error: string | null;
  fetch: (scale: MeteoScale, params: MeteoParams) => Promise<void>;
  clear: () => void;
}

export function useMeteoData(): UseMeteoData {
  const [data, setData] = useState<Record<string, MeteoZoneValue> | null>(null);
  const [meta, setMeta] = useState<MeteoZoneMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<MeteoProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(async (scale: MeteoScale, params: MeteoParams) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setProgress(null);
    setError(null);
    try {
      const url =
        `/api/meteo-geo?scale=${scale}` +
        `&variable=${params.variable}` +
        `&startDate=${params.startDate}` +
        `&endDate=${params.endDate}`;
      const res = await adminFetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let chunk: MeteoZoneChunk;
          try { chunk = JSON.parse(trimmed) as MeteoZoneChunk; } catch { continue; }
          if (chunk.status === 'fetching') {
            setProgress({ current: chunk.progress, total: chunk.total, etaMs: chunk.etaMs });
          } else if (chunk.status === 'done') {
            setData(chunk.data);
            setMeta(chunk.meta);
            setProgress(null);
          } else if (chunk.status === 'error') {
            throw new Error(chunk.error);
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue';
        setError(msg);
        setData(null);
        setMeta(null);
      }
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setData(null);
    setMeta(null);
    setLoading(false);
    setProgress(null);
    setError(null);
  }, []);

  return { data, meta, loading, progress, error, fetch: doFetch, clear };
}
