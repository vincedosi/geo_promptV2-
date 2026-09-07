'use client';

/**
 * Chargeur du wizard en mode création — extrait de PilotageOverlay.tsx
 * (2026-09-07).
 *
 * Reprend le brouillon passé en `draftId` s'il y en a un, puis monte
 * <StrategyWizard> sur la campagne choisie.
 */

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { StrategyWizard } from '@/app/strategies/_components/StrategyWizard';
import type { WizardDraftData } from '@/lib/strategy-wizard/types';
import { fMono } from './shared';

export function CreateWizardLoader({
  campaignId, campaignName, draftId, onCompleted,
}: {
  campaignId: string;
  campaignName?: string;
  draftId?: string;
  onCompleted: (strategyId: string) => void;
}) {
  const [initialDraft, setInitialDraft] = useState<{ current_step: number; draft_data: WizardDraftData } | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftId) {
      setLoaded(true);
      return;
    }
    adminFetch(`/api/bidding/strategies/drafts/${draftId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j?.draft) {
          setInitialDraft({
            current_step: j.draft.current_step,
            draft_data: j.draft.draft_data,
          });
        }
        setLoaded(true);
      })
      .catch(e => {
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      });
  }, [draftId]);

  if (!loaded) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary)' }}>Chargement du brouillon…</div>;
  }
  if (loadError) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--danger)' }}>Erreur draft : {loadError}</div>;
  }
  return (
    <StrategyWizard
      campaignId={campaignId}
      campaignName={campaignName}
      consumeDraftId={draftId}
      initialDraft={initialDraft}
      mode="create"
      onCompleted={onCompleted}
    />
  );
}

