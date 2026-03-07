import { NextRequest } from 'next/server';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { createMistral } from '@ai-sdk/mistral';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { getDistinctCategories } from '@/lib/poi/categories';
import {
  fetchIsochrones, buildIsochCacheKey, ORS_MAX_POIS_CHAT, ORS_PROFILES,
  type PoiRow, type IsochroneCacheCtx,
} from '@/lib/isochrones/fetcher';
import {
  CITY_BASE_RADIUS, getCoordsForVille, getCoordsForRegion, normVille, resolveCategory,
} from '@/lib/geo/locations';
import postgresLib from 'postgres';
import {
  hasDatagouvKeywords, loadDatagouvTools, DATAGOUV_SYSTEM_ADDENDUM,
} from '@/lib/mcp/datagouv';

// Timeout étendu pour les retries ORS (rate limit 20s × max 3 × N batches)
export const maxDuration = 120;

// ── Rate limiter in-memory (12 req/min/IP) ────────────────────────────────────
const RL_MAP = new Map<string, { count: number; resetAt: number }>();
const RL_MAX = 12;
const RL_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): { ok: boolean; retrySec: number } {
  const now = Date.now();
  const e   = RL_MAP.get(ip);
  if (!e || now >= e.resetAt) {
    RL_MAP.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true, retrySec: 0 };
  }
  if (e.count >= RL_MAX) {
    return { ok: false, retrySec: Math.ceil((e.resetAt - now) / 1000) };
  }
  e.count++;
  return { ok: true, retrySec: 0 };
}




// =============================================================================
// Exécution des outils (server-side, async)
// =============================================================================

async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  validCategories: string[],
  options: { forceRecalculate?: boolean } = {}
) {
  if (name === 'analyser_zone_pois') {
    const ville = args.ville ? String(args.ville) : undefined;
    const region = args.region ? String(args.region) : undefined;
    const departement = args.departement ? String(args.departement) : undefined;
    const categorie_poi = args.categorie_poi ? String(args.categorie_poi) : undefined;
    const rayonRaw = args.rayon_metres != null ? Number(args.rayon_metres) : null;
    const rayon_metres = rayonRaw && rayonRaw > 0 ? rayonRaw : null;
    const rayonPoiRaw = args.rayon_poi_metres != null ? Number(args.rayon_poi_metres) : null;
    const rayon_poi_metres = rayonPoiRaw && rayonPoiRaw > 0 ? rayonPoiRaw : null;

    const isochrone_minutes_raw = args.isochrone_minutes != null ? Number(args.isochrone_minutes) : null;
    const isochrone_minutes = isochrone_minutes_raw && isochrone_minutes_raw > 0 ? isochrone_minutes_raw : null;
    const isochrone_mode = args.isochrone_mode ? String(args.isochrone_mode) : 'walk';
    const couleur = args.couleur ? String(args.couleur) : undefined;

    // Déterminer les coordonnées de centrage (ville ou capitale régionale)
    const coordonnees = ville
      ? getCoordsForVille(ville)
      : region
        ? getCoordsForRegion(region)
        : { lat: 48.8566, lng: 2.3522 };

    // Résoudre la catégorie contre les valeurs réelles
    const resolvedCategory = resolveCategory(categorie_poi, validCategories);
    if (categorie_poi && !resolvedCategory) {
      console.warn(`[chat] Catégorie inconnue: "${categorie_poi}" (valides: ${validCategories.join(', ')})`);
    }

    const supabase = createAdminClient();
    const poisMap = new Map<string, PoiRow>();

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

    const SELECT_COLS = 'id, nom, lat, lng, categorie, sous_categorie, adresse, ville, region, departement';

    try {
      // ── Requête par REGION (ex: "les CIRFA de Bretagne") ──────────────
      if (region) {
        const regionNorm = region.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        let qr = supabase
          .from('poi_france')
          .select(SELECT_COLS)
          .ilike('region', `%${regionNorm}%`);
        if (resolvedCategory) qr = qr.eq('categorie', resolvedCategory);
        const { data: regionData, error: regionErr } = await qr.limit(2000);
        if (regionErr) console.error('[chat] region error:', regionErr.message);
        else addRows(regionData ?? []);

        // Fallback: si l'IA a passé un nom de région dans le champ ville
        if (poisMap.size === 0) {
          let qrv = supabase.from('poi_france').select(SELECT_COLS).ilike('ville', `%${regionNorm}%`);
          if (resolvedCategory) qrv = qrv.eq('categorie', resolvedCategory);
          const { data: rvData } = await qrv.limit(2000);
          if (rvData?.length) console.log(`[chat] region→ville fallback: ${rvData.length} résultats pour "${region}"`);
          addRows(rvData ?? []);
        }
      }

      // ── Requête par DEPARTEMENT (ex: "les lycées du 35") ──────────────
      if (departement) {
        let qd = supabase
          .from('poi_france')
          .select(SELECT_COLS)
          .or(`departement.ilike.%${departement}%,code_departement.eq.${departement}`);
        if (resolvedCategory) qd = qd.eq('categorie', resolvedCategory);
        const { data: deptData, error: deptErr } = await qd.limit(2000);
        if (deptErr) console.error('[chat] dept error:', deptErr.message);
        else addRows(deptData ?? []);
      }

      // ── Requête par VILLE (ex: "les CIRFA à Rennes") ──────────────────
      if (ville) {
        const villeKey = normVille(ville);
        let q1 = supabase
          .from('poi_france')
          .select(SELECT_COLS)
          .ilike('ville', `%${villeKey}%`);
        if (resolvedCategory) q1 = q1.eq('categorie', resolvedCategory);
        const { data: villeData, error: villeErr } = await q1.limit(1000);
        if (villeErr) console.error('[chat] ilike error:', villeErr.message);
        else addRows(villeData ?? []);

        // Fallback: si l'IA a passé un nom de région dans le champ ville
        if (poisMap.size === 0 && !region) {
          let qvr = supabase.from('poi_france').select(SELECT_COLS).ilike('region', `%${villeKey}%`);
          if (resolvedCategory) qvr = qvr.eq('categorie', resolvedCategory);
          const { data: vrData } = await qvr.limit(2000);
          if (vrData?.length) console.log(`[chat] ville→region fallback: ${vrData.length} résultats pour "${ville}"`);
          addRows(vrData ?? []);
        }

        // Bounding box élargi si un rayon est spécifié
        if (rayon_metres) {
          const cityBase = CITY_BASE_RADIUS[villeKey] ?? 3000;
          const effectiveRadius = cityBase + rayon_metres;
          const dlat = effectiveRadius / 111000;
          const dlng = effectiveRadius / (111000 * Math.cos((coordonnees.lat * Math.PI) / 180));
          let q2 = supabase
            .from('poi_france')
            .select(SELECT_COLS)
            .gte('lat', coordonnees.lat - dlat)
            .lte('lat', coordonnees.lat + dlat)
            .gte('lng', coordonnees.lng - dlng)
            .lte('lng', coordonnees.lng + dlng);
          if (resolvedCategory) q2 = q2.eq('categorie', resolvedCategory);
          const { data: bboxData, error: bboxErr } = await q2.limit(500);
          if (bboxErr) console.error('[chat] bbox error:', bboxErr.message);
          else addRows(bboxData ?? []);
        }
      }

      // ── Fallback: Si ni ville, ni region, ni departement → tout ───────
      if (!ville && !region && !departement) {
        let qAll = supabase
          .from('poi_france')
          .select(SELECT_COLS);
        if (resolvedCategory) qAll = qAll.eq('categorie', resolvedCategory);
        const { data: allData, error: allErr } = await qAll.limit(2000);
        if (allErr) console.error('[chat] all error:', allErr.message);
        else addRows(allData ?? []);
      }
    } catch (e: any) {
      console.error('[chat] Supabase exception:', e.message);
    }

    const pois = Array.from(poisMap.values());

    // Comptage par catégorie
    const categories: Record<string, number> = {};
    for (const p of pois) {
      const cat = p.categorie || 'autre';
      categories[cat] = (categories[cat] ?? 0) + 1;
    }

    const locationLabel = ville ?? region ?? departement ?? 'France';

    // Isochrones (si demandé et POIs disponibles)
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
    // Construire couleur_overrides si une couleur est spécifiée
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
    const category      = args.category    ? String(args.category)    : '';
    if (!category) return { error: 'category requis pour voronoi_analysis' };

    const metropolitaine   = args.metropolitaine !== false;
    const filtre_ville     = args.ville        ? String(args.ville)        : null;
    const filtre_region    = args.region       ? String(args.region)       : null;
    const filtre_dept      = args.departement  ? String(args.departement)  : null;

    // Ne passer les params optionnels QUE s'ils ont une valeur réelle —
    // rétrocompat si la fonction SQL n'a pas encore les 5 paramètres
    const rpcArgs: Record<string, unknown> = { cat_name: category, metropolitaine };
    if (filtre_ville)  rpcArgs.filtre_ville       = filtre_ville;
    if (filtre_region) rpcArgs.filtre_region      = filtre_region;
    if (filtre_dept)   rpcArgs.filtre_departement = filtre_dept;

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_voronoi_by_category', rpcArgs);

    if (error) {
      console.error('[chat/voronoi] RPC error:', error.message);
      // Retourner l'erreur pour que Mistral puisse l'expliquer à l'utilisateur
      return { error: error.message, nb_polygones: 0, category };
    }

    const features = Array.isArray(data) ? data : [];
    console.log(`[chat/voronoi] "${category}" metro=${metropolitaine} ville=${filtre_ville} region=${filtre_region} dept=${filtre_dept} → ${features.length} polygones`);

    // Extraire les POIs depuis les properties pour les afficher comme markers
    const pois = features
      .map((f: any) => ({
        id:           f?.properties?.id        ?? String(Math.random()),
        nom:          f?.properties?.nom       ?? 'Inconnu',
        lat:          Number(f?.properties?.lat ?? 0),
        lng:          Number(f?.properties?.lng ?? 0),
        categorie:    f?.properties?.categorie ?? category,
        adresse:      f?.properties?.adresse   ?? undefined,
        ville:        f?.properties?.ville     ?? undefined,
      }))
      .filter((p: any) => p.lat !== 0 && p.lng !== 0);

    const locationLabel = filtre_ville ?? filtre_region ?? filtre_dept
      ?? (metropolitaine ? 'France métropolitaine' : 'France');

    // ZoneData compatible avec le copilote (affichage canvas markers)
    const coordonnees = pois.length > 0
      ? {
          lat: pois.reduce((s: number, p: any) => s + p.lat, 0) / pois.length,
          lng: pois.reduce((s: number, p: any) => s + p.lng, 0) / pois.length,
        }
      : { lat: 46.8, lng: 2.3 };

    const poisForMap = {
      ville:          locationLabel,
      region:         filtre_region ?? null,
      departement:    filtre_dept   ?? null,
      categorie_poi:  category,
      rayon_metres:   null,
      rayon_poi_metres: null,
      coordonnees,
      pois,
      nb_pois:        pois.length,
      categories:     { [category]: pois.length },
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
    // Valider l'indicateur contre les connus, fallback si inconnu
    const known = CHORO_INDICATORS[indicateur];
    const resolvedCol   = known?.col   ?? indicateur;
    const resolvedLabel = args.indicateur_label
      ? String(args.indicateur_label)
      : (known?.label ?? indicateur);

    const ville = args.ville ? String(args.ville) : undefined;
    const coordonnees = ville ? getCoordsForVille(ville) : { lat: 48.3904, lng: -4.4861 }; // Brest par défaut

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

    const mode              = args.mode          ? String(args.mode)          : 'drive';
    const metropolitaine    = args.metropolitaine !== false;
    const filtre_ville      = args.ville         ? String(args.ville)         : null;
    const filtre_region     = args.region        ? String(args.region)        : null;
    const filtre_dept       = args.departement   ? String(args.departement)   : null;
    const max_minutes       = args.max_minutes   ? Number(args.max_minutes)   : 120;

    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      // Timeout 280s (légèrement sous maxDuration=300 de la route battle)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 280_000);
      const res = await fetch(`${baseUrl}/api/isochrone-battle`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body: JSON.stringify({
          category,
          mode,
          metropolitaine,
          filtre_ville,
          filtre_region,
          filtre_departement: filtre_dept,
          force_recalculate: (args as any).forceRecalculate ?? false,
          max_minutes,
        }),
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        const errText = await res.text();
        console.error('[chat/isochrone_battle] Erreur endpoint HTTP', res.status, ':', errText);
        // Extraire le message JSON si possible
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
    const regie       = args.regie       ? String(args.regie)       : undefined;
    const ville       = args.ville       ? String(args.ville)       : undefined;
    const region      = args.region      ? String(args.region)      : undefined;
    const departement = args.departement ? String(args.departement) : undefined;
    const type_panneau= args.type_panneau? String(args.type_panneau): undefined;
    const couleur     = args.couleur     ? String(args.couleur)     : '#f97316'; // orange OOH

    const supabase = createAdminClient();
    let q: any = supabase
      .from('panneaux_affichage')
      .select('id, lat, lng, reference_panneau, regie, type_panneau, ville, departement, code_departement, region')
      .eq('actif', true);

    if (regie)        q = q.ilike('regie', `%${regie}%`);
    if (ville)        q = q.ilike('ville', `%${ville}%`);
    if (region)       q = q.ilike('region', `%${region}%`);
    if (departement)  q = q.or(`departement.ilike.%${departement}%,code_departement.eq.${departement}`);
    if (type_panneau) q = q.ilike('type_panneau', `%${type_panneau}%`);

    const { data, error } = await q.limit(5000);
    if (error) return { error: error.message };

    const pois = (data ?? []).map((p: any) => ({
      id:             p.id,
      nom:            p.reference_panneau ?? p.id,
      lat:            Number(p.lat),
      lng:            Number(p.lng),
      categorie:      'panneaux',
      sous_categorie: p.type_panneau ?? null,
      ville:          p.ville ?? undefined,
      adresse:        p.regie ?? undefined, // régie → champ adresse pour l'affichage
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
    const location_name        = String(args.location_name ?? '');
    const travel_time_minutes  = Number(args.travel_time_minutes ?? 30);
    const target_column        = String(args.target_column ?? 'Ind');
    const target_label         = String(args.target_label ?? 'Population totale');
    const mode                 = String(args.mode ?? 'drive');

    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) return { error: 'ORS_API_KEY non configurée — impossible de calculer l\'isochrone.' };

    // ── 1. Géocodage via BAN ─────────────────────────────────────────────
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

    // ── 2. Isochrone ORS point unique ────────────────────────────────────
    const profile = ORS_PROFILES[mode] ?? 'driving-car';
    let isoFeature: any = null;
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
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
      return { error: e.name === 'AbortError' ? 'Timeout ORS (12s)' : e.message };
    }

    // ── 3. Résolution/Millésime depuis data_sources ───────────────────────
    const supabase = createAdminClient();
    const { data: sources } = await supabase
      .from('data_sources')
      .select('geo_config')
      .eq('type', 'carreaux')
      .limit(1);
    const cfg        = (sources?.[0]?.geo_config as any) ?? {};
    const resolution = cfg.resolution ?? '200m';
    const millesime  = cfg.millesime  ?? '2021';

    // ── 4. Calcul couverture RPC PostGIS ─────────────────────────────────
    const isoGeoJSON = JSON.stringify(isoFeature.geometry);
    const { data: coverage, error: rpcErr } = await supabase.rpc('calculate_target_coverage', {
      isochrone_geojson: isoGeoJSON,
      target_column,
      p_resolution:      resolution,
      p_millesime:       millesime,
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

    // Validate target_col against known indicators
    const knownCols = ['Ind', 'Ind_0_3', 'Ind_4_5', 'Ind_6_10', 'Ind_11_17', 'ind_18_24',
      'Ind_25_39', 'Ind_40_54', 'Ind_55_64', 'Ind_65_79', 'Ind_80p', 'Men', 'rev_median'];
    if (!knownCols.includes(target_col)) {
      return { error: `Indicateur inconnu: ${target_col}. Valides: ${knownCols.join(', ')}` };
    }

    const dbUrl = process.env.SUPABASE_DB_URL;
    if (!dbUrl) return { error: 'SUPABASE_DB_URL non configurée.' };
    const sql = postgresLib(dbUrl, { max: 2, idle_timeout: 20 });

    try {
      // Step 1: Get panneaux in the city via Supabase (PostgREST-cached table)
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

      // Step 2: Compute bbox around all panneaux + buffer for spatial pre-filter
      const bufferDeg = (rayon_m / 111320) * 1.2;
      const cosLat = Math.cos(panneaux[0].lat * Math.PI / 180);
      const minLat = Math.min(...panneaux.map((p: any) => p.lat)) - bufferDeg;
      const maxLat = Math.max(...panneaux.map((p: any) => p.lat)) + bufferDeg;
      const minLng = Math.min(...panneaux.map((p: any) => p.lng)) - bufferDeg / cosLat;
      const maxLng = Math.max(...panneaux.map((p: any) => p.lng)) + bufferDeg / cosLat;

      // Step 3: Fetch max millesime (fast with idx_carreaux_millesime index)
      const [{ max: latestMillesime }] = await sql`SELECT MAX(millesime) AS max FROM carreaux_filosofi`;

      // Step 4: Fetch all carreaux centroids + values in bbox (fast with GIST index)
      const carreaux = await sql.unsafe(`
        SELECT ST_X(ST_Centroid(geom)) AS cx,
               ST_Y(ST_Centroid(geom)) AS cy,
               (metadata->>$1)::numeric AS val
        FROM carreaux_filosofi
        WHERE millesime = $6
          AND geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
          AND metadata ? $1
      `, [target_col, minLng, minLat, maxLng, maxLat, latestMillesime]);

      // Step 5: Score each panneau in JS using Haversine distance (very fast)
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
          rank:       i + 1,
          id:         p.id,
          nom:        p.reference_panneau ?? p.id,
          regie:      p.regie,
          type:       p.type_panneau,
          lat:        p.lat,
          lng:        p.lng,
          ville:      p.ville,
          audience:   p.audience,
          categorie:  'panneaux',
          sous_categorie: p.type_panneau ?? null,
          adresse:    p.regie ?? undefined,
        }));

      const totalAudience = ranked.reduce((s: number, p: any) => s + p.audience, 0);

      // Center on bbox center of all ranked panneaux
      const rLats = ranked.map((p: any) => p.lat);
      const rLngs = ranked.map((p: any) => p.lng);
      const coordonnees = ranked.length > 0
        ? { lat: (Math.min(...rLats) + Math.max(...rLats)) / 2, lng: (Math.min(...rLngs) + Math.max(...rLngs)) / 2 }
        : getCoordsForVille(ville) ?? { lat: 46.8, lng: 2.3 };

      console.log(`[chat] classer_panneaux_audience(${ville}, ${target_col}, ${rayon_m}m, top${limit_n}) → ${ranked.length} panneaux, total=${totalAudience}`);

      return {
        ville:           ville,
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
    if (!knownCols.includes(target_demo_col)) {
      return { error: 'Colonne inconnue: ' + target_demo_col };
    }

    const supabase = createAdminClient();
    console.log('[chat] analyze_poi_synergy ville=' + ville + ' poi=' + poi_category + ' col=' + target_demo_col + ' dist=' + max_distance_m + 'm');

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

    if (!Array.isArray(rpcData)) {
      return { error: (rpcData as any)?.error ?? 'Erreur RPC' };
    }

    const rows = rpcData as any[];
    if (rows.length === 0) {
      return { error: 'Aucun panneau synergique trouve pour ' + poi_category + ' / ' + target_demo_label + ' (seuil: ' + min_audience + ').' };
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
    console.log('[chat] analyze_poi_synergy -> ' + pois.length + ' panneaux totalAudience=' + totalAudience);

    return {
      ville:             'Synergie ' + poi_category + ' x ' + target_demo_label,
      rayon_metres:      null,
      rayon_poi_metres:  buffer_radius_m,
      coordonnees,
      pois,
      nb_pois:           pois.length,
      categories:        { panneaux: pois.length },
      couleur_overrides: { panneaux: '#f59e0b' },
      _synergy: {
        poi_category,
        target_demo_col,
        target_demo_label,
        max_distance_m,
        min_audience,
        buffer_radius_m,
        total_audience: totalAudience,
      },
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

    // Déléguer à /api/network-coverage (maxDuration=300) — comme isochrone_battle
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
          region:           filtre_region,
          ville:            filtre_ville,
          departement:      filtre_dept,
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

// Mapping : terme naturel → colonne Filosofi + label FR
// Termes PRÉCIS → appel direct. Termes AMBIGUS → Mistral doit demander.
const CHORO_INDICATORS: Record<string, { col: string; label: string }> = {
  'ind':        { col: 'Ind',        label: 'Population totale' },  // legacy lowercase
  'Ind':        { col: 'Ind',        label: 'Population totale' },
  'Ind_0_3':    { col: 'Ind_0_3',    label: 'Enfants 0-3 ans' },
  'Ind_4_5':    { col: 'Ind_4_5',    label: 'Enfants 4-5 ans' },
  'Ind_6_10':   { col: 'Ind_6_10',   label: 'Enfants 6-10 ans' },
  'Ind_11_17':  { col: 'Ind_11_17',  label: 'Adolescents 11-17 ans' },
  'ind_18_24':  { col: 'ind_18_24',  label: 'Jeunes 18-24 ans' },
  'Ind_25_39':  { col: 'Ind_25_39',  label: 'Adultes 25-39 ans' },
  'Ind_40_54':  { col: 'Ind_40_54',  label: 'Adultes 40-54 ans' },
  'Ind_55_64':  { col: 'Ind_55_64',  label: 'Seniors 55-64 ans' },
  'Ind_65_79':  { col: 'Ind_65_79',  label: 'Seniors 65-79 ans' },
  'Ind_80p':    { col: 'Ind_80p',    label: 'Personnes 80 ans et +' },
  'Men':        { col: 'Men',        label: 'Nombre de ménages' },
  'rev_median': { col: 'rev_median', label: 'Revenu médian' },
};

// =============================================================================
// Construction dynamique du system prompt et des outils
// =============================================================================

function buildSystemPrompt(categoriesList: string[]): string {
  const catsFormatted = categoriesList.map(c => `"${c}"`).join(', ');

  return `Tu es un assistant de recherche géographique et media planning. Tu aides à trouver des POI et des données démographiques sur carte.

CATÉGORIES DE POI DISPONIBLES EN BASE: ${catsFormatted}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLE DE PRIORITÉ ABSOLUE — ROUTAGE DES OUTILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SI l'utilisateur dit l'un de ces mots : "Voronoï", "voronoi", "territoire(s)", "zone d'influence", "découpage territorial", "cellule", "diagramme"
→ TOUJOURS appeler voronoi_analysis. JAMAIS analyser_zone_pois.

SI l utilisateur dit "panneaux strategiques", "synergie POI", "double critere POI + audience"
-> analyze_poi_synergy

SI l'utilisateur dit "panneaux", "OOH", "affichage extérieur", "outdoor", "4x3", "abri-bus", "mobilier urbain", "régie", "Clear Channel", "JCDecaux", "Exterion", "Médiatransports", "afficheurs"
→ TOUJOURS analyser_panneaux. JAMAIS analyser_zone_pois.

SI l'utilisateur dit "montre les XXX", "affiche les XXX", "trouve les XXX" sans "territoire/voronoï" ni "panneau/OOH"
→ analyser_zone_pois

SI l'utilisateur dit "carreaux", "18-24 ans", "revenus", "population", "densité"
→ afficher_carreaux

SI l'utilisateur dit "couverture réseau", "couverture CIRFA", "couverture lycée", "empreinte réseau", "portée réseau", "combien de [cible] couverts par les [POI]", "combien de [cible] touchés par les [POI]", "combien de [cible] dans un rayon de X min des [POI]"
→ TOUJOURS calculate_network_coverage. JAMAIS analyser_zone_pois.

SI l'utilisateur dit "isochrone", "X min à pied/voiture/vélo" SANS mentionner "couverture réseau" ou "empreinte"
→ ajouter isochrone_minutes/isochrone_mode à analyser_zone_pois
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

═══ OUTIL 1 : analyser_zone_pois ═══
Appelle cet outil quand l'utilisateur demande des établissements/lieux à afficher sous forme de marqueurs sur la carte.
⚠️ NE PAS utiliser si l'utilisateur mentionne "Voronoï", "territoire", "zone d'influence" ou "découpage" → utiliser voronoi_analysis à la place.

PARAMÈTRES DE LOCALISATION (au moins un requis):
- ville : ville française (ex: "Lyon", "Brest")
- region : région française (ex: "Bretagne", "Normandie", "Île-de-France")
- departement : département (ex: "Finistère", "29")
- categorie_poi : type EXACT parmi ${catsFormatted}

PARAMÈTRE COULEUR (optionnel):
- couleur : couleur CSS pour les marqueurs (ex: "#000000", "red", "#3b82f6", "orange")
- Utiliser UNIQUEMENT si l'utilisateur mentionne explicitement une couleur
- Accepte tout format CSS : hex, rgb, noms anglais (black, red, blue, green, orange, purple…)

EXEMPLES POI:
- "les CIRFA de Bretagne" → region: "Bretagne", categorie_poi: "cirfa"
- "les lycées de Brest" → ville: "Brest", categorie_poi: "lycee"
- "lycées et CIRFA à Brest" → DEUX appels : (1) ville:"Brest", cat:"lycee" ET (2) ville:"Brest", cat:"cirfa"
- "lycées en noir à Brest" → ville:"Brest", cat:"lycee", couleur:"#000000"
- "CIRFA en bleu, lycées en vert" → appel 1: cat:"cirfa", couleur:"#3b82f6" ; appel 2: cat:"lycee", couleur:"#22c55e"

═══ OUTIL 2 : afficher_carreaux ═══
Appelle cet outil quand l'utilisateur veut voir des données démographiques/sociales par carreau INSEE 200m.

TERMES PRÉCIS → appelle directement afficher_carreaux:
- "18-24 ans", "ind_18_24", "18 à 24" → indicateur: "ind_18_24", label: "Jeunes 18-24 ans"
- "25-39 ans" → indicateur: "Ind_25_39", label: "Adultes 25-39 ans"
- "11-17 ans", "collégiens/lycéens âge" → indicateur: "Ind_11_17", label: "Adolescents 11-17 ans"
- "65-79 ans", "retraités" → indicateur: "Ind_65_79", label: "Seniors 65-79 ans"
- "80 ans et plus" → indicateur: "Ind_80p", label: "Personnes 80 ans et +"
- "population", "habitants" → indicateur: "Ind", label: "Population totale"
- "revenus", "niveau de vie", "CSP+" → indicateur: "rev_median", label: "Revenu médian"
- "ménages", "familles" → indicateur: "Men", label: "Nombre de ménages"

TERMES AMBIGUS → pose une question de clarification AVANT d'appeler afficher_carreaux:
- "jeunes" → réponds : "Par 'jeunes', vous visez les 18-24 ans ? (ou les 11-17 ans, 25-39 ans ?)"
- "enfants" → réponds : "Enfants de quel âge ? (0-3 ans, 4-5 ans, 6-10 ans, ou 11-17 ans ?)"
- "personnes âgées", "seniors" → réponds : "Seniors de quel âge ? (55-64, 65-79, ou 80+ ?)"
- "actifs" → réponds : "Actifs 25-39 ans ou 40-54 ans ?"

EXEMPLES CARREAUX:
- "montre les 18-24 ans à Brest" → afficher_carreaux(indicateur:"ind_18_24", label:"Jeunes 18-24 ans", ville:"Brest")
- "lycées + ind_18_24 à Brest" → analyser_zone_pois(ville:"Brest", cat:"lycee") ET afficher_carreaux(ind:"ind_18_24", label:"Jeunes 18-24 ans", ville:"Brest")
- "montre les jeunes" → NE PAS appeler afficher_carreaux. Répondre: "Par 'jeunes', vous pensez aux 18-24 ans ?"

═══ OUTIL 3 : voronoi_analysis ═══
⚡ PRIORITÉ MAXIMALE — Appelle cet outil DÈS QUE l'un de ces mots apparaît (SANS "routier" ni "temps de trajet") :
  "Voronoï", "voronoi", "territoire(s)", "zone d'influence", "découpage", "cellule(s)", "diagramme"
Voronoï GÉOMÉTRIQUE : distance à vol d'oiseau, résultat instantané.
Accepte un filtre région/ville/département optionnel.

COMPORTEMENT PAR DÉFAUT (metropolitaine=true) :
- France métropolitaine uniquement. Les DROM-COM (Guadeloupe, Martinique, Guyane, Réunion, Mayotte…) sont EXCLUS.
- Dans ta réponse texte, TOUJOURS mentionner : "DROM-COM exclus — précisez si vous souhaitez les inclure."

DROM-COM demandés explicitement (metropolitaine=false) :
- Si l'utilisateur dit "DROM-COM", "outre-mer", "Guadeloupe", "Martinique", etc. → metropolitaine=false

EXEMPLES OBLIGATOIRES → voronoi_analysis:
- "Fais le Voronoï des CIRFA" → voronoi_analysis(category:"cirfa")
- "Zone d'influence des lycées" → voronoi_analysis(category:"lycee")
- "Montre les territoires des CIRFA de France" → voronoi_analysis(category:"cirfa")
- "Voronoï des CIRFA de Bretagne" → voronoi_analysis(category:"cirfa", region:"Bretagne")
- "Territoires CIRFA à Brest" → voronoi_analysis(category:"cirfa", ville:"Brest")
- "Zone d'influence CIRFA département 29" → voronoi_analysis(category:"cirfa", departement:"29")
- "Voronoï CIRFA outre-mer" → voronoi_analysis(category:"cirfa", metropolitaine:false)

═══ OUTIL 4 : isochrone_battle ═══
🔥 Appelle cet outil quand l'utilisateur demande la "Bataille d'Isochrones", des "anneaux de temps réel",
   des "territoires de recrutement par paliers", le "Voronoï routier", ou toute sectorisation basée sur le temps de trajet routier.
⚡ "voronoï routier", "voronoi routier" → TOUJOURS → isochrone_battle (jamais voronoi_analysis)
Règle : "le plus petit gagne" — chaque zone est attribuée au CIRFA/POI le plus proche en minutes réelles.
Paliers calculés : 10, 30, 60, 90, 120 min en voiture (mode drive par défaut).
⚠️ Avant d'appeler l'outil, avertir l'utilisateur : "Calcul en cours (~1-2 min au 1er appel, puis mis en cache)."
⚠️ TOUJOURS appeler l'outil IMMÉDIATEMENT. NE JAMAIS demander de confirmation. L'utilisateur sait que c'est long.

FILTRES ORS (passer si mentionnés, sinon France entière) :
→ Si l'utilisateur précise une région, département ou ville : TOUJOURS passer le filtre correspondant.
→ "France métropolitaine" ou sans filtre = metropolitaine:true, pas de filtre ville/région/dept.
→ NE JAMAIS bloquer l'appel pour demander confirmation.

🚨 GESTION D'ERREUR ABSOLUE : Si l'outil retourne { "error": "..." }, tu DOIS reproduire le message
   d'erreur EXACTEMENT mot pour mot à l'utilisateur. NE JAMAIS dire seulement "Je n'ai pas réussi".
   Exemple : si error = "ORS n'a retourné aucun isochrone. Vérifier ORS_API_KEY", dire exactement ça.

DIFFÉRENCE avec voronoi_analysis :
- voronoi_analysis = distance euclidienne, instantané, pas d'API ORS
- isochrone_battle  = temps de trajet réel, anneaux 10→120 min, consomme des crédits ORS

EXEMPLES OBLIGATOIRES → isochrone_battle :
- "Bataille d'isochrones des CIRFA" → isochrone_battle(category:"cirfa") + avertir durée
- "Bataille d'isochrones des CIRFA de France métropolitaine" → isochrone_battle(category:"cirfa", metropolitaine:true)
- "Territoires de recrutement réels des CIRFA de Bretagne" → isochrone_battle(category:"cirfa", region:"Bretagne")
- "Anneaux isochrones CIRFA du 29" → isochrone_battle(category:"cirfa", departement:"29")
- "Sectorisation routière CIRFA Normandie" → isochrone_battle(category:"cirfa", region:"Normandie")
- "Qui recrute en moins de 30 min ?" → isochrone_battle(category:"cirfa")
- "Zones de chalandise routières des lycées" → isochrone_battle(category:"lycee")
- "Voronoï routier des CIRFA de Bretagne" → isochrone_battle(category:"cirfa", region:"Bretagne")
- "Voronoï routier CIRFA" → isochrone_battle(category:"cirfa")
- "Affiche le voronoï routier des CIRFA" → isochrone_battle(category:"cirfa")
- "Voronoi routier lycées" → isochrone_battle(category:"lycee")

═══ ISOCHRONES ═══
Si l'utilisateur mentionne "isochrone", "X minutes à pied/voiture/vélo", "zone de chalandise", "zone accessible en X min" :
→ Ajouter isochrone_minutes + isochrone_mode à analyser_zone_pois

EXEMPLES ISOCHRONES:
- "isochrone 5 min à pied autour des lycées à Brest" → analyser_zone_pois(ville:"Brest", cat:"lycee", isochrone_minutes:5, isochrone_mode:"walk")
- "30 min en voiture depuis les CIRFA de Lyon" → analyser_zone_pois(ville:"Lyon", cat:"cirfa", isochrone_minutes:30, isochrone_mode:"drive")
- "zone à vélo 15 min autour des gares" → isochrone_mode:"bike", isochrone_minutes:15

NE PAS ajouter isochrone si non demandé explicitement.

═══ OUTIL 5 : analyser_panneaux ═══
Appelle cet outil pour afficher des panneaux d'affichage OOH (Out-Of-Home) sur la carte.
Données : table panneaux_affichage (référence, régie, type, coordonnées GPS).

DÉCLENCHER pour :
- "panneaux", "OOH", "affichage extérieur", "outdoor", "mobilier urbain"
- Toute régie : "Clear Channel", "JCDecaux", "Exterion", "Médiatransports", "Abris Publicitaires"…
- "4x3", "2m²", "abribus", "face A", "enseigne"

FILTRES disponibles (tous optionnels) :
- regie : nom partiel de la régie (ex: "Clear Channel", "JCDecaux")
- ville / region / departement : filtre géographique
- type_panneau : format du panneau (ex: "4x3", "8x3")
- couleur : couleur des marqueurs (défaut: orange #f97316)

EXEMPLES OBLIGATOIRES → analyser_panneaux :
- "Panneaux Clear Channel à Paris" → analyser_panneaux(regie:"Clear Channel", ville:"Paris")
- "OOH en Bretagne" → analyser_panneaux(region:"Bretagne")
- "Affiche les panneaux 4x3 à Lyon" → analyser_panneaux(type_panneau:"4x3", ville:"Lyon")
- "Tous les panneaux OOH de France" → analyser_panneaux()
- "Panneaux JCDecaux du 75" → analyser_panneaux(regie:"JCDecaux", departement:"75")
- "OOH + lycées à Brest" → analyser_panneaux(ville:"Brest") ET analyser_zone_pois(ville:"Brest", cat:"lycee")

═══ OUTIL 6 : classer_panneaux_audience ═══
Classe les panneaux d'affichage par audience potentielle d'une cible démographique dans un rayon donné.
Croise les panneaux (panneaux_affichage) avec les carreaux INSEE (carreaux_filosofi).

DÉCLENCHER OBLIGATOIREMENT pour :
- "panneaux qui touchent le plus de [cible]"
- "meilleurs panneaux pour [cible]"
- "classement panneaux par audience [cible]"
- "top 10 panneaux pour les 18-24 ans"
- "panneaux avec le plus de [cible] dans un rayon de X mètres"
- "quels panneaux couvrent le plus de [cible] à [ville]"

MAPPING target_column (même logique) :
- "18-24 ans", "jeunes" → ind_18_24, label "Jeunes 18-24 ans"
- "25-39 ans" → Ind_25_39, label "Adultes 25-39 ans"
- "population", "habitants" → Ind, label "Population totale"
- "65-79 ans", "seniors" → Ind_65_79, label "Seniors 65-79 ans"
- "ménages" → Men, label "Nombre de ménages"

FORMAT DE RÉPONSE OBLIGATOIRE (quand l'outil retourne des résultats) :
1. Résumé : "Voici les N meilleurs panneaux à [ville] pour [target_label] (rayon [rayon]m) :"
2. Tableau avec pour chaque panneau : rang, nom/référence, régie, type, audience (nombre de personnes dans le rayon)
3. Récapitulatif : total audience cumulée, et une analyse rapide (ex: "les panneaux sont concentrés dans le centre-ville")
Les panneaux sont affichés sur la carte avec leurs zones de couverture (cercles).

EXEMPLES → classer_panneaux_audience :
- "Top 10 panneaux pour les jeunes 18-24 ans à Brest dans 500m" → classer_panneaux_audience(ville:"Brest", target_column:"ind_18_24", target_label:"Jeunes 18-24 ans", rayon_metres:500, limit:10)
- "Meilleurs panneaux JCDecaux pour la pop totale à Lyon, rayon 300m" → classer_panneaux_audience(ville:"Lyon", regie:"JCDecaux", target_column:"Ind", target_label:"Population totale", rayon_metres:300, limit:10)
- "Quels panneaux touchent le plus de seniors à Paris ?" → classer_panneaux_audience(ville:"Paris", target_column:"Ind_65_79", target_label:"Seniors 65-79 ans", rayon_metres:500, limit:10)

═══ OUTIL 7 : calculate_audience_coverage ═══
Calcule le nombre de personnes d'une cible dans une zone de temps de trajet réel (ORS + PostGIS prorata spatial).
Retourne un chiffre unique et affiche l'isochrone sur la carte.

DÉCLENCHER pour :
- "combien de [cible] dans un rayon de X min autour de [lieu]"
- "couverture [cible] à X min en [mode] autour de [lieu]"
- "audience potentielle autour de [lieu]"
- "potentiel de recrutement [lieu]"

MAPPING target_column (même logique que afficher_carreaux) :
- "population", "habitants" → Ind, label "Population totale"
- "18-24 ans", "jeunes" → ind_18_24, label "Jeunes 18-24 ans"
- "25-39 ans" → Ind_25_39, label "Adultes 25-39 ans"
- "65-79 ans", "seniors" → Ind_65_79, label "Seniors 65-79 ans"
- "ménages" → Men, label "Nombre de ménages"

EXEMPLES → calculate_audience_coverage :
- "Combien de jeunes 18-24 ans dans 30 min en voiture autour de Brest ?" → calculate_audience_coverage(location_name:"Brest", travel_time_minutes:30, target_column:"ind_18_24", target_label:"Jeunes 18-24 ans", mode:"drive")
- "Audience potentielle 15 min à pied autour de Lyon" → calculate_audience_coverage(location_name:"Lyon", travel_time_minutes:15, target_column:"Ind", target_label:"Population totale", mode:"walk")
- "Potentiel 60 min voiture depuis Rennes" → calculate_audience_coverage(location_name:"Rennes", travel_time_minutes:60, target_column:"ind_18_24", target_label:"Jeunes 18-24 ans", mode:"drive")


═══ OUTIL 8 : analyze_poi_synergy ═══
Trouve les panneaux qui combinent deux criteres : proximite d un POI ET forte audience demographique.
Appelle la fonction PostGIS find_synergy_billboards(poi_category, max_distance_m, target_demo_col, min_audience, buffer_radius_m).

DECLENCHER OBLIGATOIREMENT pour :
- "panneaux pres des lycees pour les 18-24 ans"
- "meilleurs panneaux strategiques pres des [POI] pour [cible]"
- "panneaux a forte audience [cible] a moins de Xm d un [POI]"
- "synergie panneaux x [POI] x [cible]"
- "double critere POI + audience"

MAPPING target_demo_col (identique aux autres outils) :
- "18-24 ans", "jeunes" -> ind_18_24, label "Jeunes 18-24 ans"
- "25-39 ans" -> Ind_25_39, label "Adultes 25-39 ans"
- "population", "habitants" -> Ind, label "Population totale"
- "65-79 ans", "seniors" -> Ind_65_79, label "Seniors 65-79 ans"
- "menages" -> Men, label "Nombre de menages"

PARAMETRE OBLIGATOIRE : ville (toujours requis, sinon timeout).
Si l utilisateur ne precise pas de ville, demande-lui laquelle avant d appeler l outil.

EXEMPLES -> analyze_poi_synergy :
- "Panneaux pres des lycees a Brest pour les 18-24 ans" -> analyze_poi_synergy(poi_category:"lycee", ville:"Brest", target_demo_col:"ind_18_24", target_demo_label:"Jeunes 18-24 ans", max_distance_m:500, buffer_radius_m:300)
- "Top panneaux CIRFA + 25-39 ans a Lyon" -> analyze_poi_synergy(poi_category:"cirfa", ville:"Lyon", target_demo_col:"Ind_25_39", target_demo_label:"Adultes 25-39 ans", max_distance_m:500, buffer_radius_m:300)
- "Panneaux a 300m des gares avec max seniors a Paris" -> analyze_poi_synergy(poi_category:"gare", ville:"Paris", target_demo_col:"Ind_65_79", target_demo_label:"Seniors 65-79 ans", max_distance_m:300, buffer_radius_m:300)

FORMAT DE REPONSE (quand resultats) :
"J ai trouve X panneaux strategiques a moins de Ym d un(e) [POI], touchant plus de Z personnes de la cible [cible]."
Puis tableau Top 3 : rang | reference | regie | ville | audience

═══ OUTIL 9 : calculate_network_coverage ═══
Calcule l'empreinte demographique totale d'un reseau de POI (ex: tous les CIRFA de France) en unionant leurs isochrones.
Retourne un chiffre unique de couverture et affiche le polygone d'union sur la carte.

DECLENCHER OBLIGATOIREMENT pour :
- "combien de [cible] sont couverts par le reseau [POI] a Xmin"
- "empreinte demographique du reseau [POI]"
- "portee totale du reseau [POI] a [X] minutes"
- "combien de jeunes touchent l ensemble des CIRFA a 30 min"
- "couverture nationale du reseau [POI]"

MAPPING target_demo_column (identique aux autres outils) :
- "18-24 ans", "jeunes" -> ind_18_24, label "Jeunes 18-24 ans"
- "25-39 ans" -> Ind_25_39, label "Adultes 25-39 ans"
- "population", "habitants" -> Ind, label "Population totale"
- "65-79 ans", "seniors" -> Ind_65_79, label "Seniors 65-79 ans"
- "menages" -> Men, label "Nombre de menages"

AVERTIR l'utilisateur avant d'appeler : "Calcul en cours (peut prendre 1-2 min au 1er appel, puis mis en cache)."

FILTRE GEOGRAPHIQUE (TOUJOURS passer si l utilisateur mentionne une region/ville/dept) :
- Si l utilisateur dit "en Bretagne", "dans le 29", "a Brest" → passer region/departement/ville en parametre
- Sans filtre geo = France entiere (tres long, risque de timeout) → TOUJOURS demander confirmation avant d appeler sans filtre

EXEMPLES -> calculate_network_coverage :
- "Empreinte 18-24 ans du reseau CIRFA a 60min voiture en Bretagne" -> calculate_network_coverage(poi_category:"cirfa", travel_time_minutes:60, target_demo_column:"ind_18_24", target_demo_label:"Jeunes 18-24 ans", mode:"drive", region:"Bretagne")
- "Combien de 25-39 ans couverts par les lycees a 15min a pied" -> calculate_network_coverage(poi_category:"lycee", travel_time_minutes:15, target_demo_column:"Ind_25_39", target_demo_label:"Adultes 25-39 ans", mode:"walk")
- "Portee CIRFA 30min voiture en Normandie" -> calculate_network_coverage(poi_category:"cirfa", travel_time_minutes:30, target_demo_column:"Ind", target_demo_label:"Population totale", mode:"drive", region:"Normandie")
- "couverture CIRFA 30 minutes voiture 18-24 ans Bretagne" -> calculate_network_coverage(poi_category:"cirfa", travel_time_minutes:30, target_demo_column:"ind_18_24", target_demo_label:"Jeunes 18-24 ans", mode:"drive", region:"Bretagne")
- "couverture cirfa 30 min en voiture sur les 18-24 ans de Bretagne" -> calculate_network_coverage(poi_category:"cirfa", travel_time_minutes:30, target_demo_column:"ind_18_24", target_demo_label:"Jeunes 18-24 ans", mode:"drive", region:"Bretagne")
- "combien de 18-24 ans touchés par les CIRFA de Bretagne a 30min voiture" -> calculate_network_coverage(poi_category:"cirfa", travel_time_minutes:30, target_demo_column:"ind_18_24", target_demo_label:"Jeunes 18-24 ans", mode:"drive", region:"Bretagne")

FORMAT DE REPONSE calculate_network_coverage (quand resultats) :
"Le reseau [poi_category] couvre [coverage] [target_demo_label] dans un rayon de [travel_time_minutes] min en [mode] (base sur [nb_pois] points)."
Puis : "L'union des isochrones est affichee en violet sur la carte."

IMPORTANT:
- Tu peux appeler les deux outils en même temps si l'utilisateur demande POI + données démographiques.
- Pour POI: plusieurs appels si plusieurs catégories/zones.
- Réponse texte : 1-2 phrases max, en français. Mentionne l'indicateur utilisé si tu affiches des carreaux.`;
}

// =============================================================================
// POST /api/chat — streamText (Vercel AI SDK v6)
// =============================================================================

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'anon';
  const rl  = checkRateLimit(ip);
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ error: `RATE_LIMIT:${rl.retrySec}` }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retrySec) } }
    );
  }

  try {
    const { messages, forceRecalculate = false } = await request.json();

    const categoriesList = await getDistinctCategories();
    console.log('[chat] Catégories dynamiques:', categoriesList);

    // Opt-in data.gouv MCP: activate only when user mentions data.gouv keywords
    const lastUserText: string = (() => {
      const last = [...messages].reverse().find((m: any) => m.role === 'user');
      const parts = last?.content;
      if (!parts) return '';
      if (typeof parts === 'string') return parts;
      if (Array.isArray(parts)) {
        return parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join(' ');
      }
      return '';
    })();
    const useDatagouv = hasDatagouvKeywords(lastUserText);
    const datagouv_tools = useDatagouv ? await loadDatagouvTools() : {};
    const datagouv_addendum = useDatagouv && Object.keys(datagouv_tools).length > 0
      ? '\n\n' + DATAGOUV_SYSTEM_ADDENDUM
      : '';

    const systemPrompt = buildSystemPrompt(categoriesList) + datagouv_addendum;
    const catsDesc = `Type exact parmi : ${categoriesList.join(', ')}`;

    const mistral = createMistral({ apiKey: process.env.MISTRAL_API_KEY });

    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: mistral('mistral-small-latest'),
      system: systemPrompt,
      messages: modelMessages,
      stopWhen: stepCountIs(3),
      temperature: 0.1,
      maxRetries: 1,  // 2 tentatives max (défaut=2 → 3 essais → trop long)
      tools: {

        analyser_zone_pois: {
          description:
            "Génère une zone de ciblage géographique sur la carte et recherche les points d'intérêt (POI). " +
            "Appeler dès qu'une localisation et/ou un type de POI sont identifiés.",
          inputSchema: z.object({
            ville: z.string().optional().describe("Nom de la ville française. Utiliser UNIQUEMENT si l'utilisateur mentionne une ville."),
            region: z.string().optional().describe("Région française (ex: Bretagne, Normandie, Île-de-France, PACA)."),
            departement: z.string().optional().describe("Nom ou numéro du département (ex: Finistère, 29)."),
            categorie_poi: z.string().optional().describe(catsDesc),
            rayon_metres: z.number().optional().describe("Rayon en mètres autour de la ville, UNIQUEMENT si explicitement demandé."),
            rayon_poi_metres: z.number().optional().describe("Rayon en mètres à dessiner autour de chaque établissement individuel."),
            isochrone_minutes: z.number().optional().describe("Durée de l'isochrone en minutes. UNIQUEMENT si l'utilisateur demande explicitement un isochrone."),
            isochrone_mode: z.enum(['walk', 'drive', 'bike']).optional().describe("Mode de transport: walk (défaut), drive, bike."),
            couleur: z.string().optional().describe("Couleur CSS pour les marqueurs de cette catégorie (ex: '#000000', 'red', '#3b82f6'). Utiliser si l'utilisateur précise une couleur."),
          }),
          execute: async (args) =>
            executeToolCall('analyser_zone_pois', args as Record<string, unknown>, categoriesList, { forceRecalculate }),
        },

        voronoi_analysis: {
          description:
            "⚡ PRIORITÉ MAXIMALE. Génère les polygones de Voronoï (zones d'influence territoriales) pour une catégorie de POIs. " +
            "OBLIGATOIRE pour : 'Voronoï', 'voronoi', 'territoire(s)', 'zone(s) d\\'influence', 'découpage territorial', 'cellule(s)', 'diagramme'. " +
            "NE PAS confondre avec analyser_zone_pois.",
          inputSchema: z.object({
            category: z.string().describe(catsDesc),
            ville: z.string().optional().describe("Ville à analyser. Optionnel — si absent, France entière."),
            region: z.string().optional().describe("Région à analyser. Optionnel."),
            departement: z.string().optional().describe("Département ou code. Optionnel."),
            metropolitaine: z.boolean().optional().describe(
              "TRUE (défaut) = France métropolitaine uniquement. FALSE = inclut DROM-COM."
            ),
          }),
          execute: async (args) =>
            executeToolCall('voronoi_analysis', args as Record<string, unknown>, categoriesList, {}),
        },

        afficher_carreaux: {
          description:
            "Affiche une couche choroplèthe de carreaux INSEE Filosofi 200m sur la carte avec un indicateur démographique. " +
            "Appeler quand l'utilisateur veut voir la distribution spatiale d'une variable socio-démographique (âge, revenus, population...).",
          inputSchema: z.object({
            indicateur: z.string().describe("Nom exact de la colonne Filosofi (ex: ind_18_24, Ind_65_79, ind, rev_median, men)."),
            indicateur_label: z.string().describe("Label lisible en français (ex: Jeunes 18-24 ans, Population totale)."),
            ville: z.string().optional().describe("Ville sur laquelle centrer la vue."),
          }),
          execute: async (args) =>
            executeToolCall('afficher_carreaux', args as Record<string, unknown>, categoriesList, {}),
        },

        isochrone_battle: {
          description:
            "🔥 Génère la Bataille d'Isochrones : territoires de recrutement basés sur des anneaux de temps réel " +
            "(10/30/60/90/120 min en voiture via ORS). Règle : le plus petit gagne. " +
            "OBLIGATOIRE pour : bataille d'isochrones, anneaux isochrones, territoires de recrutement réels, " +
            "sectorisation routière, qui recrute en moins de Xmin, paliers de temps, zones de chalandise routières. " +
            "Calcul intensif (~1-2 min au 1er appel, puis mis en cache).",
          inputSchema: z.object({
            category: z.string().describe(catsDesc),
            mode: z.enum(['drive', 'walk', 'bike']).optional().describe("Mode de transport. Défaut: 'drive'."),
            ville: z.string().optional().describe("Filtre ville. Optionnel."),
            region: z.string().optional().describe("Filtre région. Optionnel — RECOMMANDÉ pour limiter les appels ORS."),
            departement: z.string().optional().describe("Filtre département ou code. Optionnel."),
            metropolitaine: z.boolean().optional().describe("TRUE (défaut) = France métropolitaine. FALSE = inclut DROM-COM."),
            max_minutes: z.number().optional().describe("Durée max en minutes. Défaut: 120."),
          }),
          execute: async (args) =>
            executeToolCall('isochrone_battle', args as Record<string, unknown>, categoriesList, { forceRecalculate }),
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
          execute: async (args) =>
            executeToolCall('analyser_panneaux', args as Record<string, unknown>, categoriesList, {}),
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
          execute: async (args) =>
            executeToolCall('classer_panneaux_audience', args as Record<string, unknown>, categoriesList, {}),
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
          execute: async (args) =>
            executeToolCall('analyze_poi_synergy', args as Record<string, unknown>, categoriesList, {}),
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
            mode: z.enum(['drive', 'walk', 'bike']).optional().describe("Mode de transport. Défaut: drive."),
          }),
          execute: async (args) =>
            executeToolCall('calculate_audience_coverage', args as Record<string, unknown>, categoriesList, {}),
        },

        calculate_network_coverage: {
          description:
            "Calcule l'empreinte démographique totale d'un réseau de POI (ex: tous les CIRFA de France) " +
            "en calculant l'union de leurs isochrones et en croisant avec les carreaux INSEE Filosofi. " +
            "Retourne un chiffre unique de couverture et affiche le polygone d'union (violet) sur la carte. " +
            "DÉCLENCHER pour : 'empreinte réseau [POI]', 'portée totale du réseau à Xmin', " +
            "'combien de [cible] couverts par le réseau', 'couverture nationale [POI]'. " +
            "Calcul intensif — mis en cache automatiquement.",
          inputSchema: z.object({
            poi_category:        z.string().describe(catsDesc),
            travel_time_minutes: z.number().describe("Durée de trajet en minutes (ex: 30, 60, 90)."),
            target_demo_column:  z.string().describe(
              "Colonne Filosofi : ind_18_24, Ind_25_39, Ind_40_54, Ind_65_79, Ind, Men, rev_median."
            ),
            target_demo_label:   z.string().describe("Label lisible (ex: 'Jeunes 18-24 ans')."),
            mode: z.enum(['drive', 'walk', 'bike']).optional().describe("Mode de transport. Défaut: drive."),
            region:      z.string().optional().describe("Filtre région (ex: 'Bretagne'). RECOMMANDÉ pour limiter le scope et éviter le timeout."),
            ville:       z.string().optional().describe("Filtre ville. Optionnel."),
            departement: z.string().optional().describe("Filtre département ou code. Optionnel."),
          }),
          execute: async (args) =>
            executeToolCall('calculate_network_coverage', args as Record<string, unknown>, categoriesList, { forceRecalculate }),
        },

        // data.gouv.fr MCP tools — injected dynamically when keywords detected
        ...datagouv_tools,

      },
    });

    return result.toUIMessageStreamResponse();

  } catch (error: any) {
    const msg: string = error.message ?? 'Erreur inconnue';
    const isRateLimit = msg.includes('Rate limit') || msg.includes('rate_limit') || msg.includes('429') || error.statusCode === 429;
    console.error(`[chat] Erreur${isRateLimit ? ' (rate limit)' : ''}:`, msg);
    return new Response(
      JSON.stringify({ error: isRateLimit ? 'RATE_LIMIT' : msg }),
      { status: isRateLimit ? 429 : 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
