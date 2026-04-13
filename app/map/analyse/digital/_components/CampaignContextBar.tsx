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
  metric: 'impressions' | 'unique';
  onMetricChange: (m: 'impressions' | 'unique') => void;
  onOpenAnalysis: () => void;
  inZonePct?: number | null;
  inZoneImpressions?: number | null;
}

export function CampaignContextBar({ campaignName, totalImpressions, zonesCount, concentrationTop10, metric, onMetricChange, onOpenAnalysis, inZonePct, inZoneImpressions }: CampaignContextBarProps) {
  const showZoneKpi = inZonePct !== null && inZonePct !== undefined;
  const outPct = showZoneKpi ? Math.max(0, 100 - (inZonePct ?? 0)) : null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '6px 20px',
      background: 'rgba(255,255,255,0.02)', borderBottom: '0.5px solid rgba(255,255,255,0.08)',
      flexShrink: 0, flexWrap: 'wrap',
    }}>
      <span style={{ fontFamily: fInter, fontSize: 13, fontWeight: 500, color: '#f0f0f0' }}>{campaignName}</span>
      <span style={{ fontFamily: fMono, fontSize: 11, color: '#8a8a8a' }}>
        {zonesCount.toLocaleString('fr-FR')} zones · {fmt(totalImpressions)} {metric === 'unique' ? 'imp. uniques' : 'imp.'}
      </span>
      {showZoneKpi && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 12,
          borderLeft: '0.5px solid rgba(255,255,255,0.1)',
        }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontFamily: fMono, fontSize: 20, fontWeight: 500, color: '#4ecdc4', lineHeight: 1 }}>
              {(inZonePct ?? 0).toFixed(1)}%
            </span>
            <span style={{ fontFamily: fInter, fontSize: 10, color: '#8a8a8a' }}>in-zone</span>
          </span>
          {inZoneImpressions !== null && inZoneImpressions !== undefined && (
            <span style={{ fontFamily: fMono, fontSize: 10, color: '#666666' }}>
              {fmt(inZoneImpressions)} {metric === 'unique' ? 'imp. uniques' : 'imp.'}
            </span>
          )}
          {outPct !== null && (
            <span style={{ fontFamily: fMono, fontSize: 11, color: '#ef9f27' }}>
              {outPct.toFixed(1)}% hors zones
            </span>
          )}
        </div>
      )}
      <HealthBadge concentrationTop10={concentrationTop10} />

      {/* Metric toggle */}
      <div style={{ display: 'flex', gap: 1, background: '#111111', borderRadius: 4, padding: 1 }}>
        {([['impressions', 'Impressions'], ['unique', 'Imp. uniques']] as const).map(([id, label]) => (
          <button key={id} onClick={() => onMetricChange(id)} style={{
            padding: '4px 10px', fontSize: 10, fontFamily: fInter, cursor: 'pointer',
            background: metric === id ? 'rgba(78,205,196,0.12)' : 'transparent',
            border: 'none', borderRadius: 3,
            color: metric === id ? '#4ecdc4' : '#8a8a8a',
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex: 1 }} />
      <button onClick={onOpenAnalysis} style={{
        padding: '5px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
        background: 'rgba(78,205,196,0.08)', border: '0.5px solid rgba(78,205,196,0.3)',
        borderRadius: 6, color: '#4ecdc4', transition: 'all 0.15s',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(78,205,196,0.15)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(78,205,196,0.08)'; }}
      >Ouvrir analyse →</button>
    </div>
  );
}
