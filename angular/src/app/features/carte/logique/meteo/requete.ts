/**
 * Copie Angular (lot 4, P6) VERBATIM de `lib/meteo/requete.ts` (imports relatifs seuls changes),
 * verrouillee par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 etendu a /map).
 * Ne pas corriger un defaut ici sans le corriger dans React.
 */
/**
 * @file lib/meteo/requete.ts — logique PURE de la route /api/meteo-geo.
 *
 * Extraite de la route le 2026-09-13 pour être testée sans réseau ni base :
 * validation de la période, choix de l'hôte Open-Meteo, construction de l'URL,
 * échantillonnage spatial, arrondi de la bbox et clé de cache. La route ne
 * garde que l'orchestration (auth, quota, RPC, appel HTTP, flux NDJSON).
 *
 * ── Deux défauts corrigés au passage ─────────────────────────────────────────
 *
 * 1. La clé de cache arrondissait la bbox au demi-degré, mais les ZONES
 *    étaient filtrées sur la bbox EXACTE : deux vues voisines partageaient une
 *    clé tout en couvrant des CP différents, et la seconde lisait en cache un
 *    jeu de données qui ne couvrait pas tout son viewport — des CP sans
 *    valeur, sans erreur. La bbox est désormais arrondie VERS L'EXTÉRIEUR
 *    (`arrondirBboxExterieur`) et c'est cette bbox arrondie qui filtre les
 *    zones : même clé ⇒ mêmes zones, et jamais moins que le viewport.
 *
 * 2. La validation ne bornait la période QUE d'un côté : en mode prévision,
 *    seule la distance aujourd'hui → fin était vérifiée. Un `startDate` de
 *    2020 avec un `endDate` de demain passait, et partait vers l'hôte de
 *    prévision, qui refuse. `validerPeriode` borne désormais la longueur
 *    totale dans tous les cas.
 */
import type { MeteoVariable } from './types';
import { METEO_DAILY_FIELD } from './types';

export const MAX_HISTORY_DAYS = 90;
export const MAX_FORECAST_DAYS = 16;
/** URL nginx Open-Meteo ~8 kB → 500 points par appel (coordonnées à 3 décimales). */
export const MAX_POINTS_PER_BATCH = 500;
/** Avant cette date, seul l'hôte d'archive (ERA5) répond. */
export const ARCHIVE_CUTOFF = '2022-01-01';

export interface ZoneCentroid {
  code: string;
  nom: string;
  lat: number;
  lon: number;
}

export interface QueryPoint {
  lat: number;
  lon: number;
}

export type Bbox = readonly [number, number, number, number];

/** Date du jour en ISO (UTC). Les dates Open-Meteo sont des jours civils : le décalage d'une heure autour de minuit est sans effet sur le choix d'hôte. */
export function todayStr(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/**
 * Valide une période. Rend un message d'erreur (français, destiné au client)
 * ou `null` si la période est acceptable.
 */
export function validerPeriode(startDate: string, endDate: string, today: string): string | null {
  if (startDate > endDate) return 'startDate must be <= endDate';
  const isFuture = endDate >= today;
  if (isFuture && daysBetween(today, endDate) > MAX_FORECAST_DAYS) {
    return `Forecast limited to ${MAX_FORECAST_DAYS} days ahead of today`;
  }
  if (!isFuture && daysBetween(startDate, endDate) > MAX_HISTORY_DAYS) {
    return `History range limited to ${MAX_HISTORY_DAYS} days`;
  }
  // Borne TOTALE, quel que soit le mode : une prévision qui remonte deux ans
  // en arrière n'est pas une prévision, et l'hôte de prévision la refuserait.
  if (daysBetween(startDate, endDate) > MAX_HISTORY_DAYS + MAX_FORECAST_DAYS) {
    return `Period limited to ${MAX_HISTORY_DAYS + MAX_FORECAST_DAYS} days`;
  }
  return null;
}

export function pickHost(startDate: string, endDate: string, today: string): string {
  if (endDate >= today) return 'api.open-meteo.com';
  if (startDate < ARCHIVE_CUTOFF) return 'archive-api.open-meteo.com';
  return 'historical-forecast-api.open-meteo.com';
}

export function buildOpenMeteoUrl(
  host: string,
  points: readonly QueryPoint[],
  variable: MeteoVariable,
  startDate: string,
  endDate: string,
): string {
  const endpoint = host === 'archive-api.open-meteo.com' ? '/v1/archive' : '/v1/forecast';
  const dailyField = METEO_DAILY_FIELD[variable];
  // Construction manuelle : URLSearchParams encode les virgules en %2C et
  // triple la taille de la liste lat/lon → 414 côté Open-Meteo.
  const latList = points.map((z) => z.lat.toFixed(3)).join(',');
  const lonList = points.map((z) => z.lon.toFixed(3)).join(',');
  return (
    `https://${host}${endpoint}` +
    `?latitude=${latList}` +
    `&longitude=${lonList}` +
    `&daily=${dailyField}` +
    `&start_date=${startDate}` +
    `&end_date=${endDate}` +
    `&timezone=${encodeURIComponent('Europe/Paris')}`
  );
}

/**
 * Échantillonnage spatial : regroupe les zones sur une grille adaptative pour
 * ne jamais dépasser `maxPoints` appels Open-Meteo. Le modèle est à ~11-25 km
 * de résolution : interroger chaque CP d'une même maille répéterait la même
 * valeur. Rend les points à interroger et, pour chaque zone, l'index du point
 * qui la représente.
 */
export function sampleZonePoints(
  zones: readonly ZoneCentroid[],
  maxPoints: number,
): { points: QueryPoint[]; assign: number[] } {
  if (zones.length <= maxPoints) {
    return {
      points: zones.map((z) => ({ lat: z.lat, lon: z.lon })),
      assign: zones.map((_, i) => i),
    };
  }
  const buildCells = (step: number): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    zones.forEach((z, i) => {
      const k = `${Math.round(z.lat / step)}:${Math.round(z.lon / step)}`;
      const arr = m.get(k);
      if (arr) arr.push(i);
      else m.set(k, [i]);
    });
    return m;
  };
  let step = 0.1;
  let cells = buildCells(step);
  while (cells.size > maxPoints) {
    step *= 1.4;
    cells = buildCells(step);
  }
  const points: QueryPoint[] = [];
  const assign = new Array<number>(zones.length).fill(0);
  for (const idxs of cells.values()) {
    const lat = idxs.reduce((s, i) => s + zones[i].lat, 0) / idxs.length;
    const lon = idxs.reduce((s, i) => s + zones[i].lon, 0) / idxs.length;
    const p = points.length;
    points.push({ lat, lon });
    for (const i of idxs) assign[i] = p;
  }
  return { points, assign };
}

/** Parse "west,south,east,north" (déjà validé par le schéma de la route). */
export function parseBbox(bbox: string): Bbox {
  const [w, s, e, n] = bbox.split(',').map(parseFloat);
  return [w, s, e, n];
}

/**
 * Arrondit une bbox au demi-degré VERS L'EXTÉRIEUR : la bbox rendue contient
 * toujours la bbox demandée. Limite la fragmentation du cache quand la vue
 * bouge légèrement, sans jamais perdre un CP du viewport.
 */
export function arrondirBboxExterieur(bbox: Bbox, pas = 0.5): Bbox {
  const [w, s, e, n] = bbox;
  return [
    Math.floor(w / pas) * pas,
    Math.floor(s / pas) * pas,
    Math.ceil(e / pas) * pas,
    Math.ceil(n / pas) * pas,
  ];
}

export function dansBbox(zone: QueryPoint, bbox: Bbox): boolean {
  const [w, s, e, n] = bbox;
  return zone.lon >= w && zone.lon <= e && zone.lat >= s && zone.lat <= n;
}

/**
 * Clé de cache : version, échelle, variable, dates et bbox ARRONDIE — la même
 * bbox que celle qui filtre les zones, pour qu'une clé désigne toujours le
 * même jeu de zones.
 */
export function cleCache(
  scale: string,
  variable: string,
  startDate: string,
  endDate: string,
  bboxArrondie?: Bbox,
): string {
  const bboxKey = bboxArrondie ? bboxArrondie.map((v) => v.toFixed(1)).join(',') : '';
  return `v3-${scale}-${variable}-${startDate}-${endDate}-${bboxKey}`;
}
