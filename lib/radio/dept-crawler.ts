/**
 * Department-based radio crawler — crawls frequence-radio.com for ALL radios
 * by auto-generating URL slugs from radio names in the database.
 *
 * Strategy: take all radios from DB that have FM frequencies (from ODS import),
 * generate URL slugs, crawl each radio page, extract freq+dept mappings.
 *
 * This covers ~1000 radios instead of just 65 from the static catalog.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportLogger } from './import-logger';

export interface DeptCrawlEntry {
  radio_nom: string;
  radio_id: string;
  frequence_mhz: number;
  departement: string;
  ville: string;
}

const BASE_URL = 'https://www.frequence-radio.com';
const RATE_LIMIT_MS = 500; // 2 req/sec — only ~376 radios with 3+ frequencies

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Generate a URL slug from a radio name */
function nameToSlug(nom: string): string {
  return nom
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/['']/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-+/g, '-');
}

/** Parse the HTML frequency table from frequence-radio.com */
function parseFrequencyPage(html: string, radioNom: string, radioId: string): DeptCrawlEntry[] {
  const results: DeptCrawlEntry[] = [];
  const normalized = html.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');

  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gi;

  let match;
  while ((match = rowRegex.exec(normalized)) !== null) {
    const freqStr = match[2].replace(/<[^>]*>/g, '').replace(',', '.').trim();
    const deptStr = match[3].replace(/<[^>]*>/g, '').trim();
    const cityStr = match[4].replace(/<[^>]*>/g, '').trim();

    const freq = parseFloat(freqStr);
    if (isNaN(freq) || freq < 87 || freq > 108) continue;

    const deptMatch = deptStr.match(/^(\d{2,3}[AB]?)/);
    if (!deptMatch) continue;

    results.push({
      radio_nom: radioNom,
      radio_id: radioId,
      frequence_mhz: freq,
      departement: deptMatch[1],
      ville: cityStr,
    });
  }

  return results;
}

/**
 * Crawl frequence-radio.com for all radios in the database that have FM frequencies.
 * Auto-generates URL slugs from radio names.
 *
 * @param maxRadios Maximum number of radios to crawl (for testing). 0 = all.
 */
export async function crawlAllDepartments(
  supabase: SupabaseClient,
  logger: ImportLogger,
  maxRadios: number = 0,
): Promise<DeptCrawlEntry[]> {
  // Load all radios with FM frequencies
  const { data: radios } = await supabase
    .from('radios')
    .select('id, nom, metadata')
    .not('metadata->frequences_fm', 'is', null)
    .limit(100000);

  if (!radios || radios.length === 0) {
    await logger.warn('CRAWL_DEPT', 'Aucune radio avec fréquences FM trouvée. Importez d\'abord le référentiel ODS.');
    return [];
  }

  // ALL radios with at least 1 FM frequency, sorted by count desc (most important first)
  const radiosToCrawl = radios
    .filter(r => {
      const freqs = (r.metadata as Record<string, unknown>)?.frequences_fm;
      return Array.isArray(freqs) && freqs.length > 0;
    })
    .sort((a, b) => {
      const aLen = ((a.metadata as Record<string, unknown>)?.frequences_fm as unknown[])?.length ?? 0;
      const bLen = ((b.metadata as Record<string, unknown>)?.frequences_fm as unknown[])?.length ?? 0;
      return bLen - aLen;
    });

  const total = maxRadios > 0 ? Math.min(maxRadios, radiosToCrawl.length) : radiosToCrawl.length;
  await logger.info('CRAWL_DEPT', `${total} radios à crawler (toutes avec fréquences FM)`);

  const allEntries: DeptCrawlEntry[] = [];
  let success = 0;
  let fail404 = 0;
  let failOther = 0;

  for (let i = 0; i < total; i++) {
    const radio = radiosToCrawl[i];
    const slug = nameToSlug(radio.nom);
    const url = `${BASE_URL}/frequence-${slug}.html`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'dentsu.explore/1.0 (Dentsu France; geospatial research)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 404) {
        fail404++;
        // Try alternative slug (without common suffixes)
        const altSlug = slug.replace(/-fm$/, '').replace(/-radio$/, '');
        if (altSlug !== slug) {
          const altRes = await fetch(`${BASE_URL}/frequence-${altSlug}.html`, {
            headers: { 'User-Agent': 'dentsu.explore/1.0', Accept: 'text/html' },
            signal: AbortSignal.timeout(10_000),
          });
          if (altRes.ok) {
            const html = await altRes.text();
            const entries = parseFrequencyPage(html, radio.nom, radio.id);
            allEntries.push(...entries);
            if (entries.length > 0) { success++; fail404--; }
          }
        }
      } else if (!res.ok) {
        failOther++;
      } else {
        const html = await res.text();
        const entries = parseFrequencyPage(html, radio.nom, radio.id);
        allEntries.push(...entries);
        if (entries.length > 0) success++;
      }
    } catch {
      failOther++;
    }

    // Progress every 50 radios
    if ((i + 1) % 50 === 0 || i === total - 1) {
      await logger.info('CRAWL_DEPT', `${i + 1}/${total} radios crawlées — ${success} avec données, ${fail404} 404, ${failOther} erreurs`);
    }

    if (i < total - 1) await sleep(RATE_LIMIT_MS);
  }

  // Deduplicate entries
  const uniqueEntries = new Map<string, DeptCrawlEntry>();
  for (const e of allEntries) {
    const key = `${e.radio_id}:${e.departement}:${e.frequence_mhz}`;
    uniqueEntries.set(key, e);
  }

  const deduped = [...uniqueEntries.values()];
  await logger.info('CRAWL_DEPT', `Crawl terminé : ${success} radios trouvées, ${deduped.length} fréquences uniques dans ${new Set(deduped.map(e => e.departement)).size} départements`);

  return deduped;
}
