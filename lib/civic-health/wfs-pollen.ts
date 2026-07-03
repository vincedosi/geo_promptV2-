/**
 * Source bulk pollen SANS authentification : le GeoServer public d'Atmo
 * France (celui qui alimente la carte https://www.atmo-france.org/indiceatmo).
 *
 * WFS 2.0 GetFeature sur la couche ind_pol:ind_national_pol :
 *   - CQL_FILTER date_ech='YYYY-MM-DD' (aujourd'hui, repli sur la veille)
 *   - propertyName sans géométrie → ~10 MB / ~35k communes en ~2 s
 *   - pagination startIndex par sécurité (si le serveur plafonne un jour)
 *
 * Vérifié le 2026-07-03 : 34 806 communes pour le jour J, champs identiques
 * au dataset 122 de l'API authentifiée (code_zone INSEE, code_qual global,
 * code_aul/boul/oliv/gram/arm/ambr par espèce — plus conc_* et alerte,
 * non stockés pour l'instant).
 *
 * Source : Atmo France et les AASQA — licence ODbL (mention obligatoire UI).
 */
import type { PollenBulkEntry, PollenLevel } from './types';
import { parsePollenLevel } from './levels';

const WFS_URL = process.env.ATMO_WFS_URL ?? 'https://data.atmo-france.org/geoserver/ows';
const LAYER = 'ind_pol:ind_national_pol';
const PAGE_SIZE = 40_000;
const REQUEST_TIMEOUT_MS = 90_000;
/** En dessous, la réponse n'est pas une couverture France plausible. */
const MIN_PLAUSIBLE_COMMUNES = 1_000;

interface WfsPollenProps {
  code_zone?: string;
  code_qual?: number;
  code_aul?: number;
  code_boul?: number;
  code_oliv?: number;
  code_gram?: number;
  code_arm?: number;
  code_ambr?: number;
}

interface WfsFeatureCollection {
  features?: Array<{ properties?: WfsPollenProps }>;
  numberMatched?: number;
  numberReturned?: number;
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function buildUrl(date: string, startIndex: number): string {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: LAYER,
    outputFormat: 'application/json',
    CQL_FILTER: `date_ech='${date}'`,
    propertyName: 'code_zone,code_qual,code_aul,code_boul,code_oliv,code_gram,code_arm,code_ambr',
    count: String(PAGE_SIZE),
    startIndex: String(startIndex),
    sortBy: 'code_zone', // pagination stable
  });
  return `${WFS_URL}?${params}`;
}

function entryFromProps(p: WfsPollenProps): PollenBulkEntry | null {
  const indice_global = parsePollenLevel(p.code_qual);
  if (indice_global == null) return null;
  const lvl = (v: number | undefined): PollenLevel => parsePollenLevel(v) ?? 0;
  return {
    indice_global,
    especes: {
      ambroisie: lvl(p.code_ambr),
      armoise: lvl(p.code_arm),
      aulne: lvl(p.code_aul),
      bouleau: lvl(p.code_boul),
      graminees: lvl(p.code_gram),
      olivier: lvl(p.code_oliv),
    },
  };
}

/** Parse une FeatureCollection WFS en Map commune → entrée bulk. Pure — testée. */
export function collectWfsFeatures(
  json: WfsFeatureCollection,
  target: Map<string, PollenBulkEntry>,
): number {
  let added = 0;
  for (const f of json.features ?? []) {
    const p = f.properties;
    if (!p?.code_zone) continue;
    const entry = entryFromProps(p);
    if (!entry) continue;
    target.set(String(p.code_zone).toUpperCase(), entry);
    added++;
  }
  return added;
}

async function fetchPage(date: string, startIndex: number): Promise<WfsFeatureCollection> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(buildUrl(date, startIndex), {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`wfs_http_${res.status}`);
    return (await res.json()) as WfsFeatureCollection;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Récupère l'indice pollen de toutes les communes pour le jour J (repli J-1).
 * Renvoie null si le WFS est indisponible ou la couverture implausible —
 * l'appelant retombe sur le provider authentifié/mock.
 */
export async function fetchPollenBulkWfs(
  onLog?: (message: string) => void,
): Promise<{ byCommune: Map<string, PollenBulkEntry>; date: string } | null> {
  for (const offset of [0, -1]) {
    const date = isoDate(offset);
    const byCommune = new Map<string, PollenBulkEntry>();
    try {
      onLog?.(`WFS public Atmo : requête France entière pour le ${date}…`);
      for (let startIndex = 0; ; startIndex += PAGE_SIZE) {
        const page = await fetchPage(date, startIndex);
        const added = collectWfsFeatures(page, byCommune);
        onLog?.(`WFS ${date} : +${added} communes (cumul ${byCommune.size})`);
        const returned = page.numberReturned ?? page.features?.length ?? 0;
        if (returned < PAGE_SIZE) break;
      }
      if (byCommune.size >= MIN_PLAUSIBLE_COMMUNES) {
        return { byCommune, date };
      }
      onLog?.(`WFS ${date} : couverture implausible (${byCommune.size} communes) — essai date suivante`);
    } catch (err) {
      onLog?.(`WFS ${date} en échec (${err instanceof Error ? err.message : 'erreur'})`);
    }
  }
  onLog?.('WFS public indisponible — repli sur le provider configuré.');
  return null;
}
