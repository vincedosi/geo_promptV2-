'use client';

/**
 * /custom-bidding/[strategyId] — absorbé par l'overlay MAGELIAN.
 * Résout la campagne rattachée à la stratégie puis redirige vers
 * /map?campaign=<id>&tab=apercu. Les _components restent utilisés
 * par PilotageOverlay et CampaignSuivi — NE PAS les déplacer.
 */
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

export default function Page() {
  const { strategyId } = useParams<{ strategyId: string }>();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    adminFetch(`/api/bidding/strategies/${strategyId}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (cancelled) return;
        const cid = j?.campaign?.id ?? j?.strategy?.campaign_id ?? null;
        router.replace(cid ? `/map?campaign=${cid}&tab=apercu` : '/map');
      })
      .catch(() => { if (!cancelled) router.replace('/map'); });
    return () => { cancelled = true; };
  }, [strategyId, router]);

  return null;
}
