/**
 * Arcom prefectures crawler — fetches radio listings from arcom.fr
 * for each department capital to discover which radios broadcast where.
 *
 * URL: https://www.arcom.fr/radio-et-audio-numerique/radio-fm-dab/radios-ville/{slug}-{cp}
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportLogger } from './import-logger';

export interface ArcomRadioEntry {
  radio_nom: string;
  departement: string;
  type: 'FM' | 'DAB+' | 'both';
}

const RATE_LIMIT_MS = 1200; // 1.2 req/sec — polite for Arcom

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 100 prefectures: dept code → { slug, cp }
const PREFECTURES: Record<string, { slug: string; cp: string }> = {
  '01': { slug: 'bourg-en-bresse', cp: '01000' },
  '02': { slug: 'laon', cp: '02000' },
  '03': { slug: 'moulins', cp: '03000' },
  '04': { slug: 'digne-les-bains', cp: '04000' },
  '05': { slug: 'gap', cp: '05000' },
  '06': { slug: 'nice', cp: '06000' },
  '07': { slug: 'privas', cp: '07000' },
  '08': { slug: 'charleville-mezieres', cp: '08000' },
  '09': { slug: 'foix', cp: '09000' },
  '10': { slug: 'troyes', cp: '10000' },
  '11': { slug: 'carcassonne', cp: '11000' },
  '12': { slug: 'rodez', cp: '12000' },
  '13': { slug: 'marseille', cp: '13000' },
  '14': { slug: 'caen', cp: '14000' },
  '15': { slug: 'aurillac', cp: '15000' },
  '16': { slug: 'angouleme', cp: '16000' },
  '17': { slug: 'la-rochelle', cp: '17000' },
  '18': { slug: 'bourges', cp: '18000' },
  '19': { slug: 'tulle', cp: '19000' },
  '2A': { slug: 'ajaccio', cp: '20000' },
  '2B': { slug: 'bastia', cp: '20200' },
  '21': { slug: 'dijon', cp: '21000' },
  '22': { slug: 'saint-brieuc', cp: '22000' },
  '23': { slug: 'gueret', cp: '23000' },
  '24': { slug: 'perigueux', cp: '24000' },
  '25': { slug: 'besancon', cp: '25000' },
  '26': { slug: 'valence', cp: '26000' },
  '27': { slug: 'evreux', cp: '27000' },
  '28': { slug: 'chartres', cp: '28000' },
  '29': { slug: 'quimper', cp: '29000' },
  '30': { slug: 'nimes', cp: '30000' },
  '31': { slug: 'toulouse', cp: '31000' },
  '32': { slug: 'auch', cp: '32000' },
  '33': { slug: 'bordeaux', cp: '33000' },
  '34': { slug: 'montpellier', cp: '34000' },
  '35': { slug: 'rennes', cp: '35000' },
  '36': { slug: 'chateauroux', cp: '36000' },
  '37': { slug: 'tours', cp: '37000' },
  '38': { slug: 'grenoble', cp: '38000' },
  '39': { slug: 'lons-le-saunier', cp: '39000' },
  '40': { slug: 'mont-de-marsan', cp: '40000' },
  '41': { slug: 'blois', cp: '41000' },
  '42': { slug: 'saint-etienne', cp: '42000' },
  '43': { slug: 'le-puy-en-velay', cp: '43000' },
  '44': { slug: 'nantes', cp: '44000' },
  '45': { slug: 'orleans', cp: '45000' },
  '46': { slug: 'cahors', cp: '46000' },
  '47': { slug: 'agen', cp: '47000' },
  '48': { slug: 'mende', cp: '48000' },
  '49': { slug: 'angers', cp: '49000' },
  '50': { slug: 'saint-lo', cp: '50000' },
  '51': { slug: 'chalons-en-champagne', cp: '51000' },
  '52': { slug: 'chaumont', cp: '52000' },
  '53': { slug: 'laval', cp: '53000' },
  '54': { slug: 'nancy', cp: '54000' },
  '55': { slug: 'bar-le-duc', cp: '55000' },
  '56': { slug: 'vannes', cp: '56000' },
  '57': { slug: 'metz', cp: '57000' },
  '58': { slug: 'nevers', cp: '58000' },
  '59': { slug: 'lille', cp: '59000' },
  '60': { slug: 'beauvais', cp: '60000' },
  '61': { slug: 'alencon', cp: '61000' },
  '62': { slug: 'arras', cp: '62000' },
  '63': { slug: 'clermont-ferrand', cp: '63000' },
  '64': { slug: 'pau', cp: '64000' },
  '65': { slug: 'tarbes', cp: '65000' },
  '66': { slug: 'perpignan', cp: '66000' },
  '67': { slug: 'strasbourg', cp: '67000' },
  '68': { slug: 'colmar', cp: '68000' },
  '69': { slug: 'lyon', cp: '69000' },
  '70': { slug: 'vesoul', cp: '70000' },
  '71': { slug: 'macon', cp: '71000' },
  '72': { slug: 'le-mans', cp: '72000' },
  '73': { slug: 'chambery', cp: '73000' },
  '74': { slug: 'annecy', cp: '74000' },
  '75': { slug: 'paris', cp: '75000' },
  '76': { slug: 'rouen', cp: '76000' },
  '77': { slug: 'melun', cp: '77000' },
  '78': { slug: 'versailles', cp: '78000' },
  '79': { slug: 'niort', cp: '79000' },
  '80': { slug: 'amiens', cp: '80000' },
  '81': { slug: 'albi', cp: '81000' },
  '82': { slug: 'montauban', cp: '82000' },
  '83': { slug: 'toulon', cp: '83000' },
  '84': { slug: 'avignon', cp: '84000' },
  '85': { slug: 'la-roche-sur-yon', cp: '85000' },
  '86': { slug: 'poitiers', cp: '86000' },
  '87': { slug: 'limoges', cp: '87000' },
  '88': { slug: 'epinal', cp: '88000' },
  '89': { slug: 'auxerre', cp: '89000' },
  '90': { slug: 'belfort', cp: '90000' },
  '91': { slug: 'evry-courcouronnes', cp: '91000' },
  '92': { slug: 'nanterre', cp: '92000' },
  '93': { slug: 'bobigny', cp: '93000' },
  '94': { slug: 'creteil', cp: '94000' },
  '95': { slug: 'cergy', cp: '95000' },
  '971': { slug: 'basse-terre', cp: '97100' },
  '972': { slug: 'fort-de-france', cp: '97200' },
  '973': { slug: 'cayenne', cp: '97300' },
  '974': { slug: 'saint-denis', cp: '97400' },
};

const BASE_URL = 'https://www.arcom.fr/radio-et-audio-numerique/radio-fm-dab/radios-ville';

/**
 * Parse radio names from Arcom city page HTML.
 * Structure: <a ... class="fw-bold stretched-link">
 *              Radio Scoop
 *              <span ...>DAB+ · FM</span>
 *            </a>
 */
function parseArcomPage(html: string): string[] {
  const radioNames: string[] = [];
  const normalized = html.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');

  // Match the Arcom HTML structure: <a ...stretched-link">  Name  <span...>type</span> </a>
  const regex = /class="[^"]*stretched-link[^"]*"[^>]*>\s*([^<]+?)\s*<span[^>]*>\s*((?:DAB\+|FM)[\s·]*(?:DAB\+|FM)?)\s*<\/span>/gi;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const name = match[1].trim();
    if (name.length >= 2 && name.length < 80) {
      radioNames.push(name);
    }
  }

  // Fallback: look for bk-radio-station-list__item pattern
  if (radioNames.length === 0) {
    const fallback = /bk-radio-station-list__item[^>]*>.*?<a[^>]*>\s*([^<]+?)\s*<span/gi;
    while ((match = fallback.exec(normalized)) !== null) {
      const name = match[1].trim();
      if (name.length >= 2 && name.length < 80) {
        radioNames.push(name);
      }
    }
  }

  return [...new Set(radioNames)];
}

/**
 * Crawl Arcom for all 100 prefectures.
 * Returns entries mapping radio_nom → departement.
 */
export async function crawlArcomPrefectures(
  supabase: SupabaseClient,
  logger: ImportLogger,
): Promise<ArcomRadioEntry[]> {
  const depts = Object.keys(PREFECTURES);
  await logger.info('ARCOM_CRAWL', `Crawl de ${depts.length} préfectures sur arcom.fr`);

  const allEntries: ArcomRadioEntry[] = [];
  let success = 0;
  let fail = 0;

  for (let i = 0; i < depts.length; i++) {
    const dept = depts[i];
    const pref = PREFECTURES[dept];
    const url = `${BASE_URL}/${pref.slug}-${pref.cp}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'GEOMATIK/1.0 (Dentsu France; geospatial research)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        fail++;
        if ((i + 1) % 20 === 0) await logger.debug('ARCOM_CRAWL', `${pref.slug}: HTTP ${res.status}`);
      } else {
        const html = await res.text();
        const radios = parseArcomPage(html);

        for (const nom of radios) {
          allEntries.push({ radio_nom: nom, departement: dept, type: 'FM' });
        }

        success++;
        if (radios.length > 0 && (i + 1) % 10 === 0) {
          await logger.info('ARCOM_CRAWL', `${i + 1}/${depts.length} — ${pref.slug} (${dept}): ${radios.length} radios`);
        }
      }
    } catch (err) {
      fail++;
      const msg = err instanceof Error ? err.message : String(err);
      if ((i + 1) % 20 === 0) await logger.debug('ARCOM_CRAWL', `${pref.slug}: erreur — ${msg}`);
    }

    if (i < depts.length - 1) await sleep(RATE_LIMIT_MS);
  }

  // Deduplicate
  const unique = new Map<string, ArcomRadioEntry>();
  for (const e of allEntries) {
    unique.set(`${e.radio_nom}|${e.departement}`, e);
  }

  const result = [...unique.values()];
  const uniqueRadios = new Set(result.map(e => e.radio_nom));
  await logger.info('ARCOM_CRAWL', `Crawl terminé : ${success}/${depts.length} préfectures, ${uniqueRadios.size} radios uniques, ${result.length} entrées dept-radio`);

  return result;
}

/**
 * Match Arcom-discovered radios with emitters.
 * For each radio found via Arcom in a department, if it exists in our DB
 * with 0 emitters, add it to the dept→radio index for the matcher.
 */
export async function enrichDeptIndexFromArcom(
  supabase: SupabaseClient,
  logger: ImportLogger,
  arcomEntries: ArcomRadioEntry[],
  existingDeptIndex: Map<string, Set<string>>, // dept → Set<radio_id>
): Promise<number> {
  // Load all radios from DB — build exact + fuzzy lookup maps
  const { data: allRadios } = await supabase.from('radios').select('id, nom').limit(100000);
  const radioByExactName = new Map<string, string>(); // lowercase nom → id
  const allRadiosList = allRadios ?? [];
  for (const r of allRadiosList) {
    radioByExactName.set(r.nom.toLowerCase().trim(), r.id);
  }

  let enriched = 0;
  let matched = 0;
  let notFound = 0;
  let fuzzyMatched = 0;
  const notFoundNames: string[] = [];

  for (const entry of arcomEntries) {
    const normalizedName = entry.radio_nom.toLowerCase().trim();

    // 1. Exact match (lowercase + trim)
    let radioId = radioByExactName.get(normalizedName);

    // 2. Fuzzy fallback: substring match (handles "Radio Scoop Lyon" → "Radio Scoop")
    if (!radioId) {
      for (const r of allRadiosList) {
        const dbName = r.nom.toLowerCase().trim();
        if (dbName.includes(normalizedName) || normalizedName.includes(dbName)) {
          radioId = r.id;
          fuzzyMatched++;
          await logger.debug('ARCOM_ENRICH', `Fuzzy match: Arcom "${entry.radio_nom}" → DB "${r.nom}" (${r.id.slice(0, 8)})`);
          break;
        }
      }
    }

    if (!radioId) {
      notFound++;
      if (!notFoundNames.includes(entry.radio_nom)) {
        notFoundNames.push(entry.radio_nom);
      }
      continue;
    }

    matched++;

    if (!existingDeptIndex.has(entry.departement)) {
      existingDeptIndex.set(entry.departement, new Set());
    }

    const deptSet = existingDeptIndex.get(entry.departement)!;
    if (!deptSet.has(radioId)) {
      deptSet.add(radioId);
      enriched++;
      await logger.debug('ARCOM_ENRICH', `Dept ${entry.departement}: "${entry.radio_nom}" → ${radioId.slice(0, 8)} ✓ (nouveau)`);
    }
  }

  await logger.info('ARCOM_ENRICH', `${enriched} nouvelles entrées dept→radio ajoutées (${matched} matchés, ${fuzzyMatched} fuzzy, ${notFound} non trouvés en base)`);
  if (notFoundNames.length > 0) {
    // Log up to 30 unmatched names for diagnosis
    const display = notFoundNames.slice(0, 30).join(', ');
    const more = notFoundNames.length > 30 ? ` ... +${notFoundNames.length - 30} autres` : '';
    await logger.warn('ARCOM_ENRICH', `Radios Arcom NON trouvées en base (${notFoundNames.length}) : ${display}${more}`);
  }
  return enriched;
}
