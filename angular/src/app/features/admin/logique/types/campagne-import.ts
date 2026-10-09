/**
 * Copie, depuis `types/campaign.ts`, de ce que l'administration importe — `CampaignListItem`
 * (et `DspCampaign`, qu'il étend), `CampaignImportEvent`, `CampaignImportReport` (lot 6,
 * 2026-10-06). Parité par assignabilité mutuelle : `tests/unit/angular/admin-logique-paritaire.test.ts`.
 */

export interface DspCampaign {
  id: string;
  name: string;
  dsp_source: string;
  advertiser: string | null;
  /** Produit/offre mis en avant — déclaré au wizard (étape Cible). */
  product: string | null;
  date_start: string | null;
  date_end: string | null;
  total_tracked_ads: number;
  total_unique_impressions: number;
  countries: string[] | null;
  created_at: string;
  created_by: string | null;
  /** Correction manuelle du statut de cycle de vie (paused/ended/archived), ou null si aucune. */
  status_override: 'paused' | 'ended' | 'archived' | null;
  /** Sous-clés namespacées (media_plan, channels…). */
  geo_strategy?: Record<string, unknown> | null;
}

export interface CampaignListItem extends DspCampaign {
  total_rows: number;
  france_rows: number;
  matched_iris: number;
  /** Date de la dernière ligne de données importée (signal d'attention). */
  last_data_date: string | null;
}

/* ── Événements SSE de `POST /api/admin/campaigns/import` ── */

export type CampaignImportEvent =
  | { type: 'parsing'; message: string }
  | { type: 'progress'; processed: number; total: number; message: string }
  | { type: 'matching'; matched: number; total_france: number; message: string }
  | { type: 'rollups'; message: string }
  | { type: 'complete'; report: CampaignImportReport }
  | { type: 'error'; message: string };

export interface CampaignImportReport {
  campaign_id: string;
  campaign_name: string;
  total_rows: number;
  countries: string[];
  total_france: number;
  matched_iris: number;
  pct_matched: number;
}
