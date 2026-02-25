/**
 * GENESIS — Import Universel — Validator
 * Applique le mapping, géolocalise, valide les lignes
 */
import { randomUUID } from 'crypto';
import type {
  FieldMapping,
  GeoConfig,
  GeoResult,
  ProcessedRow,
  SamplePoint,
  ValidationError,
} from './types';
import { geocodeBatch, lambert93ToWGS84, validateGPS, extractDeptFromCP } from './geocoder';

export interface ProcessResult {
  validRows: ProcessedRow[];
  invalidCount: number;
  missingCoords: number;
  geocodedCount: number;
  geocodeErrors: number;
  errors: ValidationError[];
  samplePoints: SamplePoint[];
}

/**
 * Apply column mapping: extract GENESIS fields from raw row
 */
function applyMapping(
  row: Record<string, string | null>,
  mapping: FieldMapping
): Record<string, string | null> {
  const mapped: Record<string, string | null> = {};

  for (const [genesisField, sourceCol] of Object.entries(mapping)) {
    if (sourceCol && sourceCol in row) {
      mapped[genesisField] = row[sourceCol] ?? null;
    } else {
      mapped[genesisField] = null;
    }
  }

  return mapped;
}

/**
 * Extract coordinates based on geolocation mode
 */
async function extractCoordinates(
  rows: Record<string, string | null>[],
  geoConfig: GeoConfig,
  onProgress?: (processed: number, total: number) => void
): Promise<GeoResult[]> {
  const results: GeoResult[] = [];

  if (geoConfig.mode === 'gps') {
    // Direct GPS: validate lat/lng from specified columns
    for (const row of rows) {
      const rawLat = row[geoConfig.colLat || ''];
      const rawLng = row[geoConfig.colLng || ''];

      if (!rawLat || !rawLng) {
        results.push({ lat: null, lng: null });
        continue;
      }

      const lat = parseFloat(rawLat);
      const lng = parseFloat(rawLng);

      if (validateGPS(lat, lng)) {
        results.push({ lat, lng });
      } else {
        results.push({ lat: null, lng: null });
      }
    }
  } else if (geoConfig.mode === 'lambert93') {
    // Lambert-93: convert X,Y via proj4
    for (const row of rows) {
      const rawX = row[geoConfig.colX || ''];
      const rawY = row[geoConfig.colY || ''];

      if (!rawX || !rawY) {
        results.push({ lat: null, lng: null });
        continue;
      }

      const x = parseFloat(rawX);
      const y = parseFloat(rawY);

      if (isNaN(x) || isNaN(y)) {
        results.push({ lat: null, lng: null });
        continue;
      }

      results.push(lambert93ToWGS84(x, y));
    }
  } else if (geoConfig.mode === 'address') {
    // Address geocoding via BAN API
    const addresses = rows.map((row) => {
      const parts = [
        row[geoConfig.colAdresse || ''],
        row[geoConfig.colCodePostal || ''],
        row[geoConfig.colVille || ''],
      ].filter(Boolean);
      return parts.join(' ');
    });

    return geocodeBatch(addresses, onProgress);
  }

  return results;
}

/**
 * Process rows: apply mapping + geolocation + validation
 * Main entry point for dry-run and execute
 */
export async function processRows(
  rawRows: Record<string, string | null>[],
  mapping: FieldMapping,
  geoConfig: GeoConfig,
  dataType: 'panneaux' | 'poi',
  options: {
    category?: string;
    regie?: string;
    onGeoProgress?: (processed: number, total: number) => void;
  } = {}
): Promise<ProcessResult> {
  const errors: ValidationError[] = [];
  const validRows: ProcessedRow[] = [];
  const samplePoints: SamplePoint[] = [];
  let missingCoords = 0;
  let geocodedCount = 0;
  let geocodeErrors = 0;

  // 1. Extract coordinates
  const geoResults = await extractCoordinates(rawRows, geoConfig, options.onGeoProgress);

  // 2. Process each row
  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const geo = geoResults[i];
    const mapped = applyMapping(raw, mapping);

    // Check coordinates
    if (geo.lat === null || geo.lng === null) {
      missingCoords++;

      if (geoConfig.mode === 'address' && geo.score !== undefined) {
        geocodeErrors++;
      }

      if (errors.length < 20) {
        errors.push({
          row: i + 1,
          field: 'coordinates',
          message: geoConfig.mode === 'address'
            ? `Geocodage echoue (score: ${geo.score?.toFixed(2) ?? '0'})`
            : 'Coordonnees manquantes ou invalides',
        });
      }
      continue;
    }

    if (geoConfig.mode === 'address') {
      geocodedCount++;
    }

    // Extract department from postal code if not mapped
    const codeDept = mapped.departement
      ? null // If departement is mapped, we'll use it as-is
      : extractDeptFromCP(mapped.code_postal);

    // Build processed row
    const processedRow: ProcessedRow = {
      id: randomUUID(),
      lat: geo.lat,
      lng: geo.lng,
      nom: mapped.nom || null,
      adresse: mapped.adresse || null,
      ville: mapped.ville || null,
      code_postal: mapped.code_postal || null,
      departement: mapped.departement || null,
      code_departement: codeDept || null,
      region: mapped.region || null,
    };

    if (dataType === 'panneaux') {
      processedRow.reference_panneau = mapped.reference_panneau || processedRow.id;
      processedRow.regie = options.regie || null;
      processedRow.type_panneau = mapped.type_panneau || null;
    } else {
      processedRow.categorie = options.category || 'autre';
      processedRow.sous_categorie = null;
      processedRow.source = 'import_universel';
      processedRow.metadata = '{}';
    }

    validRows.push(processedRow);

    // Collect sample points for map preview (max 10)
    if (samplePoints.length < 10) {
      samplePoints.push({
        lat: geo.lat,
        lng: geo.lng,
        nom: mapped.nom || undefined,
        ville: mapped.ville || undefined,
      });
    }
  }

  return {
    validRows,
    invalidCount: rawRows.length - validRows.length,
    missingCoords,
    geocodedCount,
    geocodeErrors,
    errors,
    samplePoints,
  };
}
