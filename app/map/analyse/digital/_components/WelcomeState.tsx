'use client';

import { CampaignCard } from './CampaignCard';

const fInter = "'Inter', sans-serif";

interface Campaign {
  id: string; name: string; dsp_source: string;
  date_start: string | null; date_end: string | null;
  total_tracked_ads: number; nb_medias: number; nb_postal_codes: number;
}

interface WelcomeStateProps {
  campaigns: Campaign[];
  loading: boolean;
  onSelect: (id: string) => void;
}

export function WelcomeState({ campaigns, loading, onSelect }: WelcomeStateProps) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#050505',
    }}>
      <div style={{ maxWidth: 520, width: '100%', padding: '40px 24px', textAlign: 'center' }}>
        {/* Icon */}
        <div style={{
          width: 64, height: 64, margin: '0 auto 20px', borderRadius: 16,
          background: 'rgba(78,205,196,0.08)', border: '1px solid rgba(78,205,196,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ecdc4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
          </svg>
        </div>

        <h1 style={{ fontFamily: fInter, fontSize: 20, fontWeight: 500, color: '#f0f0f0', margin: '0 0 8px' }}>
          Analyse digitale
        </h1>
        <p style={{ fontFamily: fInter, fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, margin: '0 0 32px' }}>
          Selectionnez une campagne pour visualiser la distribution geographique des impressions et croiser avec les donnees socio-demo.
        </p>

        {loading ? (
          <div style={{ fontFamily: fInter, fontSize: 13, color: '#8a8a8a' }}>Chargement des campagnes...</div>
        ) : campaigns.length === 0 ? (
          <div style={{ fontFamily: fInter, fontSize: 13, color: '#8a8a8a' }}>Aucune campagne importee</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
            {campaigns.map(c => (
              <CampaignCard key={c.id} campaign={c} onClick={() => onSelect(c.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
