/**
 * frequence-radio.com crawler — fetches frequency data for each radio
 *
 * Pattern: GET /frequence-{slug}.html → parse HTML table → extract
 * radio name, frequency MHz, department code, city
 */

import type { ImportLogger } from './import-logger';
import { RADIO_CATALOG, type RadioCatalogEntry } from './radio-catalog';

export interface CrawledFrequency {
  radio_nom: string;
  radio_slug: string;
  frequence_mhz: number;
  departement: string; // code like "75", "2A"
  ville: string;
}

const BASE_URL = 'https://www.frequence-radio.com';
const RATE_LIMIT_MS = 1200; // 1.2s between requests

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse the HTML table from a frequence-radio.com page.
 * Table format: Radio | Frequence | Département | Agglomération
 */
function parseFrequencyPage(html: string, radioNom: string, slug: string): CrawledFrequency[] {
  const results: CrawledFrequency[] = [];

  // Normalize HTML: remove newlines inside tags to make regex work
  const normalized = html.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');

  // Find table rows
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gi;

  let match;
  while ((match = rowRegex.exec(normalized)) !== null) {
    const freqStr = match[2].replace(/<[^>]*>/g, '').replace(',', '.').trim();
    const deptStr = match[3].replace(/<[^>]*>/g, '').trim();
    const cityStr = match[4].replace(/<[^>]*>/g, '').trim();

    const freq = parseFloat(freqStr);
    if (isNaN(freq) || freq < 87 || freq > 108) continue;

    // Extract department code from "75 - Paris" or "2A - Corse-du-Sud"
    const deptMatch = deptStr.match(/^(\d{2,3}[AB]?)/);
    if (!deptMatch) continue;
    const dept = deptMatch[1];

    results.push({
      radio_nom: radioNom,
      radio_slug: slug,
      frequence_mhz: freq,
      departement: dept,
      ville: cityStr,
    });
  }

  return results;
}

/**
 * Crawl all radios from the catalog.
 * Returns all frequency assignments found.
 */
export async function crawlAllRadioFrequencies(
  logger: ImportLogger,
): Promise<CrawledFrequency[]> {
  const allFreqs: CrawledFrequency[] = [];
  const catalog = RADIO_CATALOG;
  let successCount = 0;
  let failCount = 0;

  await logger.info('CRAWL', `Crawl de ${catalog.length} radios depuis frequence-radio.com`);

  for (let i = 0; i < catalog.length; i++) {
    const radio = catalog[i];
    const url = `${BASE_URL}/frequence-${radio.slug}.html`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'GEOMATIK/1.0 (Dentsu France; geospatial research)',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 404) {
        await logger.debug('CRAWL', `${radio.nom} : page introuvable (404) — slug: ${radio.slug}`);
        failCount++;
      } else if (!res.ok) {
        await logger.warn('CRAWL', `${radio.nom} : HTTP ${res.status}`);
        failCount++;
      } else {
        const html = await res.text();
        const freqs = parseFrequencyPage(html, radio.nom, radio.slug);
        allFreqs.push(...freqs);
        successCount++;
        if (freqs.length > 0) {
          await logger.info('CRAWL', `${radio.nom} : ${freqs.length} fréquences`);
        } else {
          await logger.debug('CRAWL', `${radio.nom} : 0 fréquences (page vide ou format inattendu)`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logger.warn('CRAWL', `${radio.nom} : erreur — ${msg}`);
      failCount++;
    }

    // Rate limiting
    if (i < catalog.length - 1) await sleep(RATE_LIMIT_MS);
  }

  await logger.info('CRAWL', `Crawl terminé : ${successCount} réussies, ${failCount} échouées, ${allFreqs.length} fréquences total`);
  return allFreqs;
}
