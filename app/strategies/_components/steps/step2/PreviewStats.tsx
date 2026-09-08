'use client';

/**
 * Bloc de statistiques de l'aperçu live (échantillon renvoyé par
 * `/api/bidding/strategies/preview-weights`).
 *
 * Extrait de Step2Geography.tsx (2026-09-08), JSX inchangé.
 */

import type { PreviewStats as PreviewStatsT } from '@/lib/strategy-wizard/types';

export function PreviewStats({ stats, loading }: { stats: PreviewStatsT | null; loading: boolean }) {
  return (
    <div className="bg-bg-level-1 border border-border-subtle rounded-md p-3">
      <h4 className="text-[11px] font-medium text-text-secondary mb-2">Statistiques (échantillon)</h4>
      {loading && <p className="text-[11px] text-text-tertiary">calcul…</p>}
      {!loading && !stats && <p className="text-[11px] text-text-tertiary">Sélectionnez une zone pour voir l&apos;aperçu.</p>}
      {!loading && stats && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-mono">
          <KV label="CPs in-zone" value={stats.n_in_zone.toLocaleString('fr-FR')} />
          <KV label="CPs out-zone" value={stats.n_out_zone.toLocaleString('fr-FR')} />
          <KV label="Exclus (×0)" value={stats.n_excluded.toLocaleString('fr-FR')} />
          <KV label="Échantillon" value={stats.n_total_sampled.toLocaleString('fr-FR')} />
          <KV label="Mult. moyen IN" value={stats.avg_multiplier_in.toFixed(2)} />
          <KV label="Mult. moyen OUT" value={stats.avg_multiplier_out.toFixed(2)} />
          <KV label="Budget IN %" value={stats.budget_share_in_pct.toFixed(1) + '%'} />
          <KV label="Budget OUT %" value={stats.budget_share_out_pct.toFixed(1) + '%'} />
        </dl>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="text-text-secondary text-right">{value}</dd>
    </>
  );
}
