/**
 * geo-resolver.ts — Résolveur géographique universel
 *
 * Utilise l'API Geo data.gouv.fr (gratuite, pas de clé API) pour résoudre
 * N'IMPORTE QUELLE commune, département ou région de France en bbox/geometry.
 *
 * APIs utilisées :
 * - Communes    : https://geo.api.gouv.fr/communes?nom=...&fields=contour,centre&boost=population&limit=5
 * - Départements: https://geo.api.gouv.fr/departements/{code}?fields=contour
 * - Régions     : https://geo.api.gouv.fr/regions/{code}?fields=contour
 * - Adresse BAN : https://api-adresse.data.gouv.fr/search/?type=municipality  (fallback)
 *
 * Cache mémoire 30 min, max 500 entrées.
 */

const GEO_API_BASE = 'https://geo.api.gouv.fr';
const BAN_API_BASE = 'https://api-adresse.data.gouv.fr';

// ── Cache mémoire ──────────────────────────────────────────────────────────────

interface CacheEntry {
  bbox:      [number, number, number, number];
  contour:   GeoContour | null;
  centre:    [number, number]; // [lng, lat] GeoJSON order
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

function getCached(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry;
}

function setCache(key: string, entry: Omit<CacheEntry, 'timestamp'>): void {
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { ...entry, timestamp: Date.now() });
}

// ── Types internes ─────────────────────────────────────────────────────────────

type GeoContour = { type: 'Polygon'; coordinates: number[][][] }
                | { type: 'MultiPolygon'; coordinates: number[][][][] };

interface GeoApiCommune {
  nom:              string;
  code:             string;
  codeDepartement?: string;
  codeRegion?:      string;
  population?:      number;
  centre?:          { type: 'Point'; coordinates: [number, number] };
  contour?:         GeoContour;
}

interface GeoApiDepartement {
  nom:     string;
  code:    string;
  contour?: GeoContour;
}

interface GeoApiRegion {
  nom:     string;
  code:    string;
  contour?: GeoContour;
}

// ── Aliases noms courants → codes ──────────────────────────────────────────────

const DEPARTEMENT_ALIASES: Record<string, string> = {
  'finistère': '29', 'finistere': '29',
  "côtes-d'armor": '22', "cotes d'armor": '22', 'cotes-d-armor': '22',
  'morbihan': '56',
  'ille-et-vilaine': '35', 'ille et vilaine': '35',
  'nord': '59',
  'pas-de-calais': '62', 'pas de calais': '62',
  'bouches-du-rhône': '13', 'bouches du rhone': '13', 'bouches-du-rhone': '13',
  'rhône': '69', 'rhone': '69',
  'gironde': '33',
  'haute-garonne': '31', 'haute garonne': '31',
  'hérault': '34', 'herault': '34',
  'loire-atlantique': '44', 'loire atlantique': '44',
  'bas-rhin': '67', 'bas rhin': '67',
  'haut-rhin': '68', 'haut rhin': '68',
  'seine-saint-denis': '93', 'seine saint denis': '93',
  'hauts-de-seine': '92', 'hauts de seine': '92',
  'val-de-marne': '94', 'val de marne': '94',
  'essonne': '91', 'yvelines': '78',
  "val-d'oise": '95', "val d'oise": '95', 'val-d-oise': '95',
  'seine-et-marne': '77', 'seine et marne': '77',
  'paris': '75',
  'alpes-maritimes': '06', 'alpes maritimes': '06',
  'var': '83',
  'isère': '38', 'isere': '38',
  'puy-de-dôme': '63', 'puy de dome': '63', 'puy-de-dome': '63',
  'maine-et-loire': '49', 'maine et loire': '49',
  'vendée': '85', 'vendee': '85',
  'calvados': '14',
  'seine-maritime': '76', 'seine maritime': '76',
  'moselle': '57', 'meurthe-et-moselle': '54', 'meurthe et moselle': '54',
  'doubs': '25', 'savoie': '73',
  'haute-savoie': '74', 'haute savoie': '74',
  'ain': '01', 'drôme': '26', 'drome': '26', 'ardèche': '07', 'ardeche': '07',
  'loire': '42',
  'charente-maritime': '17', 'charente maritime': '17', 'charente': '16',
  'vienne': '86', 'haute-vienne': '87', 'haute vienne': '87',
  'dordogne': '24', 'lot-et-garonne': '47', 'lot et garonne': '47',
  'landes': '40',
  'pyrénées-atlantiques': '64', 'pyrenees atlantiques': '64', 'pyrenees-atlantiques': '64',
  'hautes-pyrénées': '65', 'hautes pyrenees': '65',
  'gers': '32', 'tarn': '81', 'tarn-et-garonne': '82', 'tarn et garonne': '82',
  'aveyron': '12', 'lot': '46', 'cantal': '15',
  'corrèze': '19', 'correze': '19', 'creuse': '23', 'allier': '03',
  'haute-loire': '43', 'haute loire': '43',
  'aude': '11',
  'pyrénées-orientales': '66', 'pyrenees orientales': '66', 'pyrenees-orientales': '66',
  'ariège': '09', 'ariege': '09', 'gard': '30', 'lozère': '48', 'lozere': '48',
  'vaucluse': '84',
  "côte-d'or": '21', "cote d'or": '21', 'cote-d-or': '21',
  'saône-et-loire': '71', 'saone et loire': '71', 'saone-et-loire': '71',
  'nièvre': '58', 'nievre': '58', 'yonne': '89', 'jura': '39',
  'haute-saône': '70', 'haute saone': '70',
  'territoire de belfort': '90', 'somme': '80', 'oise': '60', 'aisne': '02',
  'eure': '27', 'eure-et-loir': '28', 'eure et loir': '28',
  'loiret': '45', 'loir-et-cher': '41', 'loir et cher': '41',
  'indre-et-loire': '37', 'indre et loire': '37', 'indre': '36', 'cher': '18',
  'sarthe': '72', 'mayenne': '53', 'manche': '50', 'orne': '61',
  'marne': '51', 'haute-marne': '52', 'haute marne': '52',
  'aube': '10', 'ardennes': '08', 'meuse': '55', 'vosges': '88',
  'corse-du-sud': '2A', 'corse du sud': '2A',
  'haute-corse': '2B', 'haute corse': '2B',
};

const REGION_ALIASES: Record<string, string> = {
  'bretagne': '53',
  'île-de-france': '11', 'ile-de-france': '11', 'ile de france': '11', 'idf': '11',
  'occitanie': '76',
  'nouvelle-aquitaine': '75', 'nouvelle aquitaine': '75',
  'auvergne-rhône-alpes': '84', 'auvergne rhone alpes': '84', 'ara': '84',
  'hauts-de-france': '32', 'hauts de france': '32', 'hdf': '32',
  'grand est': '44',
  "provence-alpes-côte d'azur": '93', 'paca': '93', 'provence': '93',
  'pays de la loire': '52', 'pdl': '52',
  'normandie': '28',
  'bourgogne-franche-comté': '27', 'bourgogne franche comte': '27', 'bfc': '27',
  'centre-val de loire': '24', 'centre': '24', 'cvl': '24',
  'corse': '94',
};

// ── Résolveur : Commune ────────────────────────────────────────────────────────

async function resolveCommune(name: string): Promise<CacheEntry | null> {
  const key = `commune:${name.toLowerCase().trim()}`;
  const cached = getCached(key);
  if (cached) return cached;

  let cleanName = name.trim();
  cleanName = cleanName.replace(/\s+\d+(e|er|ème|eme)?$/i, '').trim();
  cleanName = cleanName.replace(/\s*(métropole|metropole|agglomération|agglomeration|cedex)\s*/gi, '').trim();

  try {
    const url = `${GEO_API_BASE}/communes?nom=${encodeURIComponent(cleanName)}&fields=nom,code,centre,contour,population&boost=population&limit=5`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;

    const communes = await resp.json() as GeoApiCommune[];
    if (!communes || communes.length === 0) return null;

    const best = findBestMatch(communes, cleanName);
    if (!best || !best.centre) return null;

    const centre = best.centre.coordinates as [number, number];
    const bbox: [number, number, number, number] = best.contour
      ? computeBboxFromGeometry(best.contour)
      : [centre[0] - 0.03, centre[1] - 0.025, centre[0] + 0.03, centre[1] + 0.025];

    const entry: Omit<CacheEntry, 'timestamp'> = { bbox, contour: best.contour ?? null, centre };
    setCache(key, entry);
    return { ...entry, timestamp: Date.now() };
  } catch (e: unknown) {
    console.warn(`[geo-resolver] commune "${name}":`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Résolveur : Département ────────────────────────────────────────────────────

async function resolveDepartement(input: string): Promise<CacheEntry | null> {
  const normalized = input.toLowerCase().trim();
  const key = `dept:${normalized}`;
  const cached = getCached(key);
  if (cached) return cached;

  let code = /^\d{2,3}[ab]?$/i.test(normalized)
    ? normalized
    : DEPARTEMENT_ALIASES[normalized] ?? '';

  if (!code) {
    try {
      const url = `${GEO_API_BASE}/departements?nom=${encodeURIComponent(input)}&limit=1`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const depts = await resp.json() as GeoApiDepartement[];
        if (depts?.[0]) code = depts[0].code;
      }
    } catch { /* ignore */ }
  }

  if (!code) return null;

  try {
    const url = `${GEO_API_BASE}/departements/${encodeURIComponent(code)}?fields=nom,code,contour`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;

    const dept = await resp.json() as GeoApiDepartement;
    if (!dept.contour) return null;

    const bbox   = computeBboxFromGeometry(dept.contour);
    const centre = computeCentreFromBbox(bbox);
    const entry: Omit<CacheEntry, 'timestamp'> = { bbox, contour: dept.contour, centre };
    setCache(key, entry);
    return { ...entry, timestamp: Date.now() };
  } catch (e: unknown) {
    console.warn(`[geo-resolver] département "${input}":`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Résolveur : Région ─────────────────────────────────────────────────────────

async function resolveRegion(input: string): Promise<CacheEntry | null> {
  const normalized = input.toLowerCase().trim();
  const key = `region:${normalized}`;
  const cached = getCached(key);
  if (cached) return cached;

  let code = /^\d{2}$/.test(normalized)
    ? normalized
    : REGION_ALIASES[normalized] ?? '';

  if (!code) {
    try {
      const url = `${GEO_API_BASE}/regions?nom=${encodeURIComponent(input)}&limit=1`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const regions = await resp.json() as GeoApiRegion[];
        if (regions?.[0]) code = regions[0].code;
      }
    } catch { /* ignore */ }
  }

  if (!code) return null;

  try {
    const url = `${GEO_API_BASE}/regions/${encodeURIComponent(code)}?fields=nom,code,contour`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;

    const region = await resp.json() as GeoApiRegion;
    if (!region.contour) return null;

    const bbox   = computeBboxFromGeometry(region.contour);
    const centre = computeCentreFromBbox(bbox);
    const entry: Omit<CacheEntry, 'timestamp'> = { bbox, contour: region.contour, centre };
    setCache(key, entry);
    return { ...entry, timestamp: Date.now() };
  } catch (e: unknown) {
    console.warn(`[geo-resolver] région "${input}":`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Résolveur : texte libre (cascade) ─────────────────────────────────────────

async function resolveFreeText(text: string): Promise<CacheEntry | null> {
  const key = `free:${text.toLowerCase().trim()}`;
  const cached = getCached(key);
  if (cached) return cached;

  const communeResult = await resolveCommune(text);
  if (communeResult) return communeResult;

  const deptResult = await resolveDepartement(text);
  if (deptResult) return deptResult;

  const regionResult = await resolveRegion(text);
  if (regionResult) return regionResult;

  // Dernier recours : BAN
  try {
    const url = `${BAN_API_BASE}/search/?q=${encodeURIComponent(text)}&type=municipality&limit=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;

    const data = await resp.json() as {
      features: Array<{
        geometry:   { coordinates: [number, number] };
        properties: { city: string; citycode: string };
      }>;
    };

    if (!data.features?.[0]) return null;

    const [lng, lat] = data.features[0].geometry.coordinates;
    const citycode   = data.features[0].properties.citycode;

    if (citycode) {
      try {
        const communeUrl = `${GEO_API_BASE}/communes/${citycode}?fields=contour,centre`;
        const communeResp = await fetch(communeUrl, { signal: AbortSignal.timeout(3000) });
        if (communeResp.ok) {
          const commune = await communeResp.json() as GeoApiCommune;
          if (commune.contour) {
            const bbox = computeBboxFromGeometry(commune.contour);
            const entry: Omit<CacheEntry, 'timestamp'> = { bbox, contour: commune.contour, centre: [lng, lat] };
            setCache(key, entry);
            return { ...entry, timestamp: Date.now() };
          }
        }
      } catch { /* ignore */ }
    }

    const bbox: [number, number, number, number] = [lng - 0.05, lat - 0.04, lng + 0.05, lat + 0.04];
    const entry: Omit<CacheEntry, 'timestamp'> = { bbox, contour: null, centre: [lng, lat] };
    setCache(key, entry);
    return { ...entry, timestamp: Date.now() };
  } catch (e: unknown) {
    console.warn(`[geo-resolver] texte libre "${text}":`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── EXPORTS PUBLICS ────────────────────────────────────────────────────────────

const FRANCE_BBOX:   [number, number, number, number] = [-5.5, 41.3, 9.6, 51.1];
const FRANCE_CENTRE: [number, number]                 = [2.3, 46.6];

export interface ZoneResolution {
  bbox:     number[] | null;
  geometry: Record<string, unknown> | null;
  centre:   [number, number] | null; // [lng, lat] GeoJSON order
  source:   string;
}

/**
 * Résout n'importe quel type de zone géographique → bbox + contour + centre.
 * Rétrocompatible : bbox et geometry gardent le même comportement.
 */
export async function resolveZoneToBbox(
  zone?: { type: string; value: string | number[] },
): Promise<ZoneResolution> {
  if (!zone) {
    return { bbox: FRANCE_BBOX, geometry: null, centre: FRANCE_CENTRE, source: 'default_france' };
  }

  switch (zone.type) {
    case 'bbox': {
      const bbox = zone.value as number[];
      return { bbox, geometry: null, centre: computeCentreFromBbox(bbox as [number, number, number, number]), source: 'bbox_direct' };
    }

    case 'city': {
      const result = await resolveCommune(zone.value as string)
        ?? await resolveFreeText(zone.value as string);
      if (result) {
        return {
          bbox:     result.bbox,
          geometry: result.contour as unknown as Record<string, unknown> | null,
          centre:   result.centre,
          source:   result.contour ? 'geo_api_commune' : 'ban_fallback',
        };
      }
      return { bbox: FRANCE_BBOX, geometry: null, centre: FRANCE_CENTRE, source: 'fallback_france' };
    }

    case 'department': {
      const result = await resolveDepartement(zone.value as string);
      if (result) {
        return {
          bbox:     result.bbox,
          geometry: result.contour as unknown as Record<string, unknown> | null,
          centre:   result.centre,
          source:   'geo_api_departement',
        };
      }
      return { bbox: FRANCE_BBOX, geometry: null, centre: FRANCE_CENTRE, source: 'fallback_france' };
    }

    case 'region': {
      const result = await resolveRegion(zone.value as string);
      if (result) {
        return {
          bbox:     result.bbox,
          geometry: result.contour as unknown as Record<string, unknown> | null,
          centre:   result.centre,
          source:   'geo_api_region',
        };
      }
      return { bbox: FRANCE_BBOX, geometry: null, centre: FRANCE_CENTRE, source: 'fallback_france' };
    }

    case 'polygon': {
      const geom = zone.value as unknown as Record<string, unknown>;
      const bbox  = computeBboxFromGeometry(geom as unknown as GeoContour);
      return { bbox, geometry: geom, centre: computeCentreFromBbox(bbox), source: 'polygon_direct' };
    }

    default: {
      if (typeof zone.value === 'string') {
        const result = await resolveFreeText(zone.value);
        if (result) {
          return {
            bbox:     result.bbox,
            geometry: result.contour as unknown as Record<string, unknown> | null,
            centre:   result.centre,
            source:   'freetext_fallback',
          };
        }
      }
      return { bbox: FRANCE_BBOX, geometry: null, centre: FRANCE_CENTRE, source: 'fallback_france' };
    }
  }
}

/**
 * Helper rapide — centre d'une ville (pour marqueurs carte).
 * Retourne [lng, lat] en ordre GeoJSON, ou null si non trouvé.
 */
export async function resolveCityCenter(name: string): Promise<[number, number] | null> {
  if (!name || name.toLowerCase() === 'france') return FRANCE_CENTRE;
  const result = await resolveCommune(name) ?? await resolveFreeText(name);
  return result?.centre ?? null;
}

// ── Helpers géométriques ───────────────────────────────────────────────────────

function computeBboxFromGeometry(geom: GeoContour): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function computeCentreFromBbox(bbox: [number, number, number, number]): [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function findBestMatch(communes: GeoApiCommune[], searchName: string): GeoApiCommune | null {
  if (communes.length === 0) return null;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const target = norm(searchName);
  for (const c of communes) { if (norm(c.nom) === target) return c; }
  for (const c of communes) {
    const n = norm(c.nom);
    if (n.startsWith(target) || target.startsWith(n)) return c;
  }
  return communes[0];
}
