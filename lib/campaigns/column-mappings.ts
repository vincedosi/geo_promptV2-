/**
 * GENESIS — DSP column mappings
 *
 * Each DSP export has different column names.
 * A mapping converts source column names → our schema fields.
 */

export interface ColumnMapping {
  /** Source column name → target field name */
  [sourceColumn: string]: string;
}

/**
 * Known mappings per DSP source.
 * Keys are lowercase source column names.
 * Values are our dsp_campaign_data field names.
 */
export const DSP_MAPPINGS: Record<string, ColumnMapping> = {
  adform: {
    'campaign':     'campaign_name',
    'date':         'date',
    'city':         'city',
    'country':      'country',
    'postal code':  'postal_code',
    'region':       'region',
    'dma region':   'dma_region',
    'tracked ads':  'tracked_ads',
  },
};

/**
 * Date parsers per DSP source.
 * Adform uses DD/MM/YYYY. Others may differ.
 */
export function parseDate(raw: string, dspSource: string): string | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();

  if (dspSource === 'adform') {
    // DD/MM/YYYY → YYYY-MM-DD
    const match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (match) {
      const [, dd, mm, yyyy] = match;
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
  }

  // Fallback: try ISO format (YYYY-MM-DD)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Excel serial number (e.g. 45952 = 2025-11-01)
  const serial = Number(s);
  if (!isNaN(serial) && serial > 40000 && serial < 60000) {
    const d = new Date((serial - 25569) * 86400000);
    return d.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Resolve the column mapping for a given DSP source.
 * Falls back to adform if unknown source.
 */
export function getMappingForSource(dspSource: string): ColumnMapping {
  return DSP_MAPPINGS[dspSource.toLowerCase()] ?? DSP_MAPPINGS.adform;
}
