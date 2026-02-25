/**
 * GENESIS — Import Universel — File Parser
 * Parse CSV (papaparse), Excel (xlsx), GeoJSON
 * Port TypeScript de genesis_etl/loader.py
 */
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedFile {
  rows: Record<string, string | null>[];
  format: 'csv' | 'xlsx' | 'geojson';
  encoding: string;
  separator: string;
  totalRows: number;
}

// ============================================================
// Encoding detection (UTF-8 first, fallback latin-1)
// Mirrors Python loader.py line 113-121
// ============================================================

function decodeBuffer(buffer: Buffer): { text: string; encoding: string } {
  // Try UTF-8 first (strict mode)
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const text = decoder.decode(buffer);
    return { text, encoding: 'utf-8' };
  } catch {
    // Fallback to latin-1 (never throws)
    const decoder = new TextDecoder('latin1');
    const text = decoder.decode(buffer);
    return { text, encoding: 'latin-1' };
  }
}

// ============================================================
// Separator detection
// Mirrors Python loader.py detect_separator()
// ============================================================

function detectSeparator(sample: string): string {
  const separators = [',', ';', '\t', '|'];
  let bestSep = ',';
  let bestCount = 0;

  // Count in first few lines only (avoid false positives in data values)
  const lines = sample.split('\n').slice(0, 5);
  const header = lines[0] || '';

  for (const sep of separators) {
    const count = (header.match(new RegExp(sep === '|' ? '\\|' : sep === '\t' ? '\t' : sep, 'g')) || []).length;
    if (count > bestCount) {
      bestCount = count;
      bestSep = sep;
    }
  }

  return bestSep;
}

// ============================================================
// CSV Parser (papaparse)
// ============================================================

function parseCSV(buffer: Buffer): ParsedFile {
  const { text, encoding } = decodeBuffer(buffer);
  const sample = text.slice(0, 4096);
  const separator = detectSeparator(sample);

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    delimiter: separator,
    skipEmptyLines: true,
    dynamicTyping: false, // Keep everything as strings (matches Python dtype=str)
  });

  const rows = result.data.map((row) => {
    const cleaned: Record<string, string | null> = {};
    for (const [key, val] of Object.entries(row)) {
      // Treat NA-like values as null (matches Python loader.py NA_VALUES)
      const v = val?.trim();
      if (!v || v === 'NA' || v === 'N/A' || v === 'null' || v === 'NULL' || v === 'None' || v === '#N/A') {
        cleaned[key] = null;
      } else {
        cleaned[key] = v;
      }
    }
    return cleaned;
  });

  return {
    rows,
    format: 'csv',
    encoding,
    separator,
    totalRows: rows.length,
  };
}

// ============================================================
// Excel Parser (xlsx / SheetJS)
// ============================================================

function parseExcel(buffer: Buffer, fileName: string): ParsedFile {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  // Find first non-empty sheet (matches Python loader.py _load_excel)
  let sheetName = workbook.SheetNames[0];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    if (data.length > 0) {
      sheetName = name;
      break;
    }
  }

  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false, // Return all values as strings
  });

  const rows: Record<string, string | null>[] = rawData.map((row) => {
    const cleaned: Record<string, string | null> = {};
    for (const [key, val] of Object.entries(row)) {
      if (val === null || val === undefined) {
        cleaned[key] = null;
      } else {
        const v = String(val).trim();
        if (!v || v === 'NA' || v === 'N/A' || v === 'null' || v === 'NULL') {
          cleaned[key] = null;
        } else {
          cleaned[key] = v;
        }
      }
    }
    return cleaned;
  });

  const ext = fileName.toLowerCase().endsWith('.xls') ? 'xls' : 'xlsx';

  return {
    rows,
    format: 'xlsx',
    encoding: 'binary',
    separator: ext === 'xls' ? 'xls' : 'xlsx',
    totalRows: rows.length,
  };
}

// ============================================================
// GeoJSON Parser
// ============================================================

function parseGeoJSON(buffer: Buffer): ParsedFile {
  const { text, encoding } = decodeBuffer(buffer);
  const geojson = JSON.parse(text);

  if (!geojson.features || !Array.isArray(geojson.features)) {
    throw new Error('Format GeoJSON invalide : pas de tableau "features"');
  }

  const rows: Record<string, string | null>[] = geojson.features.map(
    (feature: { properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }) => {
      const props: Record<string, string | null> = {};

      // Flatten properties
      if (feature.properties) {
        for (const [key, val] of Object.entries(feature.properties)) {
          props[key] = val !== null && val !== undefined ? String(val) : null;
        }
      }

      // Extract coordinates from geometry
      if (feature.geometry?.coordinates) {
        const coords = feature.geometry.coordinates;
        props['_geojson_lng'] = String(coords[0]);
        props['_geojson_lat'] = String(coords[1]);
      }

      return props;
    }
  );

  return {
    rows,
    format: 'geojson',
    encoding,
    separator: 'geojson',
    totalRows: rows.length,
  };
}

// ============================================================
// Main entry point
// ============================================================

export function parseFile(buffer: Buffer, fileName: string): ParsedFile {
  const ext = fileName.toLowerCase().split('.').pop() || '';

  switch (ext) {
    case 'csv':
    case 'txt':
    case 'tsv':
      return parseCSV(buffer);

    case 'xlsx':
    case 'xls':
    case 'xlsm':
      return parseExcel(buffer, fileName);

    case 'geojson':
    case 'json':
      return parseGeoJSON(buffer);

    default:
      throw new Error(`Format de fichier non supporté : .${ext}\nFormats acceptés : CSV, Excel (.xlsx/.xls), GeoJSON`);
  }
}
