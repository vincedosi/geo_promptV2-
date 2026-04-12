'use client';

import { HealthBadge } from './HealthBadge';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString('fr-FR');
}

interface CampaignContextBarProps {
  campaignName: string;
  totalImpressions: number;
  zonesCount: number;
  concentrationTop10: number;
  onOpenAnalysis: () => void;
}

export function CampaignContextBar({ campaignName, totalImpressions, zonesCount, concentrationTop10, onOpenAnalysis }: CampaignContextBarProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '8px 20px',
      background: 'rgba(255,255,255,0.02)', borderBottom: '0.5px solid rgba(255,255,255,0.08)',
      flexShrink: 0,
    }}>
      <span style={{ fontFamily: fInter, fontSize: 13, fontWeight: 500, color: '#f0f0f0' }}>{campaignName}</span>
      <span style={{ fontFamily: fMono, fontSize: 11, color: '#8a8a8a' }}>
        {zonesCount.toLocaleString('fr-FR')} zones · {fmt(totalImpressions)} imp.
      </span>
      <HealthBadge concentrationTop10={concentrationTop10} />
      <div style={{ flex: 1 }} />
      <button onClick={onOpenAnalysis} style={{
        padding: '6px 14px', fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
        background: 'rgba(78,205,196,0.08)', border: '0.5px solid rgba(78,205,196,0.3)',
        borderRadius: 6, color: '#4ecdc4', transition: 'all 0.15s',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(78,205,196,0.15)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(78,205,196,0.08)'; }}
      >Ouvrir analyse →</button>
    </div>
  );
}
