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
/** Decode common HTML entities in radio names from Arcom pages */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç')
    .replace(/&ocirc;/g, 'ô')
    .replace(/&ucirc;/g, 'û')
    .replace(/&icirc;/g, 'î')
    .replace(/&euml;/g, 'ë')
    .replace(/&ouml;/g, 'ö')
    .replace(/&uuml;/g, 'ü')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function parseArcomPage(html: string): string[] {
  const radioNames: string[] = [];
  const normalized = html.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');

  // Match the Arcom HTML structure: <a ...stretched-link">  Name  <span...>type</span> </a>
  const regex = /class="[^"]*stretched-link[^"]*"[^>]*>\s*([^<]+?)\s*<span[^>]*>\s*((?:DAB\+|FM)[\s·]*(?:DAB\+|FM)?)\s*<\/span>/gi;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const name = decodeHtmlEntities(match[1].trim());
    if (name.length >= 2 && name.length < 80) {
      radioNames.push(name);
    }
  }

  // Fallback: look for bk-radio-station-list__item pattern
  if (radioNames.length === 0) {
    const fallback = /bk-radio-station-list__item[^>]*>.*?<a[^>]*>\s*([^<]+?)\s*<span/gi;
    while ((match = fallback.exec(normalized)) !== null) {
      const name = decodeHtmlEntities(match[1].trim());
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
// Max depts a cat A/B radio can reasonably appear in.
// Arcom pages sometimes return radios from the wrong city (bug on arcom.fr).
// Thresholds by portee: locale=10, regionale=20.
const MAX_DEPTS_LOCALE = 10;
const MAX_DEPTS_REGIONALE = 20;

export async function enrichDeptIndexFromArcom(
  supabase: SupabaseClient,
  logger: ImportLogger,
  arcomEntries: ArcomRadioEntry[],
  existingDeptIndex: Map<string, Set<string>>, // dept → Set<radio_id>
): Promise<number> {
  // Load all radios from DB — build exact + fuzzy lookup maps
  const { data: allRadios } = await supabase.from('radios').select('id, nom, categorie_arcom, portee').limit(100000);
  const radioByExactName = new Map<string, string>(); // lowercase nom → id
  const radioInfo = new Map<string, { cat: string | null; portee: string | null }>(); // id → info
  const allRadiosList = allRadios ?? [];
  for (const r of allRadiosList) {
    radioByExactName.set(r.nom.toLowerCase().trim(), r.id);
    radioInfo.set(r.id, { cat: r.categorie_arcom, portee: r.portee });
  }

  // Phase 1: Resolve all Arcom entries to radio IDs
  const resolvedEntries: Array<{ radioId: string; radioNom: string; dept: string }> = [];
  let notFound = 0;
  let fuzzyMatched = 0;
  const notFoundNames: string[] = [];

  for (const entry of arcomEntries) {
    const normalizedName = entry.radio_nom.toLowerCase().trim();

    // Exact match
    let radioId = radioByExactName.get(normalizedName);

    // Fuzzy fallback
    if (!radioId) {
      for (const r of allRadiosList) {
        const dbName = r.nom.toLowerCase().trim();
        if (dbName.includes(normalizedName) || normalizedName.includes(dbName)) {
          radioId = r.id;
          fuzzyMatched++;
          break;
        }
      }
    }

    if (!radioId) {
      notFound++;
      if (!notFoundNames.includes(entry.radio_nom)) notFoundNames.push(entry.radio_nom);
      continue;
    }

    resolvedEntries.push({ radioId, radioNom: entry.radio_nom, dept: entry.departement });
  }

  // Phase 2: Coherence filter — count Arcom depts per radio
  const arcomDeptsByRadio = new Map<string, Set<string>>();
  for (const e of resolvedEntries) {
    if (!arcomDeptsByRadio.has(e.radioId)) arcomDeptsByRadio.set(e.radioId, new Set());
    arcomDeptsByRadio.get(e.radioId)!.add(e.dept);
  }

  // Check which radios are also in the freq-radio index (trusted)
  const freqRadioDepts = new Map<string, Set<string>>();
  for (const [dept, radioIds] of existingDeptIndex) {
    for (const rid of radioIds) {
      if (!freqRadioDepts.has(rid)) freqRadioDepts.set(rid, new Set());
      freqRadioDepts.get(rid)!.add(dept);
    }
  }

  // Phase 3: Add to index with coherence check
  let enriched = 0;
  let filtered = 0;

  for (const e of resolvedEntries) {
    const info = radioInfo.get(e.radioId);
    // Coherence check for local/regional radios (cat A/B)
    const isCatAB = info && (info.cat === 'A' || info.cat === 'B');
    if (isCatAB) {
      const maxDepts = info.portee === 'regionale' ? MAX_DEPTS_REGIONALE : MAX_DEPTS_LOCALE;
      const arcomDepts = arcomDeptsByRadio.get(e.radioId);
      const freqDepts = freqRadioDepts.get(e.radioId);

      if (arcomDepts && arcomDepts.size > maxDepts) {
        // Arcom claims this radio is in too many depts — likely bad data.
        // Only keep depts where freq-radio also found it (trusted).
        if (freqDepts && freqDepts.has(e.dept)) {
          // freq-radio confirms this dept — keep it
        } else {
          // Arcom-only, suspicious — skip
          filtered++;
          continue;
        }
      }
    }

    if (!existingDeptIndex.has(e.dept)) {
      existingDeptIndex.set(e.dept, new Set());
    }

    const deptSet = existingDeptIndex.get(e.dept)!;
    if (!deptSet.has(e.radioId)) {
      deptSet.add(e.radioId);
      enriched++;
    }
  }

  await logger.info('ARCOM_ENRICH', `${enriched} nouvelles entrées dept→radio (+${fuzzyMatched} fuzzy, ${notFound} non trouvés, ${filtered} filtrées coherence)`);
  if (filtered > 0) {
    await logger.warn('ARCOM_ENRICH', `${filtered} entrées filtrées : radios cat A/B dans trop de depts Arcom (locale>${MAX_DEPTS_LOCALE}, regionale>${MAX_DEPTS_REGIONALE})`);
  }
  if (notFoundNames.length > 0) {
    const display = notFoundNames.slice(0, 30).join(', ');
    const more = notFoundNames.length > 30 ? ` ... +${notFoundNames.length - 30} autres` : '';
    await logger.warn('ARCOM_ENRICH', `Radios Arcom NON trouvées en base (${notFoundNames.length}) : ${display}${more}`);
  }
  return enriched;
}
