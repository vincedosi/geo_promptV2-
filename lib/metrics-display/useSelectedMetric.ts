'use client';

/**
 * GEOMATIK — Hook unique source-of-truth pour le KPI sélectionné.
 *
 * URL-bound via le query param `?metric=<field>` :
 *  - Bookmarkable, deep-linking partageable
 *  - Lu/écrit via Next.js useSearchParams + router.replace
 *
 * Résolution :
 *   1. ?metric=<field> dans l'URL ET disponible pour la campagne → utilisé
 *   2. sinon → premier MetricDescriptor de `available` (ordre display_order)
 *   3. sinon → null (campagne sans données métriques)
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

interface MetricDescriptor {
  field: string;
  displayName: string;
  displayNameFr: string | null;
  unit: string | null;
  description: string | null;
  isCore: boolean;
  isKpiEligible: boolean;
  isLegacy: boolean;
  optimizationDirection: 'maximize' | 'minimize' | null;
  displayOrder: number;
}

interface AvailablePayload {
  available?: MetricDescriptor[];
  empty?: MetricDescriptor[];
}

export interface UseSelectedMetricResult {
  /** KPI actuellement sélectionné — null pendant le chargement ou si aucune donnée. */
  metric: MetricDescriptor | null;
  /** Liste des KPIs sélectionnables pour la campagne (déjà filtrée available). */
  available: MetricDescriptor[];
  /** True tant que le fetch de la liste des KPIs n'est pas revenu. */
  loading: boolean;
  /** Setter qui écrit le query param `?metric=<field>` (replace, pas push). */
  setMetric: (field: string) => void;
}

/**
 * Hook page-level. À monter dans le composant racine du Module Campagne Média
 * et propager via Context si plusieurs sous-composants en ont besoin (ou
 * laisser chacun le rappeler — il est partagé via SWR-like cache mémoire
 * en dev mais en V1 chaque appel refetche, OK pour 2 calls par page).
 */
export function useSelectedMetric(campaignId: string | null): UseSelectedMetricResult {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [available, setAvailable] = useState<MetricDescriptor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!campaignId) {
      setAvailable([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    adminFetch(`/api/admin/campaigns/${campaignId}/metrics`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: AvailablePayload) => {
        if (cancelled) return;
        const list = (data.available ?? []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
        setAvailable(list);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailable([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const requestedField = searchParams?.get('metric') ?? null;

  const metric = useMemo<MetricDescriptor | null>(() => {
    if (available.length === 0) return null;
    if (requestedField) {
      const found = available.find((m) => m.field === requestedField);
      if (found) return found;
    }
    return available[0] ?? null;
  }, [available, requestedField]);

  const setMetric = (field: string) => {
    if (!searchParams || !pathname) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('metric', field);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return { metric, available, loading, setMetric };
}
