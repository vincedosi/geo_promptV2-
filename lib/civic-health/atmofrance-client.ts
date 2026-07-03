/**
 * Client REST Atmo Data v2 (https://admindata.atmo-france.org).
 *
 * Auth : POST /api/login {username, password} → JWT Bearer (TTL ~1h).
 * Le token est gardé en mémoire (module-level) avec TTL 30min côté client.
 *
 * Endpoints :
 *   GET /api/data/112/{filter_json}?withGeom=false → indice ATMO
 *   GET /api/data/122/{filter_json}?withGeom=false → indice pollen
 *
 * filter_json JSON-encodé puis URI-encodé :
 *   {"code_zone":{"operator":"=","value":"75056"},
 *    "date_ech":{"operator":">=","value":"2026-05-05"}}
 *
 * Réponse : GeoJSON FeatureCollection. Les properties pertinentes :
 *   ATMO  → code_qual (1-6), code_no2/o3/pm10/pm25/so2, date_ech, lib_zone, date_maj
 *   Pollen → code_qual (0-6), code_ambr/arm/aul/boul/gram/oliv, date_ech, lib_zone
 */
import type {
  AirIndicator,
  HealthIndicator,
  HealthProvider,
  PollenBulkEntry,
  PollenIndicator,
  PollenLevel,
  PollenSpecies,
} from './types';
import { atmoQualificatif, parseAtmoLevel, parsePollenLevel } from './levels';

const BASE_URL = 'https://admindata.atmo-france.org';
const AUTH_URL = `${BASE_URL}/api/login`;
const DATA_URL = `${BASE_URL}/api/data`;
const DATA_ID_ATMO = 112;
const DATA_ID_POLLEN = 122;

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30min, par sécurité (token Atmo valide 1h)
const REQUEST_TIMEOUT_MS = 15_000;

type CachedToken = { token: string; expiresAt: number };
let tokenCache: CachedToken | null = null;

interface AtmoFeatureProps {
  code_zone?: string;
  lib_zone?: string;
  date_ech?: string;
  date_maj?: string;
  source?: string;
  type_zone?: string;
  aasqa?: string | number;
  // ATMO
  code_qual?: number | string;
  code_no2?: number | string;
  code_o3?: number | string;
  code_pm10?: number | string;
  code_pm25?: number | string;
  code_so2?: number | string;
  // Pollen
  code_ambr?: number | string;
  code_arm?: number | string;
  code_aul?: number | string;
  code_boul?: number | string;
  code_gram?: number | string;
  code_oliv?: number | string;
}

interface AtmoFeatureCollection {
  type?: string;
  features?: Array<{ properties?: AtmoFeatureProps }>;
}

function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

async function login(username: string, password: string): Promise<string> {
  const res = await fetchWithTimeout(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') ?? '60';
    throw new Error(`atmo_rate_limited:${retryAfter}`);
  }
  if (!res.ok) {
    throw new Error(`atmo_login_failed:${res.status}`);
  }
  const json = (await res.json()) as { token?: string };
  if (!json.token) throw new Error('atmo_login_no_token');
  return json.token;
}

async function getValidToken(username: string, password: string): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }
  const token = await login(username, password);
  tokenCache = { token, expiresAt: now + TOKEN_TTL_MS };
  return token;
}

/** Réinitialise le cache de token (utile pour les tests). */
export function _resetTokenCache(): void {
  tokenCache = null;
}

/** Clause de filtre Atmo Data : {champ: {operator, value}} JSON puis URI-encodé. */
type AtmoFilter = Record<string, { operator: string; value: string | number }>;

function encodeFilter(filter: AtmoFilter): string {
  return encodeURIComponent(JSON.stringify(filter));
}

function buildFilter(codeInsee: string, sinceDate: string): string {
  return encodeFilter({
    code_zone: { operator: '=', value: codeInsee },
    date_ech: { operator: '>=', value: sinceDate },
  });
}

async function fetchDataset(
  datasetId: number,
  codeInsee: string,
  token: string,
): Promise<AtmoFeatureProps[]> {
  const filter = buildFilter(codeInsee, todayIso(0));
  const url = `${DATA_URL}/${datasetId}/${filter}?withGeom=false`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401) {
    tokenCache = null;
    throw new Error('atmo_unauthorized');
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') ?? '60';
    throw new Error(`atmo_rate_limited:${retryAfter}`);
  }
  if (!res.ok) {
    throw new Error(`atmo_data_failed:${datasetId}:${res.status}`);
  }
  const json = (await res.json()) as AtmoFeatureCollection;
  const features = json?.features ?? [];
  return features
    .map(f => f.properties)
    .filter((p): p is AtmoFeatureProps => !!p);
}

/**
 * Requête bas niveau avec filtre arbitraire — sert au bulk national (carte
 * des allergènes) et au script de diagnostic scripts/test_atmo_bulk.ts.
 * Timeout élargi : une réponse France entière peut peser plusieurs Mo.
 */
export async function fetchDatasetRaw(
  datasetId: number,
  filter: AtmoFilter,
  token: string,
  timeoutMs = 60_000,
): Promise<AtmoFeatureProps[]> {
  const url = `${DATA_URL}/${datasetId}/${encodeFilter(filter)}?withGeom=false`;
  const res = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    timeoutMs,
  );
  if (res.status === 401) {
    tokenCache = null;
    throw new Error('atmo_unauthorized');
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') ?? '60';
    throw new Error(`atmo_rate_limited:${retryAfter}`);
  }
  if (!res.ok) {
    throw new Error(`atmo_data_failed:${datasetId}:${res.status}`);
  }
  const json = (await res.json()) as AtmoFeatureCollection;
  return (json?.features ?? [])
    .map(f => f.properties)
    .filter((p): p is AtmoFeatureProps => !!p);
}

/** Login avec les creds env — pour le script de diagnostic uniquement. */
export async function loginWithEnv(): Promise<string> {
  const username = process.env.ATMO_FRANCE_USERNAME;
  const password = process.env.ATMO_FRANCE_PASSWORD;
  if (!username || !password) throw new Error('atmofrance_missing_env_creds');
  return getValidToken(username, password);
}

/**
 * Codes région INSEE des AASQA métropole + DROM — stratégie de repli du bulk
 * quand la requête France entière est refusée/tronquée par l'API.
 */
export const AASQA_REGION_CODES = [
  '11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94',
  '01', '02', '03', '04', '06',
] as const;

function pickByDate(features: AtmoFeatureProps[], date: string): AtmoFeatureProps | null {
  return features.find(f => f.date_ech === date) ?? null;
}

function buildAir(features: AtmoFeatureProps[]): AirIndicator | null {
  const j = pickByDate(features, todayIso(0));
  if (!j) return null;
  const indice = parseAtmoLevel(j.code_qual);
  if (!indice) return null;
  const j1 = pickByDate(features, todayIso(1));
  const j1Indice = j1 ? parseAtmoLevel(j1.code_qual) : null;
  return {
    date: j.date_ech ?? todayIso(0),
    indice,
    qualificatif: atmoQualificatif(indice),
    sous_indices: {
      pm10: parseAtmoLevel(j.code_pm10),
      pm25: parseAtmoLevel(j.code_pm25),
      no2: parseAtmoLevel(j.code_no2),
      o3: parseAtmoLevel(j.code_o3),
      so2: parseAtmoLevel(j.code_so2),
    },
    ...(j1Indice
      ? { previsionJ1: { indice: j1Indice, qualificatif: atmoQualificatif(j1Indice) } }
      : {}),
  };
}

function buildPollen(features: AtmoFeatureProps[]): PollenIndicator | null {
  const j = pickByDate(features, todayIso(0));
  if (!j) return null;
  const indice_global = parsePollenLevel(j.code_qual);
  if (indice_global == null) return null;

  const especesMap: Record<PollenSpecies, PollenLevel> = {
    ambroisie: parsePollenLevel(j.code_ambr) ?? 0,
    armoise: parsePollenLevel(j.code_arm) ?? 0,
    aulne: parsePollenLevel(j.code_aul) ?? 0,
    bouleau: parsePollenLevel(j.code_boul) ?? 0,
    graminees: parsePollenLevel(j.code_gram) ?? 0,
    olivier: parsePollenLevel(j.code_oliv) ?? 0,
  };

  const j1 = pickByDate(features, todayIso(1));
  const j2 = pickByDate(features, todayIso(2));
  const j1Indice = j1 ? parsePollenLevel(j1.code_qual) : null;
  const j2Indice = j2 ? parsePollenLevel(j2.code_qual) : null;

  return {
    date: j.date_ech ?? todayIso(0),
    indice_global,
    especes: especesMap,
    ...(j1Indice != null ? { previsionJ1: { indice: j1Indice } } : {}),
    ...(j2Indice != null ? { previsionJ2: { indice: j2Indice } } : {}),
  };
}

/** Convertit une ligne pollen brute en entrée bulk (jour J uniquement). */
function pollenEntryFromProps(p: AtmoFeatureProps): PollenBulkEntry | null {
  const indice_global = parsePollenLevel(p.code_qual);
  if (indice_global == null) return null;
  return {
    indice_global,
    especes: {
      ambroisie: parsePollenLevel(p.code_ambr) ?? 0,
      armoise: parsePollenLevel(p.code_arm) ?? 0,
      aulne: parsePollenLevel(p.code_aul) ?? 0,
      bouleau: parsePollenLevel(p.code_boul) ?? 0,
      graminees: parsePollenLevel(p.code_gram) ?? 0,
      olivier: parsePollenLevel(p.code_oliv) ?? 0,
    },
  };
}

/** Agrège des features pollen (1 ligne/commune/date) en Map commune → entrée du jour. */
function collectPollenByCommune(
  features: AtmoFeatureProps[],
  target: Map<string, PollenBulkEntry>,
): void {
  const today = todayIso(0);
  for (const p of features) {
    if (p.date_ech !== today || !p.code_zone) continue;
    const entry = pollenEntryFromProps(p);
    if (entry) target.set(String(p.code_zone).toUpperCase(), entry);
  }
}

/**
 * Seuil de vraisemblance d'une réponse France entière : en dessous, on
 * considère que l'API a tronqué ou ignoré la requête sans code_zone et on
 * bascule sur la stratégie par AASQA.
 */
const BULK_MIN_COMMUNES = 2_000;

export class AtmoFranceProvider implements HealthProvider {
  readonly name = 'atmofrance' as const;
  private readonly username: string;
  private readonly password: string;

  constructor(username: string, password: string) {
    if (!username || !password) {
      throw new Error('atmofrance_provider_missing_creds');
    }
    this.username = username;
    this.password = password;
  }

  async fetchHealth(codeInsee: string): Promise<HealthIndicator | null> {
    if (!codeInsee) return null;
    const token = await getValidToken(this.username, this.password);

    const [airFeatures, pollenFeatures] = await Promise.all([
      fetchDataset(DATA_ID_ATMO, codeInsee, token).catch(err => {
        console.warn('[atmofrance] ATMO fetch failed', err);
        return [] as AtmoFeatureProps[];
      }),
      fetchDataset(DATA_ID_POLLEN, codeInsee, token).catch(err => {
        console.warn('[atmofrance] Pollen fetch failed', err);
        return [] as AtmoFeatureProps[];
      }),
    ]);

    const air = buildAir(airFeatures);
    const pollen = buildPollen(pollenFeatures);
    if (!air && !pollen) return null;

    const commune =
      airFeatures[0]?.lib_zone ||
      pollenFeatures[0]?.lib_zone ||
      `Commune ${codeInsee}`;

    return {
      code_insee: codeInsee,
      commune,
      air,
      pollen,
      fetchedAt: new Date().toISOString(),
      source: 'Atmo France et AASQA',
      stale: false,
    };
  }

  /**
   * Bulk national pollen (dataset 122) en deux stratégies :
   *   A. filtre date seule (France entière, 1 appel) — validé si la réponse
   *      couvre au moins BULK_MIN_COMMUNES communes ;
   *   B. repli : 1 appel par AASQA (18 régions, séquentiel — respecte le
   *      rate limit Atmo).
   * Renvoie null si les deux échouent : l'appelant garde l'échantillonnage.
   */
  async fetchPollenBulk(
    _communeCodes: string[],
    onLog?: (message: string) => void,
  ): Promise<Map<string, PollenBulkEntry> | null> {
    const token = await getValidToken(this.username, this.password);
    const today = todayIso(0);
    const byCommune = new Map<string, PollenBulkEntry>();

    // Stratégie A — France entière, filtre date seule
    try {
      onLog?.('Requête bulk France entière (filtre date seule)…');
      const features = await fetchDatasetRaw(
        DATA_ID_POLLEN,
        { date_ech: { operator: '=', value: today } },
        token,
      );
      collectPollenByCommune(features, byCommune);
      onLog?.(`Bulk France : ${features.length} lignes → ${byCommune.size} communes (jour J)`);
      if (byCommune.size >= BULK_MIN_COMMUNES) return byCommune;
      onLog?.(`Réponse sous le seuil de vraisemblance (${BULK_MIN_COMMUNES}) — repli par AASQA`);
    } catch (err) {
      onLog?.(`Bulk France refusé (${err instanceof Error ? err.message : 'erreur'}) — repli par AASQA`);
    }

    // Stratégie B — par AASQA (séquentiel)
    byCommune.clear();
    let okRegions = 0;
    for (const aasqa of AASQA_REGION_CODES) {
      try {
        const features = await fetchDatasetRaw(
          DATA_ID_POLLEN,
          {
            aasqa: { operator: '=', value: aasqa },
            date_ech: { operator: '=', value: today },
          },
          token,
        );
        collectPollenByCommune(features, byCommune);
        okRegions++;
        onLog?.(`AASQA ${aasqa} : ${features.length} lignes (cumul ${byCommune.size} communes)`);
      } catch (err) {
        onLog?.(`AASQA ${aasqa} en échec (${err instanceof Error ? err.message : 'erreur'})`);
      }
    }
    if (okRegions === 0 || byCommune.size === 0) {
      onLog?.('Bulk indisponible sur les deux stratégies — repli échantillonnage.');
      return null;
    }
    return byCommune;
  }
}
