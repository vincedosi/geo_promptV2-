'use client';

import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge';
import { effectiveCampaignStatus, campaignNeedsAttention } from '@/lib/campaigns/status';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Campaign {
  id: string; name: string; dsp_source: string;
  date_start: string | null; date_end: string | null;
  total_tracked_ads: number; total_unique_impressions: number;
  nb_medias: number; nb_postal_codes: number;
  status_override: 'paused' | 'ended' | 'archived' | null;
  last_data_date: string | null;
}

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString('fr-FR');
}

interface CampaignCardProps {
  campaign: Campaign;
  onClick: () => void;
  /** Mode d'exécution de la stratégie ML active sur cette campagne. null si aucune. */
  mlMode?: string | null;
}

export function CampaignCard({ campaign: c, onClick, mlMode }: CampaignCardProps) {
  const period = c.date_start && c.date_end && c.date_start !== '1970-01-01'
    ? `${c.date_start} → ${c.date_end}`
    : null;

  const today = new Date().toISOString().slice(0, 10);
  const status = effectiveCampaignStatus(c, today);
  const attention = campaignNeedsAttention({ status, last_data_date: c.last_data_date }, today);

  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '14px 16px', cursor: 'pointer',
      background: 'rgba(255,255,255,0.03)',
      border: '0.5px solid rgba(255,255,255,0.08)',
      borderRadius: 8, textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: 12,
      transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover), transform 160ms var(--ease-out)',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.4)'; e.currentTarget.style.background = 'rgba(78,205,196,0.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: fInter, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
            {c.name}
          </div>
          <CampaignStatusBadge status={status} attention={attention} />
          {mlMode && (
            <span
              title={`Custom Bidding actif (mode: ${mlMode})`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: fMono, fontSize: 10, padding: '2px 6px', borderRadius: 4,
                background: 'rgba(78,205,196,0.12)', border: '0.5px solid rgba(78,205,196,0.4)',
                color: 'var(--brand-teal, #4ecdc4)',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.9 5.8L20 11l-5.8 1.9L12 19l-1.9-6.1L4 11l6.1-2.2z" />
                <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
              </svg>
              ML
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            fontFamily: fMono, fontSize: 11, color: 'var(--brand-teal)',
            background: 'rgba(78,205,196,0.12)', padding: '2px 6px', borderRadius: 4,
          }}>{fmt(c.total_tracked_ads)} imp.</span>
          {c.total_unique_impressions > 0 && (
            <span style={{
              fontFamily: fMono, fontSize: 11, color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4,
            }}>{fmt(c.total_unique_impressions)} uniques</span>
          )}
          <span style={{ fontFamily: fInter, fontSize: 11, color: '#8a8a8a' }}>{c.nb_medias} regies</span>
          <span style={{ fontFamily: fInter, fontSize: 11, color: '#8a8a8a' }}>{c.nb_postal_codes.toLocaleString('fr-FR')} CP</span>
          {period && <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>{period}</span>}
        </div>
      </div>
      <span style={{ color: '#8a8a8a', fontSize: 16, flexShrink: 0 }}>›</span>
    </button>
  );
}
