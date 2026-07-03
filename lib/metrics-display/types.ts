/**
 * MAGELIAN — Types pour l'affichage dynamique des KPIs DSP.
 *
 * Miroir de `public.dsp_metrics_registry` (cf. chantier A1) — modèle
 * camelCase côté code, snake_case côté DB.
 */

export type OptimizationDirection = 'maximize' | 'minimize';

export interface MetricDescriptor {
  field: string;                          // 'impressions', 'tracked_ads', …
  displayName: string;                    // 'Impressions'
  displayNameFr: string | null;           // 'Impressions' (label affiché)
  unit: string | null;                    // 'count', 'currency_eur', 'rate', 'percent', 'seconds'
  description: string | null;
  isCore: boolean;                        // colonne native dsp_campaign_data
  isKpiEligible: boolean;                 // affichable en card / sélecteur
  isLegacy: boolean;                      // tracked_ads / unique_impressions
  optimizationDirection: OptimizationDirection | null;
  displayOrder: number;
}

export interface CampaignAvailableMetrics {
  /** KPIs avec au moins une ligne contenant des données pour cette campagne. */
  available: MetricDescriptor[];
  /** KPIs déclarés au registry mais non remplis pour cette campagne. */
  empty: MetricDescriptor[];
}

/** Erreur typée : la métrique demandée n'existe pas dans le registry. */
export class UnknownMetricError extends Error {
  constructor(public readonly field: string) {
    super(`Métrique inconnue : '${field}'. Vérifie dsp_metrics_registry.`);
    this.name = 'UnknownMetricError';
  }
}
