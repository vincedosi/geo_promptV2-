/**
 * GENESIS — Import Universel — Types partagés
 */

// ============================================================
// FILE PARSING
// ============================================================

export interface ColumnInfo {
  name: string;
  sampleValues: string[];
  nullCount: number;
}

export interface ParseResult {
  success: boolean;
  fileName: string;
  fileSize: number;
  format: 'csv' | 'xlsx' | 'geojson';
  encoding: string;
  separator: string;
  totalRows: number;
  columns: ColumnInfo[];
  preview: Record<string, string | null>[];
  suggestedMapping: Record<string, string | null>;
  fileId: string;
  error?: string;
}

// ============================================================
// IMPORT CONFIGURATION
// ============================================================

export type DataType = 'panneaux' | 'poi';
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

export interface ImportConfig {
  fileId: string;
  dataType: DataType;
  category?: string;
  regie?: string;
  mapping: FieldMapping;
  geolocation: GeoConfig;
  limit?: number;
  // Back-office fields
  sourceName?: string;
  organizationId?: string;
}

// ============================================================
// DRY-RUN RESULTS
// ============================================================

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

// ============================================================
// IMPORT EXECUTION
// ============================================================

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCallback = (level: LogLevel, message: string) => void;

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

// ============================================================
// PROCESSED ROW (internal)
// ============================================================

export interface ProcessedRow {
  id: string;
  lat: number;
  lng: number;
  nom?: string | null;
  adresse?: string | null;
  ville?: string | null;
  code_postal?: string | null;
  departement?: string | null;
  code_departement?: string | null;
  region?: string | null;
  // Panneaux only
  reference_panneau?: string | null;
  regie?: string | null;
  type_panneau?: string | null;
  // POI only
  categorie?: string;
  sous_categorie?: string | null;
  source?: string;
  metadata?: string;
  // Back-office tracking
  data_source_id?: string | null;
  organization_id?: string | null;
}

export interface GeoResult {
  lat: number | null;
  lng: number | null;
  score?: number;
}
