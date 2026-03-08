import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import {
  fetchIsochrones, buildIsochCacheKey, ORS_MAX_POIS_CHAT, ORS_PROFILES,
  type PoiRow, type IsochroneCacheCtx,
} from '@/lib/isochrones/fetcher';
import {
  CITY_BASE_RADIUS, getCoordsForVille, getCoordsForRegion, normVille, resolveCategory,
} from '@/lib/geo/locations';
import postgresLib from 'postgres';
import { CHORO_INDICATORS } from './system-prompt';

// =============================================================================
// Exécution des outils (server-side, async)
// =============================================================================

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  validCategories: string[],
  options: { forceRecalculate?: boolean } = {}
) {
  if (name === 'analyser_zone_pois') {
    console.log('[tool:analyser_zone_pois] args reçus:', JSON.stringify(args));

    // Termes "nationaux" que l'IA passe parfois comme ville → traiter comme France entière
    const NATIONAL_TERMS = ['france', 'france entiere', 'france entière', 'national', 'tout', 'tous', 'toute'];
    const villeRaw = args.ville ? String(args.ville) : undefined;
    const isNational = villeRaw
      ? NATIONAL_TERMS.some(t => villeRaw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(t))
      : false;

    const ville = isNational ? undefined : villeRaw;
    const region = args.region ? String(args.region) : undefined;
    const departement = args.departement ? String(args.departement) : undefined;
    if (isNational) console.log('[tool:analyser_zone_pois] détecté scope national, filtre géo ignoré');
    const categorie_poi = args.categorie_poi ? String(args.categorie_poi) : undefined;
    const rayonRaw = args.rayon_metres != null ? Number(args.rayon_metres) : null;
    const rayon_metres = rayonRaw && rayonRaw > 0 ? rayonRaw : null;
    const rayonPoiRaw = args.rayon_poi_metres != null ? Number(args.rayon_poi_metres) : null;
    const rayon_poi_metres = rayonPoiRaw && rayonPoiRaw > 0 ? rayonPoiRaw : null;

    const isochrone_minutes_raw = args.isochrone_minutes != null ? Number(args.isochrone_minutes) : null;
    const isochrone_minutes = isochrone_minutes_raw && isochrone_minutes_raw > 0 ? isochrone_minutes_raw : null;
    const isochrone_mode = args.isochrone_mode ? String(args.isochrone_mode) : 'walk';
    const couleur = args.couleur ? String(args.couleur) : undefined;

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
    const poisMap = new Map<string, PoiRow>();

    const SELECT_COLS = 'id, nom, lat, lng, categorie, sous_categorie, adresse, ville, region, departement';
    const PAGE_SIZE = 1000; // page size compatible PostgREST (max_rows Supabase)

    function addRows(data: any[]) {
      for (const p of data) {
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        if (isNaN(lat) || isNaN(lng)) continue;
        poisMap.set(p.id, {
          id: p.id,
          nom: p.nom ?? 'Inconnu',
          lat, lng,
          categorie: p.categorie ?? 'autre',
          sous_categorie: p.sous_categorie,
          adresse: p.adresse,
          ville: p.ville,
        });
      }
    }

    // Pagination automatique — contourne la limite PostgREST max_rows=1000
    async function fetchAllPages(
      buildQuery: (from: number, to: number) => any,
      maxRows = 10000,
    ) {
      let from = 0;
      while (from < maxRows) {
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await buildQuery(from, to);
        if (error) { console.error('[chat] pagination error:', error.message); break; }
        if (!data?.length) break;
        addRows(data);
        if (data.length < PAGE_SIZE) break; // dernière page
        from += PAGE_SIZE;
      }
    }

    try {
      if (region) {
        const regionNorm = region.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS).ilike('region', `%${regionNorm}%`).range(from, to);
          if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
          return q;
        });

        if (poisMap.size === 0) {
          await fetchAllPages((from, to) => {
            let q = supabase.from('poi_france').select(SELECT_COLS).ilike('ville', `%${regionNorm}%`).range(from, to);
            if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
            return q;
          });
          if (poisMap.size > 0) console.log(`[chat] region→ville fallback: ${poisMap.size} résultats pour "${region}"`);
        }
      }

      if (departement) {
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS)
            .or(`departement.ilike.%${departement}%,code_departement.eq.${departement}`)
            .range(from, to);
          if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
          return q;
        });
      }

      if (ville) {
        const villeKey = normVille(ville);
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS).ilike('ville', `%${villeKey}%`).range(from, to);
          if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
          return q;
        }, 4000);

        if (poisMap.size === 0 && !region) {
          await fetchAllPages((from, to) => {
            let q = supabase.from('poi_france').select(SELECT_COLS).ilike('region', `%${villeKey}%`).range(from, to);
            if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
            return q;
          });
          if (poisMap.size > 0) console.log(`[chat] ville→region fallback: ${poisMap.size} résultats pour "${ville}"`);
        }

        if (rayon_metres) {
          const cityBase = CITY_BASE_RADIUS[villeKey] ?? 3000;
          const effectiveRadius = cityBase + rayon_metres;
          const dlat = effectiveRadius / 111000;
          const dlng = effectiveRadius / (111000 * Math.cos((coordonnees.lat * Math.PI) / 180));
          const { data: bboxData, error: bboxErr } = await supabase.from('poi_france').select(SELECT_COLS)
            .gte('lat', coordonnees.lat - dlat).lte('lat', coordonnees.lat + dlat)
            .gte('lng', coordonnees.lng - dlng).lte('lng', coordonnees.lng + dlng)
            .eq('categorie', resolvedCategory ?? '')
            .limit(1000);
          if (bboxErr) console.error('[chat] bbox error:', bboxErr.message);
          else addRows(bboxData ?? []);
        }
      }

      if (!ville && !region && !departement) {
        // France entière — pagination jusqu'à 10 000 lignes
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS).range(from, to);
          if (resolvedCategory) q = q.eq('categorie', resolvedCategory);
          return q;
        }, 10000);
      }
    } catch (e: any) {
      console.error('[chat] Supabase exception:', e.message);
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
        ville: locationLabel,
        categorie: resolvedCategory ?? categorie_poi ?? undefined,
      };
      console.log(`[isochrone] Calcul: ${pois.length} POIs, ${isochrone_minutes}min, mode=${isochrone_mode}, key=${cacheKey}`);
      isochroneGeoJSON = await fetchIsochrones(pois, isochrone_minutes, isochrone_mode, cacheCtx, ORS_MAX_POIS_CHAT, options.forceRecalculate);
    }

    const cat = resolvedCategory ?? categorie_poi;
    const couleur_overrides = couleur && cat ? { [cat]: couleur } : undefined;

    const result = {
      ville: locationLabel,
      region: region ?? null,
      departement: departement ?? null,
      categorie_poi: resolvedCategory ?? categorie_poi ?? null,
      rayon_metres,
      rayon_poi_metres,
      coordonnees,
      pois,
      nb_pois: pois.length,
      categories,
      isochrone_minutes,
      isochrone_mode,
      isochroneGeoJSON,
      couleur_overrides,
    };

    const catLabel = resolvedCategory ? ` [${resolvedCategory}]` : '';
    console.log(`[chat] analyser_zone_pois(${locationLabel}${catLabel}) → ${pois.length} POIs`);
    return result;
  }

  if (name === 'voronoi_analysis') {
    const category = args.category ? String(args.category) : '';
    if (!category) return { error: 'category requis pour voronoi_analysis' };

    const metropolitaine   = args.metropolitaine !== false;
    const filtre_ville     = args.ville        ? String(args.ville)        : null;
    const filtre_region    = args.region       ? String(args.region)       : null;
    const filtre_dept      = args.departement  ? String(args.departement)  : null;

    const rpcArgs: Record<string, unknown> = { cat_name: category, metropolitaine };
    if (filtre_ville)  rpcArgs.filtre_ville       = filtre_ville;
    if (filtre_region) rpcArgs.filtre_region      = filtre_region;
    if (filtre_dept)   rpcArgs.filtre_departement = filtre_dept;

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_voronoi_by_category', rpcArgs);

    if (error) {
      console.error('[chat/voronoi] RPC error:', error.message);
      return { error: error.message, nb_polygones: 0, category };
    }

    const features = Array.isArray(data) ? data : [];
    console.log(`[chat/voronoi] "${category}" metro=${metropolitaine} ville=${filtre_ville} region=${filtre_region} dept=${filtre_dept} → ${features.length} polygones`);

    const pois = features
      .map((f: any) => ({
        id:        f?.properties?.id        ?? String(Math.random()),
        nom:       f?.properties?.nom       ?? 'Inconnu',
        lat:       Number(f?.properties?.lat ?? 0),
        lng:       Number(f?.properties?.lng ?? 0),
        categorie: f?.properties?.categorie ?? category,
        adresse:   f?.properties?.adresse   ?? undefined,
        ville:     f?.properties?.ville     ?? undefined,
      }))
      .filter((p: any) => p.lat !== 0 && p.lng !== 0);

    const locationLabel = filtre_ville ?? filtre_region ?? filtre_dept
      ?? (metropolitaine ? 'France métropolitaine' : 'France');

    const coordonnees = pois.length > 0
      ? {
          lat: pois.reduce((s: number, p: any) => s + p.lat, 0) / pois.length,
          lng: pois.reduce((s: number, p: any) => s + p.lng, 0) / pois.length,
        }
      : { lat: 46.8, lng: 2.3 };

    const poisForMap = {
      ville:           locationLabel,
      region:          filtre_region ?? null,
      departement:     filtre_dept   ?? null,
      categorie_poi:   category,
      rayon_metres:    null,
      rayon_poi_metres: null,
      coordonnees,
      pois,
      nb_pois:         pois.length,
      categories:      { [category]: pois.length },
    };

    return {
      voronoiGeoJSON: {
        type: 'FeatureCollection' as const,
        features,
        _meta: { category, metropolitaine, filtre_ville, filtre_region, filtre_dept },
      },
      poisForMap,
      nb_polygones: features.length,
      category,
      metropolitaine,
    };
  }

  if (name === 'afficher_carreaux') {
    const indicateur = args.indicateur ? String(args.indicateur) : 'ind_18_24';
    const known = CHORO_INDICATORS[indicateur];
    const resolvedCol   = known?.col   ?? indicateur;
    const resolvedLabel = args.indicateur_label
      ? String(args.indicateur_label)
      : (known?.label ?? indicateur);

    const ville = args.ville ? String(args.ville) : undefined;
    const coordonnees = ville ? getCoordsForVille(ville) : { lat: 48.3904, lng: -4.4861 };

    console.log(`[chat] afficher_carreaux → col="${resolvedCol}" label="${resolvedLabel}" ville="${ville ?? 'n/a'}"`);

    return {
      action: 'afficher_carreaux' as const,
      indicateur: resolvedCol,
      indicateur_label: resolvedLabel,
      ville,
      coordonnees,
    };
  }

  if (name === 'isochrone_battle') {
    const category = args.category ? String(args.category) : '';
    if (!category) return { error: 'category requis pour isochrone_battle' };

    const mode           = args.mode          ? String(args.mode)          : 'drive';
    const metropolitaine = args.metropolitaine !== false;
    const filtre_ville   = args.ville         ? String(args.ville)         : null;
    const filtre_region  = args.region        ? String(args.region)        : null;
    const filtre_dept    = args.departement   ? String(args.departement)   : null;
    const max_minutes    = args.max_minutes   ? Number(args.max_minutes)   : 120;

    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 280_000);
      const res = await fetch(`${baseUrl}/api/isochrone-battle`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body: JSON.stringify({
          category, mode, metropolitaine,
          filtre_ville, filtre_region,
          filtre_departement: filtre_dept,
          force_recalculate: (args as any).forceRecalculate ?? false,
          max_minutes,
        }),
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        const errText = await res.text();
        console.error('[chat/isochrone_battle] Erreur endpoint HTTP', res.status, ':', errText);
        let friendlyErr = errText;
        try { friendlyErr = JSON.parse(errText)?.error ?? errText; } catch { /* keep raw */ }
        return { error: friendlyErr, category };
      }

      const data = await res.json();
      console.log(`[chat/isochrone_battle] "${category}" → ${data.nb_features ?? 0} features, ${data.nb_pois ?? 0} POIs`);
      return data;
    } catch (e: any) {
      const msg = e.name === 'AbortError'
        ? 'Timeout (>280s) : trop de CIRFA à calculer sans cache. Lance la bataille depuis /map d\'abord pour remplir le cache ORS.'
        : e.message;
      console.error('[chat/isochrone_battle] Fetch error:', msg);
      return { error: msg, category };
    }
  }

  if (name === 'analyser_panneaux') {
    const regie        = args.regie        ? String(args.regie)        : undefined;
    const ville        = args.ville        ? String(args.ville)        : undefined;
    const region       = args.region       ? String(args.region)       : undefined;
    const departement  = args.departement  ? String(args.departement)  : undefined;
    const type_panneau = args.type_panneau ? String(args.type_panneau) : undefined;
    const couleur      = args.couleur      ? String(args.couleur)      : '#f97316';

    const supabase = createAdminClient();
    const PAGE_PAN = 1000;

    // Pagination automatique — gère 10k+ panneaux sans truncation
    const allPanneaux: any[] = [];
    let from = 0;
    while (from < 50_000) {
      let q: any = supabase
        .from('panneaux_affichage')
        .select('id, lat, lng, reference_panneau, regie, type_panneau, ville, departement, code_departement, region')
        .eq('actif', true)
        .range(from, from + PAGE_PAN - 1);
      if (regie)        q = q.ilike('regie',        `%${regie}%`);
      if (ville)        q = q.ilike('ville',         `%${ville}%`);
      if (region)       q = q.ilike('region',        `%${region}%`);
      if (departement)  q = q.or(`departement.ilike.%${departement}%,code_departement.eq.${departement}`);
      if (type_panneau) q = q.ilike('type_panneau',  `%${type_panneau}%`);
      const { data: pageData, error: pageErr } = await q;
      if (pageErr) return { error: pageErr.message };
      if (!pageData?.length) break;
      allPanneaux.push(...pageData);
      if (pageData.length < PAGE_PAN) break;
      from += PAGE_PAN;
    }

    const pois = allPanneaux.map((p: any) => ({
      id:             p.id,
      nom:            p.reference_panneau ?? p.id,
      lat:            Number(p.lat),
      lng:            Number(p.lng),
      categorie:      'panneaux',
      sous_categorie: p.type_panneau ?? null,
      ville:          p.ville ?? undefined,
      adresse:        p.regie ?? undefined,
    })).filter((p: any) => !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0);

    const locationLabel = ville ?? region ?? departement
      ?? (regie ? `Panneaux ${regie}` : 'Panneaux OOH — France');

    const coordonnees = pois.length > 0
      ? {
          lat: pois.reduce((s: number, p: any) => s + p.lat, 0) / pois.length,
          lng: pois.reduce((s: number, p: any) => s + p.lng, 0) / pois.length,
        }
      : { lat: 46.8, lng: 2.3 };

    console.log(`[chat] analyser_panneaux(regie=${regie ?? '*'}, ${locationLabel}) → ${pois.length} panneaux`);
    return {
      ville:            locationLabel,
      region:           region      ?? null,
      departement:      departement ?? null,
      categorie_poi:    'panneaux',
      rayon_metres:     null,
      rayon_poi_metres: null,
      coordonnees,
      pois,
      nb_pois:          pois.length,
      categories:       { panneaux: pois.length },
      isochrone_minutes: null,
      isochrone_mode:    null,
      isochroneGeoJSON:  null,
      couleur_overrides: { panneaux: couleur },
    };
  }

  if (name === 'calculate_audience_coverage') {
    const location_name       = String(args.location_name ?? '');
    const travel_time_minutes = Number(args.travel_time_minutes ?? 30);
    const target_column       = String(args.target_column ?? 'Ind');
    const target_label        = String(args.target_label ?? 'Population totale');
    const mode                = String(args.mode ?? 'drive');

    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) return { error: 'ORS_API_KEY non configurée — impossible de calculer l\'isochrone.' };

    let lat: number, lng: number;
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5_000);
      const banRes = await fetch(
        `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(location_name)}&limit=1&type=municipality`,
        { signal: ctrl.signal }
      ).finally(() => clearTimeout(timer));
      const banData = await banRes.json();
      const coords = banData?.features?.[0]?.geometry?.coordinates;
      if (!coords) return { error: `Lieu introuvable : "${location_name}"` };
      [lng, lat] = coords as [number, number];
    } catch (e: any) {
      return { error: `Géocodage échoué : ${e.message}` };
    }

    const profile = ORS_PROFILES[mode] ?? 'driving-car';
    // Timeout adaptatif : isochrones longs (60 min voiture) génèrent des polygones bien plus larges
    const orsTimeoutMs = travel_time_minutes <= 30 ? 15_000 : travel_time_minutes <= 60 ? 25_000 : 35_000;
    let isoFeature: any = null;
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), orsTimeoutMs);
      const orsRes = await fetch(
        `https://api.openrouteservice.org/v2/isochrones/${profile}`,
        {
          method:  'POST',
          signal:  ctrl.signal,
          headers: {
            'Authorization': apiKey,
            'Content-Type':  'application/json',
            'Accept':        'application/json, application/geo+json',
          },
          body: JSON.stringify({
            locations:  [[lng, lat]],
            range:      [travel_time_minutes * 60],
            range_type: 'time',
          }),
        }
      ).finally(() => clearTimeout(timer));

      if (!orsRes.ok) {
        const err = await orsRes.text();
        return { error: `ORS erreur ${orsRes.status}: ${err}` };
      }
      const orsData = await orsRes.json();
      isoFeature = orsData.features?.[0];
      if (!isoFeature) return { error: 'ORS n\'a retourné aucun isochrone' };
    } catch (e: any) {
      return { error: e.name === 'AbortError' ? `Timeout ORS (${orsTimeoutMs / 1000}s) — réessayez ou réduisez le temps de trajet` : e.message };
    }

    const supabase = createAdminClient();
    const { data: sources } = await supabase
      .from('data_sources').select('geo_config').eq('type', 'carreaux').limit(1);
    const cfg        = (sources?.[0]?.geo_config as any) ?? {};
    const resolution = cfg.resolution ?? '200m';
    const millesime  = cfg.millesime  ?? '2021';

    const isoGeoJSON = JSON.stringify(isoFeature.geometry);
    const { data: coverage, error: rpcErr } = await supabase.rpc('calculate_target_coverage', {
      isochrone_geojson: isoGeoJSON,
      target_column,
      p_resolution: resolution,
      p_millesime:  millesime,
    });

    if (rpcErr) {
      console.error('[chat/coverage] RPC error:', rpcErr.message);
      return { error: rpcErr.message };
    }

    console.log(`[chat/coverage] "${location_name}" ${travel_time_minutes}min ${mode} → ${target_column} = ${coverage}`);
    return {
      location_name,
      travel_time_minutes,
      target_column,
      target_label,
      mode,
      coverage_count:   Number(coverage ?? 0),
      coordonnees:      { lat, lng },
      isochroneGeoJSON: {
        type:     'FeatureCollection',
        features: [isoFeature],
        _meta:    { mode, minutes: travel_time_minutes },
        _fromCache: false,
        _cachedAt:  null,
      },
    };
  }

  if (name === 'classer_panneaux_audience') {
    const ville        = args.ville        ? String(args.ville)        : undefined;
    const regie        = args.regie        ? String(args.regie)        : undefined;
    const target_col   = args.target_column ? String(args.target_column) : 'ind_18_24';
    const target_label = args.target_label  ? String(args.target_label)  : 'Jeunes 18-24 ans';
    const rayon_m      = args.rayon_metres  ? Number(args.rayon_metres)  : 500;
    const limit_n      = args.limit         ? Math.min(Number(args.limit), 50) : 10;

    if (!ville) return { error: 'Ville requise pour classer les panneaux.' };

    const knownCols = ['Ind', 'Ind_0_3', 'Ind_4_5', 'Ind_6_10', 'Ind_11_17', 'ind_18_24',
      'Ind_25_39', 'Ind_40_54', 'Ind_55_64', 'Ind_65_79', 'Ind_80p', 'Men', 'rev_median'];
    if (!knownCols.includes(target_col)) {
      return { error: `Indicateur inconnu: ${target_col}. Valides: ${knownCols.join(', ')}` };
    }

    const dbUrl = process.env.SUPABASE_DB_URL;
    if (!dbUrl) return { error: 'SUPABASE_DB_URL non configurée.' };
    const sql = postgresLib(dbUrl, { max: 2, idle_timeout: 20 });

    try {
      const supabase = createAdminClient();
      let q: any = supabase
        .from('panneaux_affichage')
        .select('id, reference_panneau, regie, type_panneau, lat, lng, ville')
        .eq('actif', true)
        .ilike('ville', `%${ville}%`);
      if (regie) q = q.ilike('regie', `%${regie}%`);
      const { data: panneauxData, error: pErr } = await q.limit(2000);
      if (pErr) return { error: pErr.message };
      if (!panneauxData || panneauxData.length === 0) return { error: `Aucun panneau trouvé à ${ville}.` };

      const panneaux = panneauxData
        .filter((p: any) => p.lat && p.lng && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng)))
        .map((p: any) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }));

      if (panneaux.length === 0) return { error: `Aucun panneau avec coordonnées valides à ${ville}.` };

      const bufferDeg = (rayon_m / 111320) * 1.2;
      const cosLat = Math.cos(panneaux[0].lat * Math.PI / 180);
      const minLat = Math.min(...panneaux.map((p: any) => p.lat)) - bufferDeg;
      const maxLat = Math.max(...panneaux.map((p: any) => p.lat)) + bufferDeg;
      const minLng = Math.min(...panneaux.map((p: any) => p.lng)) - bufferDeg / cosLat;
      const maxLng = Math.max(...panneaux.map((p: any) => p.lng)) + bufferDeg / cosLat;

      const [{ max: latestMillesime }] = await sql`SELECT MAX(millesime) AS max FROM carreaux_filosofi`;

      const carreaux = await sql.unsafe(`
        SELECT ST_X(ST_Centroid(geom)) AS cx,
               ST_Y(ST_Centroid(geom)) AS cy,
               (metadata->>$1)::numeric AS val
        FROM carreaux_filosofi
        WHERE millesime = $6
          AND geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
          AND metadata ? $1
      `, [target_col, minLng, minLat, maxLng, maxLat, latestMillesime]);

      const toRad = Math.PI / 180;
      function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
        const dLat = (lat2 - lat1) * toRad;
        const dLng = (lng2 - lng1) * toRad;
        const a = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
        return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      const ranked = panneaux
        .map((p: any) => {
          let score = 0;
          for (const c of carreaux) {
            if (haversineM(p.lat, p.lng, Number(c.cy), Number(c.cx)) <= rayon_m) {
              score += Number(c.val);
            }
          }
          return { ...p, audience: Math.round(score) };
        })
        .sort((a: any, b: any) => b.audience - a.audience)
        .slice(0, limit_n)
        .map((p: any, i: number) => ({
          rank:           i + 1,
          id:             p.id,
          nom:            p.reference_panneau ?? p.id,
          regie:          p.regie,
          type:           p.type_panneau,
          lat:            p.lat,
          lng:            p.lng,
          ville:          p.ville,
          audience:       p.audience,
          categorie:      'panneaux',
          sous_categorie: p.type_panneau ?? null,
          adresse:        p.regie ?? undefined,
        }));

      const totalAudience = ranked.reduce((s: number, p: any) => s + p.audience, 0);
      const rLats = ranked.map((p: any) => p.lat);
      const rLngs = ranked.map((p: any) => p.lng);
      const coordonnees = ranked.length > 0
        ? { lat: (Math.min(...rLats) + Math.max(...rLats)) / 2, lng: (Math.min(...rLngs) + Math.max(...rLngs)) / 2 }
        : getCoordsForVille(ville) ?? { lat: 46.8, lng: 2.3 };

      console.log(`[chat] classer_panneaux_audience(${ville}, ${target_col}, ${rayon_m}m, top${limit_n}) → ${ranked.length} panneaux, total=${totalAudience}`);
      return {
        ville,
        rayon_metres:    null,
        rayon_poi_metres: rayon_m,
        target_column:   target_col,
        target_label,
        limit:           limit_n,
        coordonnees,
        pois:            ranked,
        nb_pois:         ranked.length,
        total_audience:  totalAudience,
        categories:      { panneaux: ranked.length },
        couleur_overrides: { panneaux: '#ef4444' },
      };
    } catch (err: any) {
      console.error('[chat/classer_panneaux_audience]', err.message);
      return { error: err.message };
    } finally {
      await sql.end();
    }
  }

  if (name === 'analyze_poi_synergy') {
    const poi_category      = String(args.poi_category      ?? '');
    const ville             = args.ville ? String(args.ville) : undefined;
    const max_distance_m    = Number(args.max_distance_m    ?? 500);
    const target_demo_col   = String(args.target_demo_col   ?? 'ind_18_24');
    const target_demo_label = String(args.target_demo_label ?? 'Jeunes 18-24 ans');
    const min_audience      = Number(args.min_audience      ?? 0);
    const buffer_radius_m   = Number(args.buffer_radius_m   ?? 300);

    if (!poi_category) return { error: 'poi_category requis.' };
    if (!ville) return { error: 'ville requise pour analyze_poi_synergy (performance).' };

    const knownCols = ['Ind','Ind_0_3','Ind_4_5','Ind_6_10','Ind_11_17','ind_18_24',
      'Ind_25_39','Ind_40_54','Ind_55_64','Ind_65_79','Ind_80p','Men','rev_median'];
    if (!knownCols.includes(target_demo_col)) return { error: 'Colonne inconnue: ' + target_demo_col };

    const supabase = createAdminClient();
    console.log(`[chat] analyze_poi_synergy ville=${ville} poi=${poi_category} col=${target_demo_col} dist=${max_distance_m}m`);

    const { data: rpcData, error: rpcErr } = await supabase.rpc('find_synergy_billboards', {
      poi_category,
      ville:          ville ?? null,
      max_distance_m,
      target_demo_col,
      min_audience,
      buffer_radius_m,
    });

    if (rpcErr) {
      const msg = String(rpcErr.message ?? rpcErr);
      if (msg.includes('find_synergy_billboards')) {
        return { error: 'Fonction PostGIS manquante -- executez sql/006_find_synergy_billboards.sql dans Supabase SQL Editor.' };
      }
      return { error: msg };
    }

    if (!Array.isArray(rpcData)) return { error: (rpcData as any)?.error ?? 'Erreur RPC' };

    const rows = rpcData as any[];
    if (rows.length === 0) {
      return { error: `Aucun panneau synergique trouve pour ${poi_category} / ${target_demo_label} (seuil: ${min_audience}).` };
    }

    const pois = rows.map((r: any, i: number) => ({
      id:             String(r.id),
      nom:            r.reference_panneau ?? r.id,
      lat:            Number(r.lat),
      lng:            Number(r.lng),
      categorie:      'panneaux',
      sous_categorie: r.type_panneau ?? null,
      ville:          r.ville ?? undefined,
      adresse:        r.regie ?? undefined,
      rank:           i + 1,
      audience:       Number(r.audience_score),
    }));

    const lats = pois.map((p: any) => p.lat);
    const lngs = pois.map((p: any) => p.lng);
    const coordonnees = {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
    const totalAudience = pois.reduce((s: number, p: any) => s + p.audience, 0);
    console.log(`[chat] analyze_poi_synergy -> ${pois.length} panneaux totalAudience=${totalAudience}`);

    return {
      ville:             `Synergie ${poi_category} x ${target_demo_label}`,
      rayon_metres:      null,
      rayon_poi_metres:  buffer_radius_m,
      coordonnees,
      pois,
      nb_pois:           pois.length,
      categories:        { panneaux: pois.length },
      couleur_overrides: { panneaux: '#f59e0b' },
      _synergy: { poi_category, target_demo_col, target_demo_label, max_distance_m, min_audience, buffer_radius_m, total_audience: totalAudience },
    };
  }

  if (name === 'calculate_network_coverage') {
    const poi_category      = String(args.poi_category      ?? '');
    const travel_time_min   = Number(args.travel_time_minutes ?? 60);
    const target_demo_col   = String(args.target_demo_column  ?? 'ind_18_24');
    const target_demo_label = String(args.target_demo_label   ?? 'Jeunes 18-24 ans');
    const mode              = String(args.mode                ?? 'drive');
    const filtre_region     = args.region      ? String(args.region)      : null;
    const filtre_ville      = args.ville       ? String(args.ville)       : null;
    const filtre_dept       = args.departement ? String(args.departement) : null;

    if (!poi_category) return { error: 'poi_category requis pour calculate_network_coverage.' };

    const knownCols = ['Ind','Ind_0_3','Ind_4_5','Ind_6_10','Ind_11_17','ind_18_24',
      'Ind_25_39','Ind_40_54','Ind_55_64','Ind_65_79','Ind_80p','Men','rev_median'];
    if (!knownCols.includes(target_demo_col)) {
      return { error: `Indicateur inconnu: ${target_demo_col}. Valides: ${knownCols.join(', ')}` };
    }

    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 290_000);
      const res = await fetch(`${baseUrl}/api/network-coverage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body: JSON.stringify({
          poi_category,
          travel_time_minutes: travel_time_min,
          target_demo_column:  target_demo_col,
          target_demo_label,
          mode,
          region:            filtre_region,
          ville:             filtre_ville,
          departement:       filtre_dept,
          force_recalculate: options.forceRecalculate ?? false,
        }),
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        const errText = await res.text();
        let friendlyErr = errText;
        try { friendlyErr = JSON.parse(errText)?.error ?? errText; } catch { /* keep raw */ }
        return { error: friendlyErr };
      }

      const data = await res.json();
      console.log(`[chat/network_coverage] "${poi_category}" scope=${data.geo_scope} → coverage=${data.coverage} poi=${data.nb_pois}`);
      return data;
    } catch (e: any) {
      const msg = e.name === 'AbortError'
        ? 'Timeout (>290s) : trop de POIs à calculer sans cache. Précisez une région pour réduire la portée.'
        : e.message;
      return { error: msg };
    }
  }

  return { error: 'Outil inconnu: ' + name };
}

// =============================================================================
// Définitions des outils (schemas Zod) — injectés dans streamText
// =============================================================================

export function buildTools(
  categoriesList: string[],
  forceRecalculate: boolean
) {
  const catsDesc = `Type exact parmi : ${categoriesList.join(', ')}`;

  return {
    analyser_zone_pois: {
      description:
        "Génère une zone de ciblage géographique sur la carte et recherche les points d'intérêt (POI). " +
        "Appeler dès qu'une localisation et/ou un type de POI sont identifiés.",
      inputSchema: z.object({
        ville:             z.string().optional().describe("Nom de la ville française. Utiliser UNIQUEMENT si l'utilisateur mentionne une ville."),
        region:            z.string().optional().describe("Région française (ex: Bretagne, Normandie, Île-de-France, PACA)."),
        departement:       z.string().optional().describe("Nom ou numéro du département (ex: Finistère, 29)."),
        categorie_poi:     z.string().optional().describe(catsDesc),
        rayon_metres:      z.number().optional().describe("Rayon en mètres autour de la ville, UNIQUEMENT si explicitement demandé."),
        rayon_poi_metres:  z.number().optional().describe("Rayon en mètres à dessiner autour de chaque établissement individuel."),
        isochrone_minutes: z.number().optional().describe("Durée de l'isochrone en minutes. UNIQUEMENT si l'utilisateur demande explicitement un isochrone."),
        isochrone_mode:    z.enum(['walk', 'drive', 'bike']).optional().describe("Mode de transport: walk (défaut), drive, bike."),
        couleur:           z.string().optional().describe("Couleur CSS pour les marqueurs de cette catégorie (ex: '#000000', 'red', '#3b82f6')."),
      }),
      execute: async (args: Record<string, unknown>) =>
        executeToolCall('analyser_zone_pois', args, categoriesList, { forceRecalculate }),
    },

    voronoi_analysis: {
      description:
        "⚡ PRIORITÉ MAXIMALE. Génère les polygones de Voronoï (zones d'influence territoriales) pour une catégorie de POIs. " +
        "OBLIGATOIRE pour : 'Voronoï', 'voronoi', 'territoire(s)', 'zone(s) d\\'influence', 'découpage territorial', 'cellule(s)', 'diagramme'. " +
        "NE PAS confondre avec analyser_zone_pois.",
      inputSchema: z.object({
        category:       z.string().describe(catsDesc),
        ville:          z.string().optional().describe("Ville à analyser. Optionnel — si absent, France entière."),
        region:         z.string().optional().describe("Région à analyser. Optionnel."),
        departement:    z.string().optional().describe("Département ou code. Optionnel."),
        metropolitaine: z.boolean().optional().describe("TRUE (défaut) = France métropolitaine uniquement. FALSE = inclut DROM-COM."),
      }),
      execute: async (args: Record<string, unknown>) =>
        executeToolCall('voronoi_analysis', args, categoriesList, {}),
    },

    afficher_carreaux: {
      description:
        "Affiche une couche choroplèthe de carreaux INSEE Filosofi 200m sur la carte avec un indicateur démographique. " +
        "Appeler quand l'utilisateur veut voir la distribution spatiale d'une variable socio-démographique (âge, revenus, population...).",
      inputSchema: z.object({
        indicateur:       z.string().describe("Nom exact de la colonne Filosofi (ex: ind_18_24, Ind_65_79, ind, rev_median, men)."),
        indicateur_label: z.string().describe("Label lisible en français (ex: Jeunes 18-24 ans, Population totale)."),
        ville:            z.string().optional().describe("Ville sur laquelle centrer la vue."),
      }),
      execute: async (args: Record<string, unknown>) =>
        executeToolCall('afficher_carreaux', args, categoriesList, {}),
    },

    isochrone_battle: {
      description:
        "🔥 Génère la Bataille d'Isochrones : territoires de recrutement basés sur des anneaux de temps réel " +
        "(10/30/60/90/120 min en voiture via ORS). Règle : le plus petit gagne. " +
        "OBLIGATOIRE pour : bataille d'isochrones, anneaux isochrones, territoires de recrutement réels, " +
        "sectorisation routière, qui recrute en moins de Xmin, paliers de temps, zones de chalandise routières. " +
        "Calcul intensif (~1-2 min au 1er appel, puis mis en cache).",
      inputSchema: z.object({
        category:       z.string().describe(catsDesc),
        mode:           z.enum(['drive', 'walk', 'bike']).optional().describe("Mode de transport. Défaut: 'drive'."),
        ville:          z.string().optional().describe("Filtre ville. Optionnel."),
        region:         z.string().optional().describe("Filtre région. Optionnel — RECOMMANDÉ pour limiter les appels ORS."),
        departement:    z.string().optional().describe("Filtre département ou code. Optionnel."),
        metropolitaine: z.boolean().optional().describe("TRUE (défaut) = France métropolitaine. FALSE = inclut DROM-COM."),
        max_minutes:    z.number().optional().describe("Durée max en minutes. Défaut: 120."),
      }),
      execute: async (args: Record<string, unknown>) =>
        executeToolCall('isochrone_battle', args, categoriesList, { forceRecalculate }),
    },

    analyser_panneaux: {
      description:
        "Recherche et affiche des panneaux d'affichage OOH (Out-Of-Home) depuis la table panneaux_affichage. " +
        "OBLIGATOIRE pour : 'panneaux', 'OOH', 'affichage extérieur', 'outdoor', 'Clear Channel', 'JCDecaux', 'Exterion', " +
        "'4x3', 'mobilier urbain', 'abribus', toute régie d'affichage.",
      inputSchema: z.object({
        regie:        z.string().optional().describe("Nom de la régie, partiel accepté (ex: 'Clear Channel', 'JCDecaux')."),
        ville:        z.string().optional().describe("Ville française."),
        region:       z.string().optional().describe("Région française."),
        departement:  z.string().optional().describe("Département ou code (ex: 29, Finistère)."),
        type_panneau: z.string().optional().describe("Type/format du panneau (ex: 4x3, 8x3, abri-bus)."),
        couleur:      z.string().optional().describe("Couleur CSS des marqueurs (défaut: orange #f97316)."),
      }),
      execute: async (args: Record<string, unknown>) =>
        executeToolCall('analyser_panneaux', args, categoriesList, {}),
    },

    classer_panneaux_audience: {
      description:
        "Classe les panneaux d'affichage OOH par audience potentielle d'une cible démographique (ex: 18-24 ans) " +
        "dans un rayon autour de chaque panneau, en croisant panneaux_affichage × carreaux INSEE Filosofi. " +
        "DÉCLENCHER pour : 'panneaux qui touchent le plus de [cible]', 'meilleurs panneaux pour [cible]', " +
        "'top N panneaux [cible]', 'classement panneaux par audience'.",
      inputSchema: z.object({
        ville:         z.string().describe("Ville française (requis)."),
        target_column: z.string().describe("Colonne Filosofi à agréger : ind_18_24, Ind_25_39, ind, ind_65_79, men, etc."),
        target_label:  z.string().describe("Label lisible de la cible (ex: 'Jeunes 18-24 ans')."),
        rayon_metres:  z.number().optional().describe("Rayon en mètres autour de chaque panneau (défaut: 500)."),
        limit:         z.number().optional().describe("Nombre max de panneaux à retourner (défaut: 10, max: 50)."),
        regie:         z.string().optional().describe("Filtrer par régie (partiel, ex: 'JCDecaux')."),
      }),
      execute: async (args: Record<string, unknown>) =>
        executeToolCall('classer_panneaux_audience', args, categoriesList, {}),
    },

    analyze_poi_synergy: {
      description:
        "Trouve les meilleurs panneaux publicitaires situes pres d un POI specifique ET dans une zone a forte densite demographique. " +
        "DECLENCHER OBLIGATOIREMENT pour : 'panneaux pres des lycees', 'panneaux strategiques pres des [POI] pour [cible]', " +
        "'double critere POI + demographic', 'panneaux a forte audience [cible] pres de [POI]'.",
      inputSchema: z.object({
        poi_category:      z.string().describe(catsDesc),
        ville:             z.string().describe("Ville française OBLIGATOIRE (ex: 'Brest', 'Lyon'). Requis pour les performances."),
        target_demo_col:   z.string().describe("Colonne Filosofi : ind_18_24, Ind_25_39, Ind, Ind_65_79, Men, etc."),
        target_demo_label: z.string().describe("Label lisible (ex: 'Jeunes 18-24 ans')."),
        max_distance_m:    z.number().optional().describe("Rayon autour du POI en metres (defaut: 500)."),
        min_audience:      z.number().optional().describe("Audience minimum requise (defaut: 0)."),
        buffer_radius_m:   z.number().optional().describe("Zone de visibilite du panneau en metres (defaut: 300)."),
      }),
      execute: async (args: Record<string, unknown>) =>
        executeToolCall('analyze_poi_synergy', args, categoriesList, {}),
    },

    calculate_audience_coverage: {
      description:
        "Calcule combien de personnes d'une cible précise (jeunes, seniors, population totale…) " +
        "se trouvent dans une zone de temps de trajet autour d'un lieu. " +
        "Génère l'isochrone ORS + requête PostGIS prorata spatial sur les carreaux INSEE. " +
        "DÉCLENCHER pour : 'combien de [cible] dans X min autour de [lieu]', " +
        "'couverture [cible] à X min', 'audience potentielle', 'potentiel de recrutement autour de'.",
      inputSchema: z.object({
        location_name:       z.string().describe("Nom du lieu ou de la ville (ex: 'Brest', 'Paris')."),
        travel_time_minutes: z.number().describe("Durée du trajet en minutes (ex: 15, 30, 60)."),
        target_column:       z.string().describe(
          "Colonne Filosofi à agréger. Options : Ind (population totale), Ind_0_3, Ind_4_5, ind_6_10, " +
          "ind_11_17, ind_18_24, Ind_25_39, ind_40_54, ind_55_64, ind_65_79, ind_80p, men (ménages), rev_median."
        ),
        target_label:        z.string().describe("Nom lisible de la cible en français (ex: 'Jeunes 18-24 ans')."),
        mode:                z.enum(['drive', 'walk', 'bike']).optional().describe("Mode de transport. Défaut: drive."),
      }),
      execute: async (args: Record<string, unknown>) =>
        executeToolCall('calculate_audience_coverage', args, categoriesList, {}),
    },

    calculate_network_coverage: {
      description:
        "Calcule l'empreinte démographique totale d'un réseau de POI (ex: tous les CIRFA de France) " +
        "en calculant l'union de leurs isochrones et en croisant avec les carreaux INSEE Filosofi. " +
        "Retourne la couverture totale + un tableau de bord par POI (audience individuelle, % couverture). " +
        "DÉCLENCHER pour : 'empreinte réseau [POI]', 'portée totale du réseau à Xmin', " +
        "'combien de [cible] couverts par le réseau', 'couverture nationale [POI]', " +
        "'potentiel des [N] [POI] de [lieu]', 'quel est le potentiel de', 'analyse des [POI] de [région]'. " +
        "Calcul intensif — mis en cache automatiquement.",
      inputSchema: z.object({
        poi_category:        z.string().describe(catsDesc),
        travel_time_minutes: z.number().describe("Durée de trajet en minutes (ex: 30, 60, 90)."),
        target_demo_column:  z.string().describe("Colonne Filosofi : ind_18_24, Ind_25_39, Ind_40_54, Ind_65_79, Ind, Men, rev_median."),
        target_demo_label:   z.string().describe("Label lisible (ex: 'Jeunes 18-24 ans')."),
        mode:        z.enum(['drive', 'walk', 'bike']).optional().describe("Mode de transport. Défaut: drive."),
        region:      z.string().optional().describe("Filtre région (ex: 'Bretagne'). RECOMMANDÉ pour limiter le scope et éviter le timeout."),
        ville:       z.string().optional().describe("Filtre ville. Optionnel."),
        departement: z.string().optional().describe("Filtre département ou code. Optionnel."),
      }),
      execute: async (args: Record<string, unknown>) =>
        executeToolCall('calculate_network_coverage', args, categoriesList, { forceRecalculate }),
    },
  };
}
