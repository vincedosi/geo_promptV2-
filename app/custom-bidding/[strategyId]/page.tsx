'use client';

/**
 * /custom-bidding/[strategyId] — absorbé par le cockpit campagne.
 * Résout la campagne rattachée à la stratégie puis redirige vers
 * app/campaigns/[id] en vue Pilotage. Les _components restent utilisés
 * par le cockpit (import direct de FinalReport).
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
        router.replace(cid ? `/campaigns/${cid}?view=pilotage` : '/campaigns');
      })
      .catch(() => { if (!cancelled) router.replace('/campaigns'); });
    return () => { cancelled = true; };
  }, [strategyId, router]);

  return null;
}
