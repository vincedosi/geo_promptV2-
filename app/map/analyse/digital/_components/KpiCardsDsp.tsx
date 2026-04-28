'use client';

/**
 * GEOMATIK — Cards KPI dynamiques pour le module Campagne Média.
 *
 * Charge dynamiquement la liste des KPIs disponibles pour la campagne via
 * `/api/admin/campaigns/[id]/metrics`, puis pour chacun fait un appel à
 * `/api/admin/campaigns/[id]/aggregate?metric=<field>` pour obtenir le total.
 *
 * Aucun KPI hardcodé. Les libellés et formats viennent de `dsp_metrics_registry`.
 */
import { useEffect, useMemo, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface MetricDescriptor {
  field: string;
  displayName: string;
  displayNameFr: string | null;
  unit: string | null;
  isCore: boolean;
  isKpiEligible: boolean;
  isLegacy: boolean;
  displayOrder: number;
}

interface AvailablePayload {
  available?: MetricDescriptor[];
  empty?: MetricDescriptor[];
}

interface AggregatePayload {
  metric?: { field: string; label: string; unit: string | null };
  total: number | null;
}

interface Props {
  campaignId: string;
  /** Nombre maximal de cards à afficher. Défaut 5. */
  maxCards?: number;
}

const NF_INT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const NF_EUR = new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 2,
});
const NF_PCT = new Intl.NumberFormat('fr-FR', {
  style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function formatValue(value: number | null, unit: string | null): string {
  if (value === null || !isFinite(value)) return '—';
  switch (unit) {
    case 'count': return NF_INT.format(value);
    case 'currency_eur': return NF_EUR.format(value);
    case 'rate':
    case 'percent': return NF_PCT.format(value > 1 ? value / 100 : value);
    case 'seconds': return `${value.toFixed(1)} s`;
    default: return Number.isInteger(value) ? NF_INT.format(value) : value.toFixed(2);
  }
}

export function KpiCardsDsp({ campaignId, maxCards = 5 }: Props) {
  const [available, setAvailable] = useState<MetricDescriptor[] | null>(null);
  const [totals, setTotals] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<string | null>(null);

  // 1) Charger la liste des KPIs disponibles
  useEffect(() => {
    let cancelled = false;
    setAvailable(null);
    setTotals({});
    setError(null);
    adminFetch(`/api/admin/campaigns/${campaignId}/metrics`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: AvailablePayload) => {
        if (cancelled) return;
        const list = (data.available ?? []).filter((m) => m.isKpiEligible);
        list.sort((a, b) => a.displayOrder - b.displayOrder);
        setAvailable(list.slice(0, maxCards));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setAvailable([]);
      });
    return () => { cancelled = true; };
  }, [campaignId, maxCards]);

  // 2) Charger les totaux pour chaque KPI affiché
  useEffect(() => {
    if (!available || available.length === 0) return;
    let cancelled = false;
    // Sequentiel pour respecter Nano (Promise.all > 3 = interdit)
    (async () => {
      const next: Record<string, number | null> = {};
      for (const m of available) {
        try {
          const r = await adminFetch(
            `/api/admin/campaigns/${campaignId}/aggregate?metric=${encodeURIComponent(m.field)}`,
            { cache: 'no-store' },
          );
          if (!r.ok) { next[m.field] = null; continue; }
          const data = (await r.json()) as AggregatePayload;
          next[m.field] = data.total;
          if (cancelled) return;
          setTotals((prev) => ({ ...prev, [m.field]: data.total }));
        } catch {
          next[m.field] = null;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [available, campaignId]);

  const cards = useMemo(() => (available ?? []).map((m) => ({
    field: m.field,
    label: m.displayNameFr ?? m.displayName,
    unit: m.unit,
    isLegacy: m.isLegacy,
    raw: totals[m.field] ?? null,
  })), [available, totals]);

  if (error) {
    return (
      <div style={{
        padding: '8px 12px', background: 'rgba(255,87,87,0.08)',
        border: '0.5px solid rgba(255,87,87,0.2)', borderRadius: 4,
        fontFamily: fInter, fontSize: 11, color: 'var(--danger)',
      }}>
        Erreur chargement KPIs : {error}
      </div>
    );
  }

  if (!available) {
    return (
      <div style={{
        padding: '12px 16px', display: 'flex', gap: 1,
      }}>
        {Array.from({ length: maxCards }).map((_, i) => (
          <div key={i} style={{
            flex: 1, padding: '8px 10px', background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-subtle)',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ fontFamily: fMono, fontSize: 14, color: 'var(--text-tertiary)' }}>—</div>
            <div style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>Chargement…</div>
          </div>
        ))}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div style={{
        padding: '8px 12px', fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
      }}>
        Aucun KPI disponible pour cette campagne.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
      {cards.map((c, i) => (
        <div
          key={c.field}
          style={{
            flex: 1, padding: '8px 10px',
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-subtle)',
            display: 'flex', flexDirection: 'column', gap: 4,
            ...(i === 0 ? { borderTop: '2px solid var(--brand-teal)' } : {}),
          }}
        >
          <div
            style={{
              fontFamily: fMono,
              fontSize: i === 0 ? 20 : 14,
              fontWeight: 600,
              color: i === 0 ? 'var(--brand-teal)' : 'var(--text-primary)',
            }}
            title={c.field}
          >
            {formatValue(c.raw, c.unit)}
          </div>
          <div style={{
            fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span>{c.label}</span>
            {c.isLegacy && (
              <span style={{
                fontFamily: fMono, fontSize: 8, color: 'var(--text-tertiary)',
                padding: '1px 4px', borderRadius: 2,
                background: 'var(--bg-level-2)',
              }}>legacy</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
