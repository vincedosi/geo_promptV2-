'use client';

/**
 * MAGELIAN — Sélecteur global de KPI pour le Module Campagne Média.
 *
 * Source de vérité : `useSelectedMetric(campaignId)` (URL query param `?metric=`).
 * Drive la carte / heatmap / breakdown / cards via le KPI sélectionné.
 *
 * Affiche les `available` (KPIs ayant des données pour la campagne) — ordre
 * `display_order` ASC. Badge `legacy` pour `tracked_ads` / `unique_impressions`.
 */
import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface MetricDescriptor {
  field: string;
  displayName: string;
  displayNameFr: string | null;
  unit: string | null;
  isLegacy: boolean;
  displayOrder: number;
}

interface Props {
  campaignId: string;
  value: string;
  onChange: (field: string) => void;
  /** Hide selector if a single KPI available (toggle inutile). Defaut false. */
  hideIfSingle?: boolean;
}

export function KpiSelector({ campaignId, value, onChange, hideIfSingle = false }: Props) {
  const [available, setAvailable] = useState<MetricDescriptor[] | null>(null);

  useEffect(() => {
    if (!campaignId) { setAvailable([]); return; }
    let cancelled = false;
    adminFetch(`/api/admin/campaigns/${campaignId}/metrics`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d) return;
        const list = ((d.available ?? []) as MetricDescriptor[]).slice().sort((a, b) => a.displayOrder - b.displayOrder);
        setAvailable(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [campaignId]);

  if (available === null) {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
      }}>Chargement KPIs…</div>
    );
  }

  if (available.length === 0) return null;
  if (hideIfSingle && available.length === 1) return null;

  // Si la valeur courante n'est pas dans available, replier sur la première
  const currentMetric = available.find((m) => m.field === value) ?? available[0];

  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
    }}>
      <span>KPI</span>
      <select
        value={currentMetric.field}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--bg-level-2)',
          border: '0.5px solid var(--border-default)',
          borderRadius: 4,
          color: 'var(--text-primary)',
          fontFamily: fInter, fontSize: 12,
          padding: '4px 8px', outline: 'none',
        }}
      >
        {available.map((m) => (
          <option key={m.field} value={m.field}>
            {m.displayNameFr ?? m.displayName}
            {m.isLegacy ? ' (legacy)' : ''}
          </option>
        ))}
      </select>
      <span style={{ fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)' }}>
        {currentMetric.unit ?? '—'}
      </span>
    </label>
  );
}
