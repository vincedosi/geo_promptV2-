'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { downloadZoneExport } from '@/lib/custom-geo/download-export';
import { PACING_STATUS_META, type PacingItem } from '@/lib/pacing/compute';
import { computeRebidWeights, type RebidItemInput } from '@/lib/pacing/rebid';

const fInter = 'Inter, sans-serif';

interface PacingResponse {
  version: number;
  items: PacingItem[];
  in_plan_imp: number;
  total_imp: number;
  spillover: { imp: number; spend: number };
}

export function PacingPanel({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<{ loading: boolean; data: PacingResponse | null; empty: boolean; error: string | null }>(
    { loading: true, data: null, empty: false, error: null },
  );

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, empty: false, error: null });
    adminFetch(`/api/digital/${campaignId}/pacing`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (cancelled) return;
        if (j.empty) setState({ loading: false, data: null, empty: true, error: null });
        else setState({ loading: false, data: j, empty: false, error: null });
      })
      .catch((err) => { if (!cancelled) setState({ loading: false, data: null, empty: false, error: err.message }); });
    return () => { cancelled = true; };
  }, [campaignId]);

  const onRebid = useCallback((format: 'bidding_script' | 'tiktok_geo') => {
    const items = state.data?.items ?? [];
    if (!items.length) return;
    const rebidInput: RebidItemInput[] = items.map(i => ({
      zone_id: i.zone_id, item_id: i.item_id, item_weight: i.item_weight,
      expected_share: i.expected_share, actual_share: i.actual_share,
    }));
    const corrected = computeRebidWeights(rebidInput);
    // Un export par zone, avec les poids corrigés (poi_id → new_weight)
    const byZone = new Map<string, Record<string, number>>();
    for (const r of corrected) {
      const poiId = r.item_id.slice(r.zone_id.length + 1);
      const w = byZone.get(r.zone_id) ?? {};
      w[poiId] = Math.round(r.new_weight * 10) / 10;
      byZone.set(r.zone_id, w);
    }
    for (const [zoneId, weights] of byZone) {
      void downloadZoneExport(zoneId, format, { weights: JSON.stringify(weights) });
    }
  }, [state.data]);

  if (state.loading) return <div style={{ padding: 16, fontFamily: fInter, fontSize: 13, color: 'var(--text-secondary)' }}>Chargement…</div>;
  if (state.error) return <div style={{ padding: 16, fontFamily: fInter, fontSize: 13, color: 'var(--danger)' }}>Erreur : {state.error}</div>;
  if (state.empty) return (
    <div style={{ padding: 24, fontFamily: fInter, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
      Aucun plan figé — pousse un export DSP depuis le plan média pour démarrer la boucle.
    </div>
  );

  const d = state.data!;
  const nbSous = d.items.filter(i => i.status === 'sous_servi').length;
  const nbSur = d.items.filter(i => i.status === 'sur_servi').length;

  return (
    <div style={{ padding: 12, fontFamily: fInter }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>Version <strong style={{ color: 'var(--text-primary)' }}>v{d.version}</strong></span>
        <span>Sous-servis <strong style={{ color: 'var(--danger)' }}>{nbSous}</strong></span>
        <span>Sur-servis <strong style={{ color: 'var(--warning)' }}>{nbSur}</strong></span>
        <span>Hors-plan <strong style={{ color: 'var(--text-primary)' }}>{Math.round(d.spillover.imp).toLocaleString('fr-FR')}</strong> imp.</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
            <th style={{ padding: '6px 8px' }}>Zone / item</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Planifié</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Réel</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Δ (pts)</th>
            <th style={{ padding: '6px 8px' }}>Statut</th>
          </tr>
        </thead>
        <tbody>
          {[...d.items].sort((a, b) => a.delta_pts - b.delta_pts).map((i) => {
            const meta = PACING_STATUS_META[i.status];
            return (
              <tr key={i.item_id} style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <td style={{ padding: '6px 8px' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>{i.zone_name}</span> · <span style={{ color: 'var(--text-primary)' }}>{i.item_name}</span>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{(i.expected_share * 100).toFixed(1)}%</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{(i.actual_share * 100).toFixed(1)}%</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: meta.colorVar }}>{i.delta_pts >= 0 ? '+' : ''}{i.delta_pts.toFixed(1)}</td>
                <td style={{ padding: '6px 8px', color: meta.colorVar }}>{meta.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={() => onRebid('bidding_script')} style={rebidBtn}>Générer le rebid corrigé DV360</button>
        <button onClick={() => onRebid('tiktok_geo')} style={rebidBtn}>Rebid TikTok</button>
      </div>
    </div>
  );
}

const rebidBtn: React.CSSProperties = {
  background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)',
  borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 12, cursor: 'pointer',
};
