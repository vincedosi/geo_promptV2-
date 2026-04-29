'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { PALETTES, computePercentiles, buildFillExpression, type Percentiles } from '@/app/map/analyse/digital/_lib/palettes';

const SyncMap = dynamic(
  () => import('@/app/map/analyse/digital/_components/SyncMap').then(m => ({ default: m.SyncMap })),
  { ssr: false },
);

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  /** GeoJSON enrichi avec les props { code_postal, leads_real, leads_sim, bid_multiplier, ... }. */
  geojson: GeoJSON.FeatureCollection | null;
  /** Métrique à colorer (côté réel + simulé). */
  metric: 'leads' | 'spend' | 'impressions' | 'clicks';
  /** Date du jour courant (pour le titre). */
  currentDate?: string;
}

const TITLES = {
  real: 'Sans algo (réel observé)',
  sim: 'Avec algo (simulation)',
};

const FIELD_BY_METRIC: Record<Props['metric'], { real: string; sim: string }> = {
  leads:       { real: 'leads_real',       sim: 'leads_sim' },
  spend:       { real: 'spend_real',       sim: 'spend_sim' },
  impressions: { real: 'impressions_real', sim: 'impressions_sim' },
  clicks:      { real: 'clicks_real',      sim: 'clicks_sim' },
};

export function ChoroplethSplit({ geojson, metric, currentDate }: Props) {
  const fields = FIELD_BY_METRIC[metric];
  const teal = PALETTES.find(p => p.id === 'teal') ?? PALETTES[0];

  // Calcule les percentiles sur la métrique simulée (la plus haute en valeur).
  // On utilise les MEMES bornes pour les 2 cartes pour comparaison équitable.
  const percentiles: Percentiles = (() => {
    if (!geojson) return { p10: 0, p25: 1, p50: 10, p75: 100, p90: 1000, max: 10000 };
    const values: number[] = [];
    for (const f of geojson.features) {
      const r = Number(f.properties?.[fields.real] ?? 0);
      const s = Number(f.properties?.[fields.sim] ?? 0);
      if (r > 0) values.push(r);
      if (s > 0) values.push(s);
    }
    return computePercentiles(values);
  })();

  const fillReal = buildFillExpression(fields.real, teal.stops, percentiles, false);
  const fillSim = buildFillExpression(fields.sim, teal.stops, percentiles, false);

  // Sync de pan/zoom entre les 2 cartes via state parent (bidirectionnel).
  const [view, setView] = useState<{ center: [number, number]; zoom: number; bearing: number; pitch: number } | null>(null);
  const onMove = (center: [number, number], zoom: number, bearing: number, pitch: number) => {
    setView({ center, zoom, bearing, pitch });
  };

  // Workaround : SyncMap appelle setData() dans un useEffect mais la source
  // MapLibre est créée seulement APRÈS l'event 'load' du basemap (peut prendre
  // 1-3s : sprites, fonts, tiles). Si geojson arrive trop tôt, l'effet skip
  // silencieusement → source vide.
  // → On publie le geojson en plusieurs vagues (350ms / 1500ms / 3000ms) avec
  // une nouvelle référence d'objet à chaque fois pour forcer le re-run de
  // l'useEffect dans SyncMap. Au moins une de ces vagues atterrit après load.
  const [delayedGeoJSON, setDelayedGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => {
    if (!geojson) {
      setDelayedGeoJSON(null);
      return;
    }
    const timers = [350, 1500, 3000].map(ms =>
      setTimeout(() => setDelayedGeoJSON({ ...geojson }), ms),
    );
    return () => { timers.forEach(clearTimeout); };
  }, [geojson]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '0 16px', height: 520 }}>
      {(['real', 'sim'] as const).map(side => (
        <div
          key={side}
          style={{
            display: 'flex', flexDirection: 'column',
            background: 'var(--bg-card, #0a0a0a)',
            border: '0.5px solid var(--border-subtle, #1a1a1a)',
            borderRadius: 8, overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
              borderBottom: '0.5px solid var(--border-subtle, #1a1a1a)',
              background: 'var(--bg-level-2, #111)',
            }}
          >
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: side === 'sim' ? 'var(--brand-teal, #4ecdc4)' : 'var(--text-tertiary, #666)' }} />
            <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary, #f0f0f0)' }}>
              {TITLES[side]}
            </span>
            {currentDate && (
              <span style={{ marginLeft: 'auto', fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary, #666)' }}>
                {currentDate}
              </span>
            )}
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <SyncMap
              id={`custom-bidding-${side}`}
              geojson={delayedGeoJSON}
              fillExpression={side === 'real' ? fillReal : fillSim}
              lineColor={side === 'sim' ? '#4ecdc4' : '#444'}
              onMove={onMove}
              syncTarget={view}
              showFeatureHover
              metricLabel={metric === 'leads' ? 'Leads' : metric === 'spend' ? 'Spend (€)' : metric === 'impressions' ? 'Impressions' : 'Clicks'}
              hideAdminBoundaries
            />
          </div>
        </div>
      ))}
    </div>
  );
}
