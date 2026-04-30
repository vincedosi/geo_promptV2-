'use client';

/**
 * Context provider de GeoAgent.
 * Expose : open(context), close(), isOpen, currentContext.
 * Mounté en haut de l'arborescence (app/layout.tsx) pour que n'importe quelle
 * page puisse ouvrir l'agent avec un context spécifique.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AgentContext } from '@/lib/agent/types';

interface AgentContextValue {
  isOpen: boolean;
  currentContext: AgentContext;
  /** Ouvre le panel avec un context (drift_event_id, strategy_id, etc.). */
  open: (ctx?: AgentContext) => void;
  close: () => void;
  toggle: (ctx?: AgentContext) => void;
}

const Ctx = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentContext, setCurrentContext] = useState<AgentContext>({});

  const open = useCallback((ctx?: AgentContext) => {
    if (ctx) setCurrentContext(ctx);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback((ctx?: AgentContext) => {
    if (ctx) setCurrentContext(ctx);
    setIsOpen(prev => !prev);
  }, []);

  const value = useMemo<AgentContextValue>(
    () => ({ isOpen, currentContext, open, close, toggle }),
    [isOpen, currentContext, open, close, toggle],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAgent(): AgentContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAgent must be used within <AgentProvider>');
  return v;
}
