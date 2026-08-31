'use client';

/**
 * MAGELIAN — sauvegarde automatique du brouillon du wizard de strategie.
 *
 * Persiste l'etape courante et les donnees saisies au fil de la frappe, de
 * facon a ce qu'une navigation ou un rechargement ne perde pas le travail
 * en cours. Passe par adminFetch : la route est protegee par un guard
 * serveur qui lit le header Authorization.
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { WizardDraftData } from './types';

interface AutosaveOptions {
  campaignId: string;
  currentStep: number;
  draftData: WizardDraftData;
  debounceMs?: number;
  enabled?: boolean;
}

interface AutosaveState {
  isSaving: boolean;
  lastSavedAt: Date | null;
  error: string | null;
}

/**
 * Autosave hook : persiste draft_data toutes les `debounceMs` ms (1s par défaut).
 * UPSERT sur (user_id, campaign_id) — 1 draft max par couple.
 */
export function useStrategyDraftAutosave(opts: AutosaveOptions): AutosaveState {
  const { campaignId, currentStep, draftData, debounceMs = 1000, enabled = true } = opts;
  const [state, setState] = useState<AutosaveState>({
    isSaving: false,
    lastSavedAt: null,
    error: null,
  });
  const lastSerializedRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;
    const serialized = JSON.stringify({ currentStep, draftData });
    if (serialized === lastSerializedRef.current) return;

    const timer = window.setTimeout(async () => {
      setState(s => ({ ...s, isSaving: true, error: null }));
      try {
        const res = await adminFetch('/api/bidding/strategies/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_id: campaignId,
            current_step: currentStep,
            draft_data: draftData,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        lastSerializedRef.current = serialized;
        setState({ isSaving: false, lastSavedAt: new Date(), error: null });
      } catch (e) {
        setState(s => ({ ...s, isSaving: false, error: e instanceof Error ? e.message : String(e) }));
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [campaignId, currentStep, draftData, debounceMs, enabled]);

  return state;
}
