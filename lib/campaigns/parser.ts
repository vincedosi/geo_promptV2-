/**
 * GENESIS — DSP campaign file parser
 *
 * Parses CSV/XLSX files and applies DSP column mapping
 * to produce normalized campaign data rows.
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { getMappingForSource, parseDate } from './column-mappings';

export interface ParsedCampaignRow {
  campaign_name: string;
  date: string | null;
  city: string | null;
  country: string;
  postal_code: string | null;
  region: string | null;
  dma_region: string | null;
  tracked_ads: number;
}

export interface CampaignParseResult {
  rows: ParsedCampaignRow[];
  campaign_name: string;
  countries: string[];
  date_start: string | null;
  date_end: string | null;
  total_tracked_ads: number;
  errors: string[];
}

/**
 * Parse a campaign file (CSV or XLSX buffer) with the given DSP source mapping.
 */
export function parseCampaignFile(
  buffer: Buffer,
  fileName: string,
  dspSource: string
): CampaignParseResult {
  const isXlsx = /\.xlsx?$/i.test(fileName);
  const rawRows = isXlsx ? parseXlsx(buffer) : parseCsv(buffer);

  const mapping = getMappingForSource(dspSource);
  const errors: string[] = [];
  const rows: ParsedCampaignRow[] = [];

  let campaignName = '';
  const countriesSet = new Set<string>();
  let totalTrackedAds = 0;
  const dates: string[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const mapped = applyMapping(raw, mapping);

    // campaign_name: take from first row that has it
    if (mapped.campaign_name && !campaignName) {
      campaignName = mapped.campaign_name;
    }

    // country is required
    if (!mapped.country) {
      errors.push(`Ligne ${i + 2}: pays manquant`);
      continue;
    }

    const date = parseDate(mapped.date_raw ?? '', dspSource);
    const trackedAds = parseInt(String(mapped.tracked_ads_raw ?? '0').replace(/[^0-9-]/g, ''), 10) || 0;

    const row: ParsedCampaignRow = {
      campaign_name: mapped.campaign_name ?? campaignName,
      date,
      city: mapped.city?.trim() || null,
      country: mapped.country.trim(),
      postal_code: mapped.postal_code?.trim() || null,
      region: mapped.region?.trim() || null,
      dma_region: mapped.dma_region?.trim() || null,
      tracked_ads: trackedAds,
    };

    rows.push(row);
    countriesSet.add(row.country);
    totalTrackedAds += trackedAds;
    if (date) dates.push(date);
  }

  dates.sort();

  return {
    rows,
    campaign_name: campaignName || fileName.replace(/\.\w+$/, ''),
    countries: Array.from(countriesSet).sort(),
    date_start: dates[0] ?? null,
    date_end: dates[dates.length - 1] ?? null,
    total_tracked_ads: totalTrackedAds,
    errors,
  };
}

/* ── Internal helpers ────────────────────────── */

function parseCsv(buffer: Buffer): Record<string, string>[] {
  // Try UTF-8 first, fallback to latin-1
  let text = buffer.toString('utf-8');
  if (text.includes('')) {
    text = buffer.toString('latin1');
  }

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
  return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
}

interface MappedFields {
  campaign_name?: string;
  date_raw?: string;
  city?: string;
  country?: string;
  postal_code?: string;
  region?: string;
  dma_region?: string;
  tracked_ads_raw?: string;
}

function applyMapping(
  raw: Record<string, string>,
  mapping: Record<string, string>
): MappedFields {
  const result: Record<string, string> = {};

  // Build a lowercase lookup for the raw row's keys
  const rawLower: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    rawLower[key.toLowerCase().trim()] = raw[key];
  }

  for (const [sourceCol, targetField] of Object.entries(mapping)) {
    const value = rawLower[sourceCol.toLowerCase()];
    if (value !== undefined) {
      if (targetField === 'date') {
        result['date_raw'] = value;
      } else if (targetField === 'tracked_ads') {
        result['tracked_ads_raw'] = value;
      } else {
        result[targetField] = value;
      }
    }
  }

  return result as MappedFields;
}
