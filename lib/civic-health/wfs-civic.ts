/**
 * Source bulk SANS authentification : le GeoServer public d'Atmo France
 * (celui qui alimente la carte https://www.atmo-france.org/indiceatmo).
 *
 * Deux couches WFS 2.0, mêmes mécaniques :
 *   ind_pol:ind_national_pol — indice pollen (~35k communes/jour)
 *   ind:ind_atmo             — indice ATMO qualité de l'air (~26,6k communes/jour,
 *                              + ~320 zones EPCI ignorées : pas de mapping commune)
 *
 * Requêtes : CQL_FILTER date_ech='YYYY-MM-DD' (jour J, repli J-1),
 * propertyName sans géométrie (~10 MB / ~2 s), pagination startIndex par
 * sécurité si le serveur plafonne un jour.
 *
 * Vérifié le 2026-07-03 contre le serveur réel — champs identiques aux
 * datasets 122/112 de l'API authentifiée. La couche pollen expose aussi
 * conc_* (grains/m³) et alerte, non stockés pour l'instant.
 *
 * Source : Atmo France et les AASQA — licence ODbL (mention obligatoire UI).
 */
import type { AtmoBulkEntry, AtmoLevel, PollenBulkEntry } from './types';
import { parseAtmoLevel, parsePollenLevel } from './levels';
import { isoDate, fetchWithTimeout, buildEspeces, buildConcentrations } from './utils';

const WFS_URL = process.env.ATMO_WFS_URL ?? 'https://data.atmo-france.org/geoserver/ows';
const PAGE_SIZE = 40_000;
const REQUEST_TIMEOUT_MS = 90_000;
/** En dessous, la réponse n'est pas une couverture France plausible. */
const MIN_PLAUSIBLE_COMMUNES = 1_000;

interface WfsProps {
  code_zone?: string;
  code_qual?: number;
  // Pollen — niveaux 0-6
  code_aul?: number;
  code_boul?: number;
  code_oliv?: number;
  code_gram?: number;
  code_arm?: number;
  code_ambr?: number;
  // Pollen — concentrations grains/m³ + alerte
  conc_aul?: number;
  conc_boul?: number;
  conc_oliv?: number;
  conc_gram?: number;
  conc_arm?: number;
  conc_ambr?: number;
  alerte?: boolean;
  // ATMO
  code_no2?: number;
  code_o3?: number;
  code_pm10?: number;
  code_pm25?: number;
  code_so2?: number;
}

interface WfsFeatureCollection {
  features?: Array<{ properties?: WfsProps }>;
  numberMatched?: number;
  numberReturned?: number;
}

function buildUrl(layer: string, propertyName: string, date: string, startIndex: number): string {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: layer,
    outputFormat: 'application/json',
    CQL_FILTER: `date_ech='${date}'`,
    propertyName,
    count: String(PAGE_SIZE),
    startIndex: String(startIndex),
    sortBy: 'code_zone', // pagination stable
  });
  return `${WFS_URL}?${params}`;
}

async function fetchPage(layer: string, propertyName: string, date: string, startIndex: number): Promise<WfsFeatureCollection> {
  const res = await fetchWithTimeout(
    buildUrl(layer, propertyName, date, startIndex),
    { headers: { Accept: 'application/json' } },
    REQUEST_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`wfs_http_${res.status}`);
  return (await res.json()) as WfsFeatureCollection;
}

/**
 * Boucle générique jour J → J-1 avec pagination et seuil de vraisemblance.
 * Renvoie null si le WFS est indisponible — l'appelant retombe sur le
 * provider authentifié/mock.
 */
async function fetchBulkWfs<T>(
  layer: string,
  propertyName: string,
  collect: (json: WfsFeatureCollection, target: Map<string, T>) => number,
  label: string,
  onLog?: (message: string) => void,
): Promise<{ byCommune: Map<string, T>; date: string } | null> {
  for (const offset of [0, -1]) {
    const date = isoDate(offset);
    const byCommune = new Map<string, T>();
    try {
      onLog?.(`WFS public Atmo (${label}) : requête France entière pour le ${date}…`);
      for (let startIndex = 0; ; startIndex += PAGE_SIZE) {
        const page = await fetchPage(layer, propertyName, date, startIndex);
        const added = collect(page, byCommune);
        onLog?.(`WFS ${label} ${date} : +${added} communes (cumul ${byCommune.size})`);
        const returned = page.numberReturned ?? page.features?.length ?? 0;
        if (returned < PAGE_SIZE) break;
      }
      if (byCommune.size >= MIN_PLAUSIBLE_COMMUNES) {
        return { byCommune, date };
      }
      onLog?.(`WFS ${label} ${date} : couverture implausible (${byCommune.size} communes) — essai date suivante`);
    } catch (err) {
      onLog?.(`WFS ${label} ${date} en échec (${err instanceof Error ? err.message : 'erreur'})`);
    }
  }
  onLog?.(`WFS public ${label} indisponible.`);
  return null;
}

// ── Pollen ──────────────────────────────────────────────────────────────────

const POLLEN_LAYER = 'ind_pol:ind_national_pol';
const POLLEN_PROPS = 'code_zone,code_qual,code_aul,code_boul,code_oliv,code_gram,code_arm,code_ambr,'
  + 'conc_aul,conc_boul,conc_oliv,conc_gram,conc_arm,conc_ambr,alerte';

/** Parse une FeatureCollection WFS pollen en Map commune → entrée bulk. Pure — testée. */
export function collectWfsFeatures(
  json: WfsFeatureCollection,
  target: Map<string, PollenBulkEntry>,
): number {
  let added = 0;
  for (const f of json.features ?? []) {
    const p = f.properties;
    if (!p?.code_zone) continue;
    const indice_global = parsePollenLevel(p.code_qual);
    if (indice_global == null) continue;
    target.set(String(p.code_zone).toUpperCase(), {
      indice_global,
      especes: buildEspeces(p),
      concentrations: buildConcentrations(p),
      alerte: p.alerte === true,
    });
    added++;
  }
  return added;
}

/** Indice pollen de toutes les communes pour le jour J (repli J-1). */
export function fetchPollenBulkWfs(
  onLog?: (message: string) => void,
): Promise<{ byCommune: Map<string, PollenBulkEntry>; date: string } | null> {
  return fetchBulkWfs(POLLEN_LAYER, POLLEN_PROPS, collectWfsFeatures, 'pollen', onLog);
}

// ── ATMO (qualité de l'air) ─────────────────────────────────────────────────

const ATMO_LAYER = 'ind:ind_atmo';
const ATMO_PROPS = 'code_zone,code_qual,code_no2,code_o3,code_pm10,code_pm25,code_so2';

/** Parse une FeatureCollection WFS ATMO en Map commune → entrée bulk. Pure — testée. */
export function collectWfsAtmoFeatures(
  json: WfsFeatureCollection,
  target: Map<string, AtmoBulkEntry>,
): number {
  let added = 0;
  const lvl = (v: number | undefined): AtmoLevel | 0 => parseAtmoLevel(v) ?? 0;
  for (const f of json.features ?? []) {
    const p = f.properties;
    // Les zones EPCI (code SIREN 9 chiffres) passent ici mais ne matcheront
    // jamais le mapping commune → ignorées naturellement à l'agrégation.
    if (!p?.code_zone) continue;
    const indice_global = parseAtmoLevel(p.code_qual);
    if (indice_global == null) continue;
    target.set(String(p.code_zone).toUpperCase(), {
      indice_global,
      polluants: {
        no2: lvl(p.code_no2),
        o3: lvl(p.code_o3),
        pm10: lvl(p.code_pm10),
        pm25: lvl(p.code_pm25),
        so2: lvl(p.code_so2),
      },
    });
    added++;
  }
  return added;
}

/** Indice ATMO de toutes les communes pour le jour J (repli J-1). */
export function fetchAtmoBulkWfs(
  onLog?: (message: string) => void,
): Promise<{ byCommune: Map<string, AtmoBulkEntry>; date: string } | null> {
  return fetchBulkWfs(ATMO_LAYER, ATMO_PROPS, collectWfsAtmoFeatures, 'air', onLog);
}
