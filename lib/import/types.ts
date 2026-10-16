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

// ============================================================
// IMPORT CONFIGURATION
// ============================================================

/** Seul type reellement implemente. Les carreaux ont leur propre pipeline
 *  (`app/admin/carreaux-import/_lib/shapefile.ts`), pas celui-ci. */
export type DataType = 'poi';
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

// ============================================================
// CARREAUX INSEE FILOSOFI — ALL POSSIBLE INDICATORS
// ============================================================

export const INSEE_CARREAUX_INDICATORS: Record<string, { label: string; type: 'numeric' | 'text'; group: string }> = {
  // Identifiant
  idcar: { label: 'Identifiant carreau', type: 'text', group: 'Identifiant' },
  
  // DÉMOGRAPHIE
  Ind: { label: 'Population totale', type: 'numeric', group: 'Démographie' },
  Ind_0_3: { label: 'Individus 0-3 ans', type: 'numeric', group: 'Démographie' },
  Ind_3_5: { label: 'Individus 3-5 ans', type: 'numeric', group: 'Démographie' },
  Ind_6_10: { label: 'Individus 6-10 ans', type: 'numeric', group: 'Démographie' },
  Ind_11_17: { label: 'Individus 11-17 ans', type: 'numeric', group: 'Démographie' },
  Ind_18_24: { label: 'Individus 18-24 ans', type: 'numeric', group: 'Démographie' },
  Ind_25_39: { label: 'Individus 25-39 ans', type: 'numeric', group: 'Démographie' },
  Ind_40_54: { label: 'Individus 40-54 ans', type: 'numeric', group: 'Démographie' },
  Ind_55_64: { label: 'Individus 55-64 ans', type: 'numeric', group: 'Démographie' },
  Ind_65_79: { label: 'Individus 65-79 ans', type: 'numeric', group: 'Démographie' },
  Ind_80p: { label: 'Individus 80 ans et +', type: 'numeric', group: 'Démographie' },
  
  // MÉNAGES
  Men: { label: 'Nombre de ménages', type: 'numeric', group: 'Ménages' },
  Men_pauv: { label: 'Ménages pauvres', type: 'numeric', group: 'Ménages' },
  Men_1ind: { label: 'Ménages 1 individu', type: 'numeric', group: 'Ménages' },
  Men_5ind: { label: 'Ménages 5+ individus', type: 'numeric', group: 'Ménages' },
  Men_prop: { label: 'Ménages propriétaires', type: 'numeric', group: 'Ménages' },
  Men_loc: { label: 'Ménages locataires', type: 'numeric', group: 'Ménages' },
  
  // REVENUS & ÉCONOMIE
  Ind_snv: { label: 'Somme niveaux de vie', type: 'numeric', group: 'Économie' },
  revenu_moyen: { label: 'Revenu moyen (calculé)', type: 'numeric', group: 'Économie' },
  pct_pauvres: { label: '% ménages pauvres', type: 'numeric', group: 'Économie' },
  
  // LOGEMENT — Type/Taille
  Log: { label: 'Nombre de logements', type: 'numeric', group: 'Logement' },
  Log_ap: { label: 'Logements collectifs', type: 'numeric', group: 'Logement' },
  Log_mais: { label: 'Logements individuels', type: 'numeric', group: 'Logement' },
  Log_av45: { label: 'Logements construits avant 1945', type: 'numeric', group: 'Logement' },
  Log_45_70: { label: 'Logements construits 1945-1970', type: 'numeric', group: 'Logement' },
  Log_70_90: { label: 'Logements construits 1970-1990', type: 'numeric', group: 'Logement' },
  Log_ap90: { label: 'Logements construits après 1990', type: 'numeric', group: 'Logement' },
  Log_surf: { label: 'Surface moyenne des logements', type: 'numeric', group: 'Logement' },
  
  // DENSITÉ & STATISTIQUES CALCULÉES
  densite: { label: 'Densité de population (hab/km²)', type: 'numeric', group: 'Statistiques' },
  pct_jeunes: { label: '% jeunes 0-24 ans', type: 'numeric', group: 'Statistiques' },
  pct_actifs: { label: '% actifs 25-54 ans', type: 'numeric', group: 'Statistiques' },
  pct_seniors: { label: '% seniors 65+ ans', type: 'numeric', group: 'Statistiques' },
};

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
  // Columns to include in metadata (user-selected — all non-mapped by default)
  importedColumns?: string[];
  // Subset of importedColumns to expose as map filters
  filterFields?: string[];
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
// CARREAUX SCHEMA INFERENCE
// ============================================================



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

// ============================================================
// GEOCODE REVIEW (batch geocoding with detailed results)
// ============================================================

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
