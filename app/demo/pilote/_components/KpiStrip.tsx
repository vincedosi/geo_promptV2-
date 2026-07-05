'use client';
import { useState } from 'react';
import { demoAuthHeader } from '../_lib/authHeader';
import type { ReportKpis } from '@/lib/report/types';

const mono = 'JetBrains Mono, monospace';

export function KpiStrip({ kpis }: { kpis: ReportKpis }) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/demo/report/narrative', { method: 'POST', headers: demoAuthHeader() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'narrative_failed');
      setNarrative(json.narrative as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'narrative_failed');
    } finally {
      setLoading(false);
    }
  }

  const items = [
    { label: 'Corrections', value: String(kpis.corrections) },
    { label: 'Écart v1 → final', value: `${kpis.delta_first.toFixed(1)} → ${kpis.delta_last.toFixed(1)} pts` },
    { label: 'Gain', value: `${kpis.improvement_pts.toFixed(1)} pts` },
    { label: 'Zones conformes', value: `${kpis.conforming_items_last}/${kpis.total_items}` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {items.map((k) => (
          <div key={k.label} style={{ flex: '1 1 120px', background: 'var(--card)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{k.label}</div>
            <div style={{ fontSize: 15, fontFamily: mono, color: 'var(--text-primary)' }}>{k.value}</div>
          </div>
        ))}
        {kpis.converged && (
          <div style={{ alignSelf: 'center', fontSize: 12, color: 'var(--brand-teal)', border: '0.5px solid var(--brand-teal)', borderRadius: 4, padding: '2px 8px' }}>convergé</div>
        )}
      </div>
      <div>
        <button onClick={generate} disabled={loading}
          style={{ background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)', borderRadius: 6, padding: '8px 16px', fontSize: 12, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Génération…' : 'Synthèse IA'}
        </button>
        {error && <span style={{ marginLeft: 8, color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
        {narrative && (
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', background: 'var(--card)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: '12px 14px' }}>{narrative}</p>
        )}
      </div>
    </div>
  );
}
