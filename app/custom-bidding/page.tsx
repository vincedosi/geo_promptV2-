/**
 * /custom-bidding — liste des stratégies actives.
 * Filtre les campagnes éligibles : seules celles ayant une bidding_strategies apparaissent.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface StrategyRow {
  id: string;
  name: string;
  algorithm_code: string;
  objective_code: string;
  execution_mode: 'monitor_only' | 'suggest' | 'auto';
  status: string;
  is_demo: boolean;
  dsp_campaigns: {
    id: string;
    name: string;
    dsp_source: string;
    is_demo: boolean;
    advertiser: string | null;
  };
}

const MODE_COLORS: Record<string, string> = {
  auto: '#3dffa0',
  suggest: '#f7b731',
  monitor_only: '#5b9bd5',
};

export default function CustomBiddingListPage() {
  const [strategies, setStrategies] = useState<StrategyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch('/api/bidding/strategies', { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => setStrategies(d.strategies ?? []))
      .catch(e => setError(String(e?.message ?? e)));
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary, #050505)', color: 'var(--text-primary, #f0f0f0)', fontFamily: fInter, padding: '32px 40px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <header style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', margin: 0 }}>
            Custom bidding
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary, #a0a0a0)', marginTop: 6 }}>
            Stratégies de bidding ML actives. Cliquer pour ouvrir la vue de pilotage.
          </p>
        </header>

        {error && (
          <div style={{ padding: '14px 16px', background: 'rgba(255,87,87,0.08)', border: '0.5px solid rgba(255,87,87,0.2)', borderRadius: 6, color: '#ff5757', fontSize: 12, marginBottom: 16 }}>
            Erreur de chargement : {error}
          </div>
        )}

        {strategies === null && !error && (
          <div style={{ color: 'var(--text-tertiary, #666)', fontSize: 13, fontFamily: fMono }}>Chargement…</div>
        )}

        {strategies !== null && strategies.length === 0 && (
          <div
            style={{
              padding: '48px 32px', background: 'var(--bg-card, #0a0a0a)',
              border: '0.5px solid var(--border-subtle, #1a1a1a)',
              borderRadius: 8, textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            }}
          >
            <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(78,205,196,0.08)', border: '0.5px solid rgba(78,205,196,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ecdc4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3l1.9 5.8L20 11l-5.8 1.9L12 19l-1.9-6.1L4 11l6.1-2.2z" />
                <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
              </svg>
            </div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: 'var(--text-primary, #f0f0f0)' }}>
              Aucune stratégie de Custom Bidding active
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #a0a0a0)', maxWidth: 460, lineHeight: 1.6 }}>
              Custom Bidding optimise vos campagnes DSP en temps réel via machine learning.
              Pour activer une stratégie, ouvrez une campagne DSP éligible (TTD, DV360…) et
              cliquez sur « Activer Custom Bidding ».
            </p>
            <Link
              href="/map?layer=digital"
              style={{
                marginTop: 8, padding: '8px 16px', fontSize: 12, fontFamily: fInter, fontWeight: 500,
                background: 'transparent', color: 'var(--brand-teal, #4ecdc4)',
                border: '0.5px solid var(--brand-teal, #4ecdc4)', borderRadius: 6, textDecoration: 'none',
              }}
            >
              Voir les campagnes
            </Link>
          </div>
        )}

        {strategies && strategies.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {strategies.map(s => {
              const camp = s.dsp_campaigns;
              const modeColor = MODE_COLORS[s.execution_mode] ?? '#a0a0a0';
              return (
                <Link
                  key={s.id}
                  href={`/custom-bidding/${s.id}`}
                  style={{ textDecoration: 'none' }}
                >
                  <div
                    style={{
                      background: 'var(--bg-card, #0a0a0a)',
                      border: '0.5px solid var(--border-subtle, #1a1a1a)',
                      borderRadius: 8,
                      padding: 16,
                      transition: 'border 120ms',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.3)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle, #1a1a1a)'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <h3 style={{ flex: 1, margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--text-primary, #f0f0f0)' }}>
                        {camp?.name ?? '—'}
                      </h3>
                      {camp?.is_demo && (
                        <span style={{ fontSize: 10, fontFamily: fMono, padding: '2px 8px', borderRadius: 4, background: 'rgba(247,183,49,0.1)', border: '0.5px solid rgba(247,183,49,0.3)', color: '#f7b731' }}>
                          demo data
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary, #a0a0a0)', marginBottom: 12 }}>{s.name}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 10, fontFamily: fMono, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-level-2, #181818)', border: '0.5px solid var(--border-default, #262626)', color: 'var(--text-tertiary, #666)' }}>
                        {s.algorithm_code}
                      </span>
                      <span style={{ fontSize: 10, fontFamily: fMono, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-level-2, #181818)', border: '0.5px solid var(--border-default, #262626)', color: 'var(--text-tertiary, #666)' }}>
                        {s.objective_code}
                      </span>
                      <span style={{ fontSize: 10, fontFamily: fMono, padding: '2px 8px', borderRadius: 4, background: 'transparent', border: `0.5px solid ${modeColor}40`, color: modeColor }}>
                        {s.execution_mode}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, fontFamily: fMono, color: 'var(--text-tertiary, #666)' }}>
                      <span>{camp?.dsp_source ?? '—'}</span>
                      <span>·</span>
                      <span>{s.status}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
