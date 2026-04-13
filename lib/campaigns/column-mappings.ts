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
    'media':        'media',
    'unique impressions': 'unique_impressions',
  },
};

/**
 * Auto-detect mapping from file headers.
 * Matches common column name variants to our schema fields.
 * Returns a mapping object or null if not enough fields matched.
 */
export function autoDetectMapping(headers: string[]): ColumnMapping | null {
  const patterns: { target: string; variants: string[] }[] = [
    { target: 'campaign_name', variants: ['campaign', 'campagne', 'campaign name', 'nom campagne'] },
    { target: 'date',          variants: ['date', 'jour', 'day'] },
    { target: 'city',          variants: ['city', 'ville', 'town'] },
    { target: 'country',       variants: ['country', 'pays'] },
    { target: 'postal_code',   variants: ['postal code', 'postal_code', 'code postal', 'cp', 'zip', 'zipcode', 'zip code', 'postcode'] },
    { target: 'region',        variants: ['region', 'région'] },
    { target: 'dma_region',    variants: ['dma region', 'dma'] },
    { target: 'tracked_ads',   variants: ['tracked ads', 'tracked_ads', 'impressions', 'imps', 'imp', 'views', 'ads'] },
    { target: 'media',         variants: ['media', 'média', 'regie', 'régie', 'publisher', 'source', 'medi', 'medium'] },
    { target: 'unique_impressions', variants: ['unique impressions', 'unique_impressions', 'unique users', 'uu', 'reach', 'unique views', 'impressions uniques'] },
  ];

  const mapping: ColumnMapping = {};
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  for (const { target, variants } of patterns) {
    for (const variant of variants) {
      const idx = lowerHeaders.indexOf(variant);
      if (idx !== -1) {
        mapping[headers[idx].trim()] = target;
        break;
      }
    }
  }

  // Need at least tracked_ads + (postal_code or country) to be a valid mapping
  const values = Object.values(mapping);
  if (!values.includes('tracked_ads')) return null;
  if (!values.includes('postal_code') && !values.includes('country')) return null;

  return mapping;
}

/**
 * Date parsers per DSP source.
 * Adform uses DD/MM/YYYY. Others may differ.
 */
export function parseDate(raw: string, _dspSource?: string): string | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();

  // ISO: YYYY-MM-DD or YYYY-MM-DDT...
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

  // MM/DD/YYYY (US format — month <= 12, day > 12 = unambiguous)
  const mdy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (mdy && Number(mdy[1]) <= 12 && Number(mdy[2]) > 12) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }

  // YYYY/MM/DD
  const ymd = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;

  // DD MMM YYYY or DD-MMM-YYYY (e.g. "01 Jan 2026")
  const monthNames: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    janv: '01', févr: '02', mars: '03', avr: '04', mai: '05', juin: '06',
    juil: '07', août: '08', sept: '09', déc: '12',
  };
  const textDate = s.match(/^(\d{1,2})[\s-](\w+)[\s-](\d{4})$/i);
  if (textDate) {
    const mm = monthNames[textDate[2].toLowerCase().slice(0, 3)] ?? monthNames[textDate[2].toLowerCase().slice(0, 4)];
    if (mm) return `${textDate[3]}-${mm}-${textDate[1].padStart(2, '0')}`;
  }

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
