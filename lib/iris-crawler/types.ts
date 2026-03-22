// ── Types partagés pour le crawler IRIS INSEE ────────────────────────────────

export type IrisCatalogCategory = 'rp' | 'filosofi' | 'carreaux' | 'bpe' | 'referentiel';

export const CATEGORY_LABELS: Record<IrisCatalogCategory, string> = {
  rp:          'RP — Recensement de la Population',
  filosofi:    'Filosofi — Revenus & Pauvreté',
  carreaux:    'Données carroyées 200m',
  bpe:         'BPE — Équipements géolocalisés',
  referentiel: 'Référentiels',
};

export const CATEGORY_ORDER: IrisCatalogCategory[] = ['rp', 'filosofi', 'carreaux', 'bpe', 'referentiel'];

export interface IrisCatalogEntry {
  id: string;
  theme: string;
  description: string;
  category: IrisCatalogCategory;
  source: 'rp' | 'filosofi' | 'bpe';
  year: number;
  inseePageId: string;
  inseePageUrl: string;
  /** Colonnes DB déjà alimentées par ce jeu de données */
  inDatabase?: boolean;
}

export interface CatalogStatus {
  catalogId: string;
  downloaded: boolean;
  downloadedAt?: string;
  rowCount?: number;
  columnCount?: number;
  csvFileName?: string;
  fileSizeBytes?: number;
}

export interface DownloadedBase {
  catalogId: string;
  downloadedAt: string;
  csvFileName: string;
  headers: string[];
  geoColumns: string[];
  dataColumns: string[];
  rowCount: number;
  fileSizeBytes: number;
  rows: Array<Record<string, string | number | null>>;
}

export interface ColumnStats {
  name: string;
  type: 'geo' | 'data';
  nullCount: number;
  nullPct: number;
  min?: number;
  max?: number;
  samples: (string | number | null)[];
}

export interface PreviewResponse {
  catalogId: string;
  csvFileName: string;
  downloadedAt: string;
  headers: string[];
  geoColumns: string[];
  dataColumns: string[];
  totalRows: number;
  rows: Array<Record<string, string | number | null>>;
  columnStats: ColumnStats[];
  fileSizeBytes: number;
}

export interface DiscoverResponse {
  urls: Array<{ url: string; name: string }>;
  pageTitle?: string;
  error?: string;
}

export interface DownloadStreamEvent {
  type: 'status' | 'progress' | 'done' | 'error';
  message?: string;
  percent?: number;
  rowCount?: number;
  columnCount?: number;
  csvFileName?: string;
}
