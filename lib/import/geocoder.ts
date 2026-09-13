/**
 * GENESIS — Import Universel — Geocoder
 * Port TypeScript exact de genesis_etl/geocoder.py
 * - GPS validation
 * - BAN API geocoding (api-adresse.data.gouv.fr) — single + CSV batch
 * - Lambert-93 → WGS84 conversion (proj4)
 */
import proj4 from 'proj4';
import Papa from 'papaparse';
import type { GeoResult, GeocodeDetailedResult, GeocodeStatus } from './types';
import { fetchLectureAvecReprise, type CauseReprise } from '@/lib/http/lecture-avec-reprise';
import { logger } from '@/lib/logger';

// ============================================================
// proj4 — Lambert-93 (EPSG:2154) definition
// ============================================================

proj4.defs(
  'EPSG:2154',
  '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);

// ============================================================
// BAN API — Adresse nationale française (gratuite, sans clé)
// Mirrors Python geocoder.py lines 20-96
// ============================================================

const BAN_API_URL         = 'https://api-adresse.data.gouv.fr/search/';
const SCORE_THRESHOLD     = 0.6;
const BAN_TIMEOUT_MS      = 10_000;  // timeout par requête single
const BAN_BATCH_TIMEOUT_MS = 60_000; // timeout pour requête CSV batch

/**
 * Un 4xx (autre que 429) ne se corrigera pas en rejouant : on ne reprend que
 * sur 429, 5xx, expiration et erreur réseau. Attente 1 s, 2 s, 3 s… (même
 * cadence que l'ancien geocoder.py).
 */
function attenteBan(pasMs: number) {
  return (tentative: number, cause: CauseReprise): number | null =>
    cause.type === 'statut' && cause.reponse.status !== 429 && cause.reponse.status < 500
      ? null
      : pasMs * (tentative + 1);
}

/**
 * Géocode une adresse : 1 appel BAN borné à 10 s par tentative, `retries`
 * reprises. Rend {null, null, 0} si rien n'est trouvé ou si la BAN est
 * injoignable — jamais d'exception, l'import continue.
 */
export async function geocodeSingle(adresse: string, retries = 2): Promise<GeoResult> {
  if (!adresse || !adresse.trim()) {
    return { lat: null, lng: null, score: 0 };
  }

  const params = new URLSearchParams({ q: adresse.trim(), limit: '1' });

  try {
    const response = await fetchLectureAvecReprise(`${BAN_API_URL}?${params}`, {}, {
      delaiMs: BAN_TIMEOUT_MS,
      tentatives: retries + 1,
      attente: attenteBan(1000),
    });
    if (!response.ok) {
      logger.warn('GEOCODER', `BAN API HTTP ${response.status}`);
      return { lat: null, lng: null, score: 0 };
    }

    const data = await response.json();
    const features = data.features || [];
    if (features.length === 0) {
      return { lat: null, lng: null, score: 0 };
    }

    const best = features[0];
    const [lng, lat] = best.geometry.coordinates; // GeoJSON: [lng, lat]
    const score = best.properties?.score ?? 0;
    return { lat, lng, score };
  } catch (err: unknown) {
    logger.warn('GEOCODER', `BAN injoignable : ${err instanceof Error ? err.message : String(err)}`);
    return { lat: null, lng: null, score: 0 };
  }
}

/**
 * Geocode a batch of addresses via BAN API.
 * Respects rate limit: 100ms between calls (matches Python time.sleep(0.1))
 */
export async function geocodeBatch(
  addresses: string[],
  onProgress?: (processed: number, total: number) => void
): Promise<GeoResult[]> {
  const results: GeoResult[] = [];

  for (let i = 0; i < addresses.length; i++) {
    const result = await geocodeSingle(addresses[i]);

    // Apply score threshold (matches Python geocoder.py seuil_score=0.6)
    if (result.score !== undefined && result.score < SCORE_THRESHOLD && result.lat !== null) {
      results.push({ lat: null, lng: null, score: result.score });
    } else {
      results.push(result);
    }

    // Rate limiting: 100ms between calls
    if (i < addresses.length - 1) {
      await sleep(100);
    }

    // Progress callback every 10 addresses
    if (onProgress && (i + 1) % 10 === 0) {
      onProgress(i + 1, addresses.length);
    }
  }

  return results;
}

// ============================================================
// Lambert-93 → WGS84
// Mirrors Python geocoder.py process_lambert93()
// ============================================================

export function lambert93ToWGS84(x: number, y: number): GeoResult {
  try {
    const [lng, lat] = proj4('EPSG:2154', 'EPSG:4326', [x, y]);

    // Validate France metropolitan bounds (matches Python geocoder.py lines 191-194)
    if (lat < 41.0 || lat > 51.5 || lng < -5.5 || lng > 10.0) {
      return { lat: null, lng: null };
    }

    return { lat, lng };
  } catch {
    return { lat: null, lng: null };
  }
}

// ============================================================
// GPS validation
// Mirrors Python geocoder.py process_gps()
// ============================================================

export function validateGPS(lat: number, lng: number): boolean {
  return (
    !isNaN(lat) && !isNaN(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

// ============================================================
// Department extraction from postal code
// Mirrors Python geocoder.py _extract_dept_from_cp()
// ============================================================

export function extractDeptFromCP(codePostal: string | null | undefined): string | null {
  if (!codePostal || !String(codePostal).trim()) return null;

  const cp = String(codePostal).trim().padStart(5, '0');

  // DOM-TOM: 971, 972, 973, 974, 976
  if (cp.startsWith('97')) {
    return cp.slice(0, 3);
  }

  return cp.slice(0, 2);
}

// ============================================================
// BAN Reverse Geocoding — lat/lng → département + région
// https://adresse.data.gouv.fr/api-doc/adresse (section reverse/csv)
// context = "67, Bas-Rhin, Grand Est"
// ============================================================

const BAN_REVERSE_URL = 'https://api-adresse.data.gouv.fr/reverse/csv/';

export interface ReverseResult {
  index: number;
  dept_code: string | null;
  dept_nom: string | null;
  region: string | null;
  ville: string | null;
  code_postal: string | null;
}

/**
 * Batch reverse geocoding via BAN CSV endpoint.
 * For each (lat, lng) pair, returns département + région from context field.
 * Only enriches rows where dept/region are missing (null/empty).
 *
 * @param points - Array of {index, lat, lng} — index is the row index in validRows
 * @param onProgress - optional progress callback
 */
export async function reverseGeocodeRows(
  points: { index: number; lat: number; lng: number }[],
  onProgress?: (done: number, total: number) => void
): Promise<ReverseResult[]> {
  if (points.length === 0) return [];

  // Smaller chunks so progress fires more often (500 = ~1s per call on BAN)
  const CHUNK = 500;
  const allResults: ReverseResult[] = [];

  for (let offset = 0; offset < points.length; offset += CHUNK) {
    const chunk = points.slice(offset, offset + CHUNK);

    // Build CSV: latitude,longitude
    const csvLines = ['latitude,longitude'];
    for (const p of chunk) csvLines.push(`${p.lat},${p.lng}`);
    const csvContent = csvLines.join('\n');

    try {
      const formData = new FormData();
      formData.append('data', new Blob([csvContent], { type: 'text/csv' }), 'points.csv');

      // Borné à 60 s, sans reprise automatique : un corps FormData ne se
      // rejoue pas une fois consommé. Un lot en échec rend des nulls (ci-dessous).
      const res = await fetchLectureAvecReprise(BAN_REVERSE_URL, {
        method: 'POST',
        body: formData,
      }, { delaiMs: BAN_BATCH_TIMEOUT_MS, tentatives: 1 });

      if (!res.ok) throw new Error(`BAN reverse HTTP ${res.status}`);

      const text = await res.text();
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
      });

      for (let i = 0; i < chunk.length; i++) {
        const row = parsed.data[i] ?? {};
        // context = "67, Bas-Rhin, Grand Est"  or "2A, Corse-du-Sud, Corse"
        const ctx = (row.result_context || '').trim();
        const parts = ctx.split(',').map((s: string) => s.trim());

        allResults.push({
          index: chunk[i].index,
          dept_code:  parts[0] || null,
          dept_nom:   parts[1] || null,
          region:     parts[2] || null,
          ville:      row.result_city || null,
          code_postal: row.result_postcode || null,
        });
      }
    } catch (err: unknown) {
      // On failure, push nulls for this chunk
      logger.error('GEOCODER', `reverse batch failed: ${err instanceof Error ? err.message : String(err)}`);
      for (const p of chunk) {
        allResults.push({ index: p.index, dept_code: null, dept_nom: null, region: null, ville: null, code_postal: null });
      }
    }

    if (onProgress) onProgress(Math.min(offset + chunk.length, points.length), points.length);
  }

  return allResults;
}

// ============================================================
// Utility
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Score → status classification
// ============================================================

const GREEN_THRESHOLD = 0.6;
const ORANGE_THRESHOLD = 0.3;

export function scoreToStatus(score: number): GeocodeStatus {
  if (score >= GREEN_THRESHOLD) return 'green';
  if (score >= ORANGE_THRESHOLD) return 'orange';
  return 'red';
}

// ============================================================
// BAN CSV Batch — POST /search/csv/
// Much faster than individual calls (processes thousands at once)
// https://adresse.data.gouv.fr/api-doc/adresse (section CSV)
// ============================================================

const BAN_CSV_URL = 'https://api-adresse.data.gouv.fr/search/csv/';
const BAN_CSV_CHUNK_SIZE = 5000;

/**
 * Escape CSV field (double-quote if contains comma, newline, or double-quote)
 */
function csvEscape(val: string): string {
  if (!val) return '';
  if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes(';')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Build a CSV string from address rows.
 * Columns: adresse, code_postal, ville
 */
function buildAddressCSV(rows: Array<{ adresse?: string; code_postal?: string; ville?: string }>): string {
  const lines: string[] = ['adresse,code_postal,ville'];
  for (const row of rows) {
    lines.push([
      csvEscape(row.adresse || ''),
      csvEscape(row.code_postal || ''),
      csvEscape(row.ville || ''),
    ].join(','));
  }
  return lines.join('\n');
}

/**
 * Call BAN CSV batch endpoint for a chunk of rows.
 * Returns parsed results with lat/lng/score/label/type.
 */
async function geocodeChunkCSV(
  csvContent: string,
  retries = 2
): Promise<Array<{
  lat: number | null;
  lng: number | null;
  score: number;
  resultLabel: string;
  resultType: string;
  resultCity: string;
  resultPostcode: string;
}>> {
  // Tell BAN which columns to use
  // columns=adresse means: use 'adresse' column for full-text search
  // postcode=code_postal means: use 'code_postal' to restrict by postal code
  // citycode is not used; instead we let BAN use the full address + postal code
  const url = `${BAN_CSV_URL}?columns=adresse&columns=ville&postcode=code_postal`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Un FormData consommé ne se rejoue pas : reconstruit à CHAQUE tentative,
      // d'où la boucle ici plutôt que `tentatives` dans l'aide de lecture.
      const formData = new FormData();
      formData.append('data', new Blob([csvContent], { type: 'text/csv' }), 'addresses.csv');

      const response = await fetchLectureAvecReprise(url, { method: 'POST', body: formData }, {
        delaiMs: BAN_BATCH_TIMEOUT_MS,
        tentatives: 1,
      });

      if (!response.ok) {
        // Le catch ci-dessous distingue un 4xx définitif (abandon immédiat)
        // d'un 429/5xx transitoire (reprise).
        throw new Error(`BAN CSV API HTTP ${response.status}: ${await response.text()}`);
      }

      const responseText = await response.text();

      // Parse the response CSV
      const parsed = Papa.parse<Record<string, string>>(responseText, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
      });

      return parsed.data.map((row) => {
        const lat = parseFloat(row.latitude || '');
        const lng = parseFloat(row.longitude || '');
        const score = parseFloat(row.result_score || '0');

        return {
          lat: isNaN(lat) ? null : lat,
          lng: isNaN(lng) ? null : lng,
          score: isNaN(score) ? 0 : score,
          resultLabel: row.result_label || '',
          resultType: row.result_type || '',
          resultCity: row.result_city || '',
          resultPostcode: row.result_postcode || '',
        };
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const definitif = /HTTP 4\d\d/.test(message) && !/HTTP 429/.test(message);
      if (definitif || attempt >= retries) {
        logger.error('GEOCODER', `BAN CSV : abandon après ${attempt + 1} tentative(s) — ${message}`);
        throw err;
      }
      logger.warn('GEOCODER', `BAN CSV tentative ${attempt + 1} en échec, reprise… (${message})`);
      await sleep(2000 * (attempt + 1));
    }
  }

  return []; // Should not reach here
}

/**
 * Geocode a batch of address rows using BAN CSV batch endpoint.
 * Returns detailed results with scores, labels, and status classification.
 * Processes in chunks of BAN_CSV_CHUNK_SIZE for large files.
 */
export async function geocodeBatchDetailed(
  rows: Array<{ adresse?: string; code_postal?: string; ville?: string }>,
  onProgress?: (processed: number, total: number) => void
): Promise<GeocodeDetailedResult[]> {
  const allResults: GeocodeDetailedResult[] = [];
  const totalRows = rows.length;

  for (let offset = 0; offset < totalRows; offset += BAN_CSV_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + BAN_CSV_CHUNK_SIZE);
    const csvContent = buildAddressCSV(chunk);

    try {
      const chunkResults = await geocodeChunkCSV(csvContent);

      for (let i = 0; i < chunk.length; i++) {
        const rowIndex = offset + i;
        const banResult = chunkResults[i];
        const inputParts = [chunk[i].adresse, chunk[i].code_postal, chunk[i].ville].filter(Boolean);
        const inputAddress = inputParts.join(' ');

        if (banResult && banResult.lat !== null && banResult.lng !== null) {
          const status = scoreToStatus(banResult.score);
          allResults.push({
            rowIndex,
            inputAddress,
            lat: banResult.lat,
            lng: banResult.lng,
            score: banResult.score,
            resultLabel: banResult.resultLabel,
            resultType: banResult.resultType,
            resultCity: banResult.resultCity,
            resultPostcode: banResult.resultPostcode,
            status,
            manualOverride: false,
          });
        } else {
          allResults.push({
            rowIndex,
            inputAddress,
            lat: null,
            lng: null,
            score: banResult?.score || 0,
            resultLabel: banResult?.resultLabel || '',
            resultType: '',
            resultCity: '',
            resultPostcode: '',
            status: 'red',
            manualOverride: false,
          });
        }
      }
    } catch (err: unknown) {
      // If BAN CSV fails for this chunk, mark all as red
      logger.error('GEOCODER', `Chunk ${offset}-${offset + chunk.length} failed: ${err instanceof Error ? err.message : String(err)}`);
      for (let i = 0; i < chunk.length; i++) {
        const inputParts = [chunk[i].adresse, chunk[i].code_postal, chunk[i].ville].filter(Boolean);
        allResults.push({
          rowIndex: offset + i,
          inputAddress: inputParts.join(' '),
          lat: null,
          lng: null,
          score: 0,
          resultLabel: 'Erreur API BAN',
          resultType: '',
          resultCity: '',
          resultPostcode: '',
          status: 'red',
          manualOverride: false,
        });
      }
    }

    if (onProgress) {
      onProgress(Math.min(offset + chunk.length, totalRows), totalRows);
    }
  }

  return allResults;
}
