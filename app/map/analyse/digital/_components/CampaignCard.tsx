'use client';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Campaign {
  id: string; name: string; dsp_source: string;
  date_start: string | null; date_end: string | null;
  total_tracked_ads: number; total_unique_impressions: number;
  nb_medias: number; nb_postal_codes: number;
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
}

export function CampaignCard({ campaign: c, onClick }: CampaignCardProps) {
  const period = c.date_start && c.date_end && c.date_start !== '1970-01-01'
    ? `${c.date_start} → ${c.date_end}`
    : null;

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
        <div style={{ fontFamily: fInter, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
          {c.name}
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
