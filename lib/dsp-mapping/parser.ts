/**
 * GEOMATIK — Parser CSV/XLSX dynamique piloté par `dsp_source_mappings`.
 *
 * Remplace `lib/campaigns/parser.ts` + `lib/campaigns/column-mappings.ts`.
 * La structure des sorties est piloté par les mappings DB :
 *  - `core` : colonnes natives sur dsp_campaign_data
 *  - `metrics` : injecté dans le JSONB metrics
 *  - `dimensions` : colonnes natives dimensionnelles (media, city, region, …)
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { applyTransform } from './transformer';
import {
  DataTypeCastError,
  MissingRequiredColumnError,
  type DataType,
  type ParsedRow,
  type SourceMapping,
} from './types';
import { validateCsvHeaders } from './validator';

/* ─── Cast ──────────────────────────────────────────────────────────── */

function castToDataType(value: unknown, dataType: DataType, column: string): unknown {
  if (value === null || value === undefined || value === '') return null;

  const str = String(value).trim();
  if (str === '') return null;

  switch (dataType) {
    case 'text':
      return str;
    case 'int': {
      const n = Number(str.replace(/[^\d.\-]/g, ''));
      if (!isFinite(n)) throw new DataTypeCastError(value, dataType, column);
      return Math.trunc(n);
    }
    case 'bigint': {
      // Postgres bigint accepte un number JS jusqu'à 2^53 — pour la donnée
      // DSP réaliste, c'est ok. Au-delà, supabase-js gère les bigints en string.
      const n = Number(str.replace(/[^\d.\-]/g, ''));
      if (!isFinite(n)) throw new DataTypeCastError(value, dataType, column);
      return Math.trunc(n);
    }
    case 'numeric': {
      const cleaned = str.replace(/[€$£\s]/g, '').replace(/,/g, '.');
      const n = Number(cleaned);
      if (!isFinite(n)) throw new DataTypeCastError(value, dataType, column);
      return n;
    }
    case 'date': {
      // La transform `parse_eu_date` (ou pas de transform avec ISO) doit
      // déjà avoir produit YYYY-MM-DD à ce stade.
      const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) throw new DataTypeCastError(value, dataType, column);
      return str;
    }
    case 'timestamp':
      return str;
  }
}

/* ─── parseRow ──────────────────────────────────────────────────────── */

/**
 * Construit un index normalisé { headerLower → headerOriginal } pour résoudre
 * la valeur d'une `source_column` quel que soit son casing dans le CSV.
 */
function buildHeaderIndex(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(row)) {
    out[k.toLowerCase().trim()] = k;
  }
  return out;
}

/**
 * Parse une ligne brute en `ParsedRow` selon les mappings du DSP.
 *
 * - Required absent → throw `MissingRequiredColumnError` (le caller décide
 *   s'il skip la ligne ou abandonne tout l'import — convention : skip avec
 *   une erreur loggée, comme l'ancien parser le faisait pour `country`).
 * - Cast échoué → throw `DataTypeCastError` (idem, caller décide).
 */
export function parseRow(
  csvRow: Record<string, string>,
  mappings: SourceMapping[],
): ParsedRow {
  const result: ParsedRow = { core: {}, metrics: {}, dimensions: {} };
  const headerIndex = buildHeaderIndex(csvRow);

  const missing: string[] = [];

  for (const mapping of mappings) {
    const headerOriginal = headerIndex[mapping.sourceColumn.toLowerCase().trim()];
    const rawValue = headerOriginal !== undefined ? csvRow[headerOriginal] : undefined;

    const isEmpty = rawValue === undefined || rawValue === null || String(rawValue).trim() === '';

    if (isEmpty) {
      if (mapping.isRequired) {
        missing.push(mapping.sourceColumn);
      }
      continue;
    }

    const transformed = applyTransform(String(rawValue), mapping.transform);
    const typed = castToDataType(transformed, mapping.dataType, mapping.sourceColumn);
    if (typed === null && mapping.isRequired) {
      missing.push(mapping.sourceColumn);
      continue;
    }

    const bucket =
      mapping.targetLocation === 'core'
        ? result.core
        : mapping.targetLocation === 'metrics'
          ? result.metrics
          : result.dimensions;
    bucket[mapping.targetField] = typed;
  }

  if (missing.length > 0) {
    throw new MissingRequiredColumnError(missing);
  }

  return result;
}

/* ─── parseFile : remplace parseCampaignFile() ──────────────────────── */

export interface ParseFileResult {
  rows: ParsedRow[];
  headers: string[];
  totalRows: number;
  validationErrors: string[];
  campaignName: string;
  countries: string[];
  dateStart: string | null;
  dateEnd: string | null;
  totalTrackedAds: number;
  totalUniqueImpressions: number;
  totalImpressions: number;
}

function parseCsv(buffer: Buffer): Record<string, string>[] {
  let text = buffer.toString('utf-8');
  if (text.includes('�')) text = buffer.toString('latin1');
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  });
  return result.data;
}

function parseXlsx(buffer: Buffer): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });
}

/**
 * Parse complet d'un fichier DSP : extraction CSV/XLSX → validation headers
 * → parseRow ligne par ligne. Les lignes en erreur sont loggées et skippées
 * (comportement Adform legacy). Les lignes valides sont retournées.
 */
export function parseFile(
  buffer: Buffer,
  fileName: string,
  mappings: SourceMapping[],
): ParseFileResult {
  const isXlsx = /\.xlsx?$/i.test(fileName);
  const rawRows = isXlsx ? parseXlsx(buffer) : parseCsv(buffer);
  const headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];

  const validation = validateCsvHeaders(headers, mappings);
  if (!validation.valid) {
    throw new MissingRequiredColumnError(validation.missingRequired);
  }

  const rows: ParsedRow[] = [];
  const validationErrors: string[] = [];
  const countriesSet = new Set<string>();
  const dates: string[] = [];

  let totalTrackedAds = 0;
  let totalUniqueImpressions = 0;
  let totalImpressions = 0;
  let campaignName = '';

  for (let i = 0; i < rawRows.length; i++) {
    try {
      const parsed = parseRow(rawRows[i], mappings);
      rows.push(parsed);

      const country = parsed.core.country ?? parsed.dimensions.country;
      if (typeof country === 'string') countriesSet.add(country);

      const cn = parsed.dimensions.campaign_name;
      if (!campaignName && typeof cn === 'string') campaignName = cn;

      const d = parsed.core.date;
      if (typeof d === 'string') dates.push(d);

      const ta = parsed.core.tracked_ads;
      if (typeof ta === 'number') totalTrackedAds += ta;

      const ui = parsed.core.unique_impressions;
      if (typeof ui === 'number') totalUniqueImpressions += ui;

      const imp = parsed.core.impressions;
      if (typeof imp === 'number') totalImpressions += imp;
    } catch (err) {
      validationErrors.push(`Ligne ${i + 2}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  dates.sort();

  return {
    rows,
    headers,
    totalRows: rows.length,
    validationErrors,
    campaignName: campaignName || fileName.replace(/\.\w+$/, ''),
    countries: Array.from(countriesSet).sort(),
    dateStart: dates[0] ?? null,
    dateEnd: dates[dates.length - 1] ?? null,
    totalTrackedAds,
    totalUniqueImpressions,
    totalImpressions,
  };
}

/* ─── Helper : extraire les headers seuls (sans parser les rows) ──── */

export function readHeaders(buffer: Buffer, fileName: string): string[] {
  const isXlsx = /\.xlsx?$/i.test(fileName);
  if (isXlsx) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false });
    return rows.length > 0 ? Object.keys(rows[0]) : [];
  }
  let text = buffer.toString('utf-8');
  if (text.includes('�')) text = buffer.toString('latin1');
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    preview: 1,
    transformHeader: (h: string) => h.trim(),
  });
  return result.meta.fields ?? [];
}
