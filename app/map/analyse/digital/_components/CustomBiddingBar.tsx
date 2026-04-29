'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { ActivateCustomBiddingModal } from './ActivateCustomBiddingModal';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface StrategyLite {
  id: string;
  name: string;
  execution_mode: 'monitor_only' | 'suggest' | 'auto';
  status: string;
}

interface Props {
  campaignId: string;
  campaignName: string;
  dspSource: string | null | undefined;
}

const MODE_COLORS: Record<string, string> = {
  auto: '#3dffa0',
  suggest: '#f7b731',
  monitor_only: '#5b9bd5',
};

export function CustomBiddingBar({ campaignId, campaignName, dspSource }: Props) {
  const router = useRouter();
  const [strategy, setStrategy] = useState<StrategyLite | null | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const isAdform = (dspSource ?? '').toLowerCase() === 'adform';

  useEffect(() => {
    if (!campaignId || isAdform) {
      setStrategy(null);
      return;
    }
    let cancelled = false;
    adminFetch('/api/bidding/strategies', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { strategies: [] })
      .then(d => {
        if (cancelled) return;
        const match = (d.strategies ?? []).find(
          (s: { campaign_id: string; status: string }) => s.campaign_id === campaignId,
        );
        setStrategy(match ?? null);
      })
      .catch(() => { if (!cancelled) setStrategy(null); });
    return () => { cancelled = true; };
  }, [campaignId, isAdform]);

  // Cas A : Adform — alert info discret
  if (isAdform) {
    return (
      <div
        style={{
          padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--bg-level-2, #181818)',
          borderTop: '0.5px solid var(--border-subtle, #1a1a1a)',
          borderBottom: '0.5px solid var(--border-subtle, #1a1a1a)',
          fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary, #666)',
        }}
      >
        <Sparkles size={12} style={{ color: 'var(--text-tertiary, #666)' }} />
        <span>Custom Bidding nécessite une source DSP (TTD, DV360, Meta…). Cette campagne provient d&apos;Adform (adserver) — analyse rétrospective uniquement.</span>
      </div>
    );
  }

  // Loading discret
  if (strategy === undefined) return null;

  // Cas C : stratégie active → bouton "Voir le pilotage ML"
  if (strategy) {
    const modeColor = MODE_COLORS[strategy.execution_mode] ?? '#a0a0a0';
    return (
      <div
        style={{
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
          background: 'rgba(78,205,196,0.04)',
          borderTop: '0.5px solid rgba(78,205,196,0.2)',
          borderBottom: '0.5px solid rgba(78,205,196,0.2)',
          fontFamily: fInter,
        }}
      >
        <Sparkles size={14} style={{ color: 'var(--brand-teal, #4ecdc4)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary, #f0f0f0)' }}>
            {strategy.name}
          </div>
          <div style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary, #666)', marginTop: 2 }}>
            mode : <span style={{ color: modeColor }}>{strategy.execution_mode}</span> · {strategy.status}
          </div>
        </div>
        <button
          onClick={() => router.push(`/custom-bidding/${strategy.id}`)}
          style={{
            padding: '8px 14px', fontSize: 12, fontFamily: fInter, fontWeight: 500,
            background: 'var(--brand-teal, #4ecdc4)', color: '#050505',
            border: 'none', borderRadius: 6, cursor: 'pointer',
          }}
        >
          Voir le pilotage ML
        </button>
      </div>
    );
  }

  // Cas B : DSP éligible sans stratégie → bouton "Activer"
  return (
    <>
      <div
        style={{
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--bg-level-2, #181818)',
          borderTop: '0.5px solid var(--border-subtle, #1a1a1a)',
          borderBottom: '0.5px solid var(--border-subtle, #1a1a1a)',
          fontFamily: fInter,
        }}
      >
        <Sparkles size={14} style={{ color: 'var(--brand-teal, #4ecdc4)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary, #f0f0f0)' }}>
            Optimisez cette campagne par machine learning
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary, #666)', marginTop: 2 }}>
            Custom Bidding ajuste les bid_multipliers par CP en temps réel selon votre objectif.
          </div>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          style={{
            padding: '8px 14px', fontSize: 12, fontFamily: fInter, fontWeight: 500,
            background: 'transparent', color: 'var(--brand-teal, #4ecdc4)',
            border: '0.5px solid var(--brand-teal, #4ecdc4)', borderRadius: 6, cursor: 'pointer',
          }}
        >
          Activer Custom Bidding
        </button>
      </div>
      <ActivateCustomBiddingModal
        campaignId={campaignId}
        campaignName={campaignName}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
