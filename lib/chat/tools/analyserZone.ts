/**
 * lib/chat/tools/analyserZone.ts
 * Outil analyser_zone_pois — récupère des POIs par zone géographique,
 * avec pagination automatique et calcul d'isochrones optionnel.
 */

import { createAdminClient } from '@/lib/auth';
import { logger } from '@/lib/logger';
import {
  fetchIsochrones, buildIsochCacheKey, ORS_MAX_POIS_CHAT,
  type PoiRow, type IsochroneCacheCtx,
} from '@/lib/isochrones/fetcher';
import {
  CITY_BASE_RADIUS, getCoordsForVille, getCoordsForRegion, normVille, resolveCategory,
} from '@/lib/geo/locations';
import { orgContextStorage } from './orgContext';

const NATIONAL_TERMS = ['france', 'france entiere', 'france entière', 'national', 'tout', 'tous', 'toute'];
const SELECT_COLS    = 'id, nom, lat, lng, categorie, sous_categorie, adresse, ville, region, departement';
const PAGE_SIZE      = 1000;

export async function analyserZone(
  args:            Record<string, unknown>,
  validCategories: string[],
  options:         { forceRecalculate?: boolean } = {},
) {
  const villeRaw   = args.ville ? String(args.ville) : undefined;
  const isNational = villeRaw
    ? NATIONAL_TERMS.some(t => villeRaw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(t))
    : false;

  const ville       = isNational ? undefined : villeRaw;
  const region      = args.region      ? String(args.region)      : undefined;
  const departement = args.departement ? String(args.departement) : undefined;
  const categorie_poi       = args.categorie_poi       ? String(args.categorie_poi)       : undefined;
  const rayonRaw            = args.rayon_metres    != null ? Number(args.rayon_metres)    : null;
  const rayon_metres        = rayonRaw && rayonRaw > 0 ? rayonRaw : null;
  const rayonPoiRaw         = args.rayon_poi_metres != null ? Number(args.rayon_poi_metres) : null;
  const rayon_poi_metres    = rayonPoiRaw && rayonPoiRaw > 0 ? rayonPoiRaw : null;
  const isochrone_minutes   = args.isochrone_minutes != null ? (Number(args.isochrone_minutes) || null) : null;
  const isochrone_mode      = args.isochrone_mode ? String(args.isochrone_mode) : 'walk';
  const couleur             = args.couleur ? String(args.couleur) : undefined;

  const coordonnees = ville
    ? getCoordsForVille(ville)
    : region
      ? getCoordsForRegion(region)
      : { lat: 48.8566, lng: 2.3522 };

  const resolvedCategory = resolveCategory(categorie_poi, validCategories);
  if (categorie_poi && !resolvedCategory) {
    console.warn(`[chat] Catégorie inconnue: "${categorie_poi}" (valides: ${validCategories.join(', ')})`);
  }

  const supabase = createAdminClient();
  const { orgSourceIds = null } = orgContextStorage.getStore() ?? {};
  const poisMap  = new Map<string, PoiRow>();

  // Applique le filtre org (data_source_id) si l'org a des sources restreintes
  // Generic typing: passes through any Supabase query builder while preserving its chaining type.
  function applyOrgFilter<Q extends { in: (col: string, vals: readonly string[]) => Q }>(q: Q): Q {
    if (orgSourceIds !== null) q = q.in('data_source_id', orgSourceIds);
    return q;
  }

  function addRows(data: PoiRow[]) {
    for (const p of data) {
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      if (isNaN(lat) || isNaN(lng)) continue;
      poisMap.set(p.id, {
        id:            p.id,
        nom:           p.nom ?? 'Inconnu',
        lat, lng,
        categorie:     p.categorie ?? 'autre',
        sous_categorie: p.sous_categorie,
        adresse:       p.adresse,
        ville:         p.ville,
      });
    }
  }

  async function fetchAllPages(
    buildQuery: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
    maxRows = 10_000,
  ) {
    let from = 0;
    while (from < maxRows) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await buildQuery(from, to);
      if (error) { console.error('[chat] pagination error:', error.message); break; }
      if (!data?.length) break;
      addRows(data as PoiRow[]);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  try {
    if (region) {
      const regionNorm = region.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      await fetchAllPages((from, to) => {
        let q = supabase.from('poi_france').select(SELECT_COLS).ilike('region', `%${regionNorm}%`).range(from, to);
        if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
        return applyOrgFilter(q);
      });
      if (poisMap.size === 0) {
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS).ilike('ville', `%${regionNorm}%`).range(from, to);
          if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
          return applyOrgFilter(q);
        });
        if (poisMap.size > 0) logger.debug('chat', `region→ville fallback: ${poisMap.size} résultats pour "${region}"`);
      }
    }

    if (departement) {
      // Deux requêtes paramétrées distinctes (ilike puis eq) plutôt qu'un
      // .or() avec interpolation brute : postgrest-js n'échappe rien dans
      // .or(), ce qui permettait d'injecter des clauses de filtre arbitraires
      // via un argument de function-calling LLM non validé. .ilike()/.eq()
      // passent la valeur en paramètre de requête, sans ce risque.
      await fetchAllPages((from, to) => {
        let q = supabase.from('poi_france').select(SELECT_COLS)
          .ilike('departement', `%${departement}%`)
          .range(from, to);
        if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
        return applyOrgFilter(q);
      });
      if (poisMap.size === 0) {
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS)
            .eq('code_departement', departement.toUpperCase())
            .range(from, to);
          if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
          return applyOrgFilter(q);
        });
        if (poisMap.size > 0) logger.debug('chat', `departement code fallback: ${poisMap.size} résultats pour "${departement}"`);
      }
    }

    if (ville) {
      const villeKey = normVille(ville);
      await fetchAllPages((from, to) => {
        let q = supabase.from('poi_france').select(SELECT_COLS).ilike('ville', `%${villeKey}%`).range(from, to);
        if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
        return applyOrgFilter(q);
      }, 4000);

      if (poisMap.size === 0 && !region) {
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS).ilike('region', `%${villeKey}%`).range(from, to);
          if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
          return applyOrgFilter(q);
        });
        if (poisMap.size > 0) logger.debug('chat', `ville→region fallback: ${poisMap.size} résultats pour "${ville}"`);
      }

      if (rayon_metres) {
        const cityBase      = CITY_BASE_RADIUS[villeKey] ?? 3000;
        const effectiveRadius = cityBase + rayon_metres;
        // 111_000 m/deg (lat), ajusté par cos(lat) pour lng
        const dlat = effectiveRadius / 111_000;
        const dlng = effectiveRadius / (111_000 * Math.cos((coordonnees.lat * Math.PI) / 180));
        let bboxQ = supabase
          .from('poi_france').select(SELECT_COLS)
          .gte('lat', coordonnees.lat - dlat).lte('lat', coordonnees.lat + dlat)
          .gte('lng', coordonnees.lng - dlng).lte('lng', coordonnees.lng + dlng)
          .eq('categorie', resolvedCategory ?? '')
          .limit(1000);
        bboxQ = applyOrgFilter(bboxQ);
        const { data: bboxData, error: bboxErr } = await bboxQ;
        if (bboxErr) console.error('[chat] bbox error:', bboxErr.message);
        else addRows((bboxData ?? []) as PoiRow[]);
      }
    }

    if (!ville && !region && !departement) {
      await fetchAllPages((from, to) => {
        let q = supabase.from('poi_france').select(SELECT_COLS).range(from, to);
        if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
        return applyOrgFilter(q);
      }, 10_000);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[chat] Supabase exception:', msg);
  }

  const pois = Array.from(poisMap.values());
  const categories: Record<string, number> = {};
  for (const p of pois) {
    const cat = p.categorie || 'autre';
    categories[cat] = (categories[cat] ?? 0) + 1;
  }

  const locationLabel = ville ?? region ?? departement ?? 'France';

  let isochroneGeoJSON: Record<string, unknown> | null = null;
  if (isochrone_minutes && pois.length > 0) {
    const cacheKey = buildIsochCacheKey(locationLabel, resolvedCategory ?? categorie_poi, isochrone_minutes, isochrone_mode);
    const cacheCtx: IsochroneCacheCtx = {
      cacheKey,
      ville:     locationLabel,
      categorie: resolvedCategory ?? categorie_poi ?? undefined,
    };
    logger.debug('isochrone', `Calcul: ${pois.length} POIs, ${isochrone_minutes}min, mode=${isochrone_mode}, key=${cacheKey}`);
    isochroneGeoJSON = await fetchIsochrones(pois, isochrone_minutes, isochrone_mode, cacheCtx, ORS_MAX_POIS_CHAT, options.forceRecalculate);
  }

  const cat               = resolvedCategory ?? categorie_poi;
  const couleur_overrides = couleur && cat ? { [cat]: couleur } : undefined;

  const catLabel = resolvedCategory ? ` [${resolvedCategory}]` : '';
  logger.debug('chat', `analyser_zone_pois(${locationLabel}${catLabel}) → ${pois.length} POIs`);

  return {
    ville:           locationLabel,
    region:          region      ?? null,
    departement:     departement ?? null,
    categorie_poi:   resolvedCategory ?? categorie_poi ?? null,
    rayon_metres,
    rayon_poi_metres,
    coordonnees,
    pois,
    nb_pois:          pois.length,
    categories,
    isochrone_minutes,
    isochrone_mode,
    isochroneGeoJSON,
    couleur_overrides,
  };
}
