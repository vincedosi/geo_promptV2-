'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { StrategyWizard } from '../_components/StrategyWizard';
import type { WizardDraftData } from '@/lib/strategy-wizard/types';

interface Campaign {
  id: string;
  name: string;
  dsp_source: string;
}

interface DraftResponse {
  draft: {
    id: string;
    campaign_id: string;
    current_step: number;
    draft_data: WizardDraftData;
  };
}

export default function NewStrategyPage() {
  const router = useRouter();
  const params = useSearchParams();
  const campaignId = params.get('campaign');
  const draftId = params.get('draft');

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [initialDraft, setInitialDraft] = useState<{ current_step: number; draft_data: WizardDraftData } | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setError('Paramètre `campaign` manquant dans l\'URL.');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const tasks: Promise<unknown>[] = [
          adminFetch('/api/digital/campaigns', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null),
        ];
        if (draftId) {
          tasks.push(
            adminFetch(`/api/bidding/strategies/drafts/${draftId}`, { cache: 'no-store' })
              .then(r => r.ok ? r.json() : null),
          );
        }
        const [listResp, draftResp] = await Promise.all(tasks) as [
          { campaigns?: Campaign[] } | null,
          DraftResponse | null | undefined,
        ];

        const camp = (listResp?.campaigns ?? []).find(c => c.id === campaignId) ?? null;
        if (!camp) {
          setError('Campagne introuvable ou pas accessible à votre organisation.');
          setLoading(false);
          return;
        }
        if ((camp.dsp_source ?? '').toLowerCase() === 'adform') {
          setError('Cette campagne Adform n\'est pas éligible au Custom Bidding.');
          setLoading(false);
          return;
        }
        setCampaign(camp);

        if (draftResp?.draft) {
          setInitialDraft({
            current_step: draftResp.draft.current_step,
            draft_data: draftResp.draft.draft_data,
          });
        }

        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, [campaignId, draftId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-[#a0a0a0] flex items-center justify-center">
        <span className="text-xs font-mono">chargement…</span>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="min-h-screen bg-[#050505] text-[#f0f0f0] flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-[#ff5757]">{error ?? 'Erreur inconnue'}</p>
        <button
          type="button"
          onClick={() => router.push('/custom-bidding')}
          className="text-xs text-[#4ecdc4] hover:text-[#3dbdb5]"
        >
          ← Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#050505]">
      <div className="border-b border-[#1a1a1a] px-6 py-3 flex items-center gap-3">
        <h1 className="text-sm font-medium text-[#f0f0f0]">
          Nouvelle stratégie — <span className="text-[#a0a0a0]">{campaign.name}</span>
        </h1>
        <span className="text-[10px] font-mono text-[#666] uppercase">{campaign.dsp_source}</span>
      </div>

      <div className="flex-1 flex flex-col">
        <StrategyWizard
          campaignId={campaign.id}
          campaignName={campaign.name}
          consumeDraftId={draftId ?? undefined}
          initialDraft={initialDraft}
          mode="create"
        />
      </div>
    </div>
  );
}
