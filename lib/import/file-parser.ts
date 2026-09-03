/**
 * GENESIS — Import Universel — File Parser
 * Parse CSV (papaparse), Excel (exceljs), GeoJSON, Shapefile
 * Port TypeScript de genesis_etl/loader.py
 */
import Papa from 'papaparse';
import { readXlsxSheetRows } from './xlsx-reader';

export interface ParsedFile {
  rows: Record<string, string | null>[];
  format: 'csv' | 'xlsx' | 'geojson' | 'shapefile';
  encoding: string;
  separator: string;
  totalRows: number;
  geometryColumn?: string; // For shapefile / geojson
}

export interface ShapefileBundle {
  shp?: Buffer; // .shp (geometry)
  dbf?: Buffer; // .dbf (attributes)
  prj?: Buffer; // .prj (projection)
  shx?: Buffer; // .shx (index)
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
// Excel Parser (exceljs — voir lib/import/xlsx-reader.ts)
// ============================================================

async function parseExcel(buffer: Buffer): Promise<ParsedFile> {
  // `firstNonEmpty` reproduit le choix de feuille du loader.py Python.
  const rawData = await readXlsxSheetRows(buffer, {
    defval: null,
    raw: false, // Return all values as strings
    sheet: 'firstNonEmpty',
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

  return {
    rows,
    format: 'xlsx',
    encoding: 'binary',
    separator: 'xlsx',
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
// DBF Parser (for Shapefiles)
// Simple DBF record parser. Reads attribute table from .dbf
// ============================================================

function parseDBF(buffer: Buffer): Record<string, string | null>[] {
  // DBF file structure:
  // Byte 0: File type marker (0x03)
  // Bytes 1-3: Last update date
  // Bytes 4-7: Number of records (little-endian)
  // Bytes 8-9: Header length (little-endian)
  // Bytes 10-11: Record length (little-endian)
  // Bytes 12-31: Reserved
  // Bytes 32+: Field descriptors (each 32 bytes)
  // Fields:
  //   Byte 0: 0x0D marks end of field list
  //   Bytes 0-10: Field name (11 chars)
  //   Byte 11: Field type (C=char, N=numeric, L=logical, D=date, M=memo)
  //   Bytes 12-14: Reserved
  //   Byte 15: Field length
  //   Byte 16: Decimal count
  //   Bytes 17-31: Reserved

  let offset = 0;

  // Read header
  const fileType = buffer[offset++];
  if (fileType !== 0x03) {
    throw new Error(`DBF invalide: marqueur fichier=${fileType}`);
  }

  // Skip update date (3 bytes)
  offset += 3;

  // Read record count (little-endian)
  const recordCount =
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24);
  offset += 4;

  // Read header length (little-endian)
  const headerLength = (buffer[offset] | (buffer[offset + 1] << 8));
  offset += 2;

  // Read record length (little-endian)
  const recordLength = (buffer[offset] | (buffer[offset + 1] << 8));
  offset += 2;

  // Skip reserved bytes
  offset += 20;

  // Parse field descriptors
  const fields: { name: string; type: string; length: number; decimals: number }[] = [];

  while (offset < headerLength) {
    const byte = buffer[offset];

    if (byte === 0x0d) {
      // End of field list
      break;
    }

    const fieldName = buffer.toString('latin1', offset, offset + 11).replace(/\0/g, '').trim();
    const fieldType = buffer.toString('latin1', offset + 11, offset + 12);
    const fieldLength = buffer[offset + 16];
    const decimals = buffer[offset + 17];

    fields.push({ name: fieldName, type: fieldType, length: fieldLength, decimals });
    offset += 32;
  }

  // Parse records
  offset = headerLength;
  const rows: Record<string, string | null>[] = [];

  for (let i = 0; i < recordCount && offset < buffer.length; i++) {
    // First byte = deletion flag (0x20 = active, 0x2A = deleted)
    const isDeleted = buffer[offset++] === 0x2a;

    if (isDeleted) {
      // Skip deleted record
      offset += recordLength - 1;
      continue;
    }

    const row: Record<string, string | null> = {};

    for (const field of fields) {
      const rawValue = buffer.toString('latin1', offset, offset + field.length).trim();
      offset += field.length;

      if (!rawValue || rawValue === '*') {
        row[field.name] = null;
      } else if (field.type === 'N') {
        // Numeric field
        row[field.name] = isNaN(Number(rawValue)) ? null : rawValue;
      } else if (field.type === 'L') {
        // Logical field
        row[field.name] = rawValue === 'T' || rawValue === 'Y' ? 'true' : rawValue === 'F' || rawValue === 'N' ? 'false' : null;
      } else {
        // Character, date, memo
        row[field.name] = rawValue || null;
      }
    }

    rows.push(row);
  }

  return rows;
}

// ============================================================
// Shapefile Parser (requires .shp + .dbf bundle)
// ============================================================

export async function parseShapefile(bundle: ShapefileBundle): Promise<ParsedFile> {
  if (!bundle.dbf) {
    throw new Error('DBF manquant : un Shapefile nécessite au minimum .shp + .dbf');
  }

  // Parse DBF for attributes
  const rows = parseDBF(bundle.dbf);

  // Note: La géométrie .shp n'est pas parsée ici — les coordonnées sont lues directement
  // depuis les colonnes attributaires DBF (X/Y en hectomètres EPSG:3035 ou lat/lng WGS84).
  // Le reprojection proj4 est géré côté client dans l'import wizard (ShapefileWizard).

  return {
    rows,
    format: 'shapefile',
    encoding: 'latin1',
    separator: 'shapefile',
    totalRows: rows.length,
    geometryColumn: '_shp_geometry',
  };
}

// ============================================================
// Main entry point (single file formats)
// ============================================================

export async function parseFile(buffer: Buffer, fileName: string): Promise<ParsedFile> {
  const ext = fileName.toLowerCase().split('.').pop() || '';

  switch (ext) {
    case 'csv':
    case 'txt':
    case 'tsv':
      return parseCSV(buffer);

    case 'xlsx':
    case 'xlsm':
      return parseExcel(buffer);

    case 'xls':
      throw new Error(
        'Le format binaire .xls (Excel 97-2003) n\'est plus supporté. ' +
        'Ouvrez le fichier dans Excel ou LibreOffice et enregistrez-le en .xlsx.'
      );

    case 'geojson':
    case 'json':
      return parseGeoJSON(buffer);

    case 'shp':
      throw new Error(
        'Les Shapefiles doivent être importés avec leurs fichiers complémentaires (.shp + .dbf + .prj/.shx). ' +
        'Veuillez uploader les fichiers ensemble dans l\'assistant multi-fichiers.'
      );

    default:
      throw new Error(
        `Format de fichier non supporté : .${ext}\n` +
        'Formats acceptés : CSV, Excel (.xlsx), GeoJSON, Shapefile (.shp+.dbf+.prj+.shx)'
      );
  }
}
