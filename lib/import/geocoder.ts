/**
 * GENESIS — Import Universel — Geocoder
 * Port TypeScript exact de genesis_etl/geocoder.py
 * - GPS validation
 * - BAN API geocoding (api-adresse.data.gouv.fr)
 * - Lambert-93 → WGS84 conversion (proj4)
 */
import proj4 from 'proj4';
import type { GeoResult } from './types';

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

const BAN_API_URL = 'https://api-adresse.data.gouv.fr/search/';
const SCORE_THRESHOLD = 0.6;

export async function geocodeSingle(adresse: string, retries = 2): Promise<GeoResult> {
  if (!adresse || !adresse.trim()) {
    return { lat: null, lng: null, score: 0 };
  }

  const params = new URLSearchParams({ q: adresse.trim(), limit: '1' });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${BAN_API_URL}?${params}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`BAN API HTTP ${response.status}`);
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
    } catch (err) {
      if (attempt < retries) {
        // Exponential backoff (matches Python geocoder.py retry logic)
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  return { lat: null, lng: null, score: 0 };
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
// Utility
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
