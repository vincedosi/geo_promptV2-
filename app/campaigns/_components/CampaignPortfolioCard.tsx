'use client';
import Link from 'next/link';
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge';
import type { CampaignStatus } from '@/lib/campaigns/status';

export interface PortfolioCampaign {
  id: string;
  name: string;
  dsp_source: string | null;
  date_start: string | null;
  date_end: string | null;
  is_demo?: boolean;
  organization_name?: string | null;
  total_rows?: number;
  france_rows?: number;
  matched_iris?: number;
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

export function CampaignPortfolioCard(
  { campaign, status, attention }: { campaign: PortfolioCampaign; status: CampaignStatus; attention: boolean },
) {
  const pct = campaign.france_rows && campaign.france_rows > 0
    ? Math.round(((campaign.matched_iris ?? 0) / campaign.france_rows) * 100) : null;
  return (
    <Link href={`/campaigns/${campaign.id}`}
      style={{ display: 'block', background: 'var(--card)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: '14px 16px', textDecoration: 'none' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--brand-teal)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ flex: 1, fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: 'var(--text-primary)' }}>{campaign.name}</span>
        {attention && (
          <span title="Données en retard" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0 }} />
        )}
        <CampaignStatusBadge status={status} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {campaign.organization_name && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{campaign.organization_name}</span>
        )}
        {campaign.dsp_source && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '1px 6px' }}>{campaign.dsp_source}</span>
        )}
        {campaign.is_demo && (
          <span style={{ fontSize: 10, color: 'var(--brand-teal)', border: '0.5px solid var(--brand-teal)', borderRadius: 4, padding: '1px 6px' }}>démo</span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
        <span>{fmtDate(campaign.date_start)} → {fmtDate(campaign.date_end)}</span>
        <span>{(campaign.total_rows ?? 0).toLocaleString('fr-FR')} lignes{pct !== null ? ` · ${pct}% IRIS` : ''}</span>
      </div>
    </Link>
  );
}
