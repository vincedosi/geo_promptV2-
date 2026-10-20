/**
 * Copie des TYPES de `lib/import/types.ts` que l'import POI de l'administration manipule
 * (lot 6, 2026-10-06). La constante `INSEE_CARREAUX_INDICATORS` et les types internes au
 * serveur (`ImportConfig`, `ProcessedRow`, `GeoResult`, `LogCallback`, `DataType`) ne sont pas
 * copiés : aucun écran ne les lit. Parité par assignabilité mutuelle :
 * `tests/unit/angular/admin-logique-paritaire.test.ts`.
 */

// ── Lecture du fichier ──

export interface ColumnInfo {
  name: string;
  sampleValues: string[];
  nullCount: number;
}

export interface ParseResult {
  success: boolean;
  fileName: string;
  fileSize: number;
  format: 'csv' | 'xlsx' | 'geojson' | 'shapefile';
  encoding: string;
  separator: string;
  totalRows: number;
  columns: ColumnInfo[];
  preview: Record<string, string | null>[];
  suggestedMapping: Record<string, string | null>;
  fileId: string;
  error?: string;
}

// ── Configuration ──

export type GeoMode = 'gps' | 'address' | 'lambert93';

export interface FieldMapping {
  nom?: string;
  adresse?: string;
  ville?: string;
  code_postal?: string;
  departement?: string;
  region?: string;
  reference_panneau?: string;
  type_panneau?: string;
}

export interface GeoConfig {
  mode: GeoMode;
  colLat?: string;
  colLng?: string;
  colAdresse?: string;
  colCodePostal?: string;
  colVille?: string;
  colX?: string;
  colY?: string;
}

// ── Essai à blanc ──

export interface DryRunStats {
  totalRows: number;
  testedRows: number;
  validRows: number;
  invalidRows: number;
  missingCoords: number;
  geocodedRows?: number;
  geocodeErrors?: number;
}

export interface SamplePoint {
  lat: number;
  lng: number;
  nom?: string;
  ville?: string;
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export interface DryRunResult {
  success: boolean;
  stats: DryRunStats;
  samplePoints: SamplePoint[];
  errors: ValidationError[];
  error?: string;
}

// ── Import (flux SSE de `POST /api/admin/import-poi/execute`) ──

export type LogLevel = 'info' | 'warn' | 'error';

export interface ImportProgress {
  type: 'progress' | 'geocode' | 'complete' | 'error' | 'log';
  processed?: number;
  total?: number;
  inserted?: number;
  ignored?: number;
  errors?: number;
  message?: string;
  report?: ImportReport;
  firstError?: string | null;
  // Live log fields
  logLevel?: LogLevel;
  logLine?: string;
}

export interface ImportReport {
  total: number;
  inserted: number;
  ignored: number;
  errors: number;
  jobId?: string;
}

// ── Géocodage relu ──

export type GeocodeStatus = 'green' | 'orange' | 'red';

export interface GeocodeDetailedResult {
  rowIndex: number;
  inputAddress: string;
  lat: number | null;
  lng: number | null;
  score: number;
  resultLabel: string;
  resultType: string; // housenumber, street, municipality, locality
  resultCity: string;
  resultPostcode: string;
  /** Code commune INSEE rendu par la BAN (`result_citycode`) ; absent des résultats construits ailleurs. */
  resultCitycode?: string;
  status: GeocodeStatus;
  manualOverride: boolean;
}

export interface GeocodeReviewData {
  geocodeId: string;
  totalRows: number;
  results: GeocodeDetailedResult[];
  stats: {
    green: number;
    orange: number;
    red: number;
  };
}
