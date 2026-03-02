import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { getDistinctCategories } from '@/lib/poi/categories';

// Timeout étendu pour les retries ORS (rate limit 20s × max 3 × N batches)
export const maxDuration = 120;

// =============================================================================
// Types Mistral API
// =============================================================================

interface MistralToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface MistralMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: MistralToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface MistralResponse {
  choices: {
    message: MistralMessage;
    finish_reason: 'stop' | 'tool_calls' | 'length';
  }[];
}

// =============================================================================
// Coordonnées des grandes villes françaises
// =============================================================================

const VILLES: Record<string, { lat: number; lng: number }> = {
  paris: { lat: 48.8566, lng: 2.3522 },
  lyon: { lat: 45.764, lng: 4.8357 },
  marseille: { lat: 43.2965, lng: 5.3698 },
  bordeaux: { lat: 44.8378, lng: -0.5792 },
  nantes: { lat: 47.2184, lng: -1.5534 },
  lille: { lat: 50.6292, lng: 3.0573 },
  toulouse: { lat: 43.6047, lng: 1.4442 },
  nice: { lat: 43.7102, lng: 7.262 },
  strasbourg: { lat: 48.5734, lng: 7.7521 },
  rennes: { lat: 48.1173, lng: -1.6778 },
  montpellier: { lat: 43.6108, lng: 3.8767 },
  grenoble: { lat: 45.1885, lng: 5.7245 },
  dijon: { lat: 47.322, lng: 5.0415 },
  angers: { lat: 47.4784, lng: -0.5632 },
  reims: { lat: 49.2583, lng: 4.0317 },
  metz: { lat: 49.1193, lng: 6.1757 },
  tours: { lat: 47.3941, lng: 0.6848 },
  brest: { lat: 48.3904, lng: -4.4861 },
  cannes: { lat: 43.5528, lng: 7.017 },
  toulon: { lat: 43.1242, lng: 5.928 },
  rouen: { lat: 49.4432, lng: 1.0999 },
  nancy: { lat: 48.6921, lng: 6.1844 },
  nimes: { lat: 43.8367, lng: 4.3601 },
  perpignan: { lat: 42.6887, lng: 2.9483 },
  besancon: { lat: 47.2378, lng: 6.0241 },
  orleans: { lat: 47.9029, lng: 1.9039 },
  caen: { lat: 49.1829, lng: -0.3707 },
  amiens: { lat: 49.8941, lng: 2.2957 },
  limoges: { lat: 45.8336, lng: 1.2611 },
  'aix-en-provence': { lat: 43.5297, lng: 5.4474 },
  'clermont-ferrand': { lat: 45.7797, lng: 3.0863 },
  'le havre': { lat: 49.4938, lng: 0.1077 },
};

function getCoordsForVille(ville: string): { lat: number; lng: number } {
  const key = ville
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (VILLES[key]) return VILLES[key];
  for (const [k, v] of Object.entries(VILLES)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  console.warn(`[chat] Ville inconnue: "${ville}" → Paris`);
  return { lat: 48.8566, lng: 2.3522 };
}

// =============================================================================
// Coordonnées approximatives des régions françaises (centre)
// =============================================================================

const REGIONS: Record<string, { lat: number; lng: number }> = {
  'ile-de-france': { lat: 48.8566, lng: 2.3522 },
  'hauts-de-france': { lat: 49.8941, lng: 2.2957 },
  'normandie': { lat: 49.1829, lng: -0.3707 },
  'bretagne': { lat: 48.2020, lng: -2.9326 },
  'pays de la loire': { lat: 47.4784, lng: -0.5632 },
  'centre-val de loire': { lat: 47.9029, lng: 1.9039 },
  'bourgogne-franche-comte': { lat: 47.2378, lng: 6.0241 },
  'grand est': { lat: 48.5734, lng: 7.7521 },
  'auvergne-rhone-alpes': { lat: 45.764, lng: 4.8357 },
  'nouvelle-aquitaine': { lat: 44.8378, lng: -0.5792 },
  'occitanie': { lat: 43.6047, lng: 1.4442 },
  'paca': { lat: 43.2965, lng: 5.3698 },
  'provence-alpes-cote d\'azur': { lat: 43.2965, lng: 5.3698 },
  'corse': { lat: 42.1596, lng: 9.1393 },
  'guadeloupe': { lat: 16.265, lng: -61.551 },
  'martinique': { lat: 14.6415, lng: -61.0242 },
  'guyane': { lat: 3.9339, lng: -53.1258 },
  'la reunion': { lat: -21.1151, lng: 55.5364 },
  'mayotte': { lat: -12.8275, lng: 45.1662 },
  'nouvelle-caledonie': { lat: -22.2558, lng: 166.4505 },
};

function getCoordsForRegion(region: string): { lat: number; lng: number } {
  const key = region
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (REGIONS[key]) return REGIONS[key];
  for (const [k, v] of Object.entries(REGIONS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  console.warn(`[chat] Région inconnue: "${region}" → Paris`);
  return { lat: 48.8566, lng: 2.3522 };
}

// =============================================================================
// Exécution des outils (server-side, async)
// =============================================================================

function normVille(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Rayon approximatif de la ville elle-même (en mètres) pour estimer les limites administratives
const CITY_BASE_RADIUS: Record<string, number> = {
  paris: 7000,
  lyon: 5500,
  marseille: 8000,
  bordeaux: 5000,
  nantes: 5000,
  lille: 4500,
  toulouse: 6000,
  nice: 5000,
  strasbourg: 4500,
  rennes: 4000,
  montpellier: 5000,
  grenoble: 4000,
};

type PoiRow = {
  id: string; nom: string; lat: number; lng: number;
  categorie: string; sous_categorie?: string; adresse?: string; ville?: string;
};

/**
 * Résolution de la catégorie demandée contre les catégories réelles en base.
 * Retourne la catégorie exacte ou null si non trouvée.
 */
function resolveCategory(
  requested: string | undefined,
  validCategories: string[]
): string | null {
  if (!requested) return null;
  const norm = requested.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // Exact match
  const exact = validCategories.find(c => c.toLowerCase() === norm);
  if (exact) return exact;

  // Partial match (ex: "lycées" → "lycee")
  const partial = validCategories.find(c => {
    const cn = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return cn.includes(norm) || norm.includes(cn);
  });
  return partial ?? null;
}

// =============================================================================
// Isochrones — OpenRouteService API
// =============================================================================

const ORS_PROFILES: Record<string, string> = {
  walk:  'foot-walking',
  drive: 'driving-car',
  bike:  'cycling-regular',
};
const ORS_BATCH_SIZE    = 5;
const ORS_MAX_POIS      = 50; // 10 batches max pour rester dans le timeout
const ORS_MAX_RETRIES   = 3;
const ORS_RETRY_DELAY   = 20_000; // 20s entre les retries (rate limit ORS)

/** Clé de cache : ville__categorie__Xmin__mode */
function buildIsochCacheKey(ville: string, categorie: string | undefined, minutes: number, mode: string): string {
  const vk = ville.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
  const ck = (categorie ?? 'all').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return `${vk}__${ck}__${minutes}min__${mode}`;
}

interface IsochroneCacheCtx {
  cacheKey: string;
  ville: string;
  categorie?: string;
}

async function fetchIsochrones(
  pois: PoiRow[],
  minutes: number,
  mode: string,
  cacheCtx: IsochroneCacheCtx,
  forceRecalculate = false
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    console.warn('[isochrone] ORS_API_KEY non définie — isochrones ignorés');
    return null;
  }

  const supabase = createAdminClient();

  // ── Vérification du cache Supabase ──────────────────────────────────────
  if (!forceRecalculate) {
    const { data: cached } = await supabase
      .from('isochrones_cache')
      .select('geojson, created_at, poi_count')
      .eq('cache_key', cacheCtx.cacheKey)
      .single();

    if (cached) {
      console.log(`[isochrone] Cache HIT: ${cacheCtx.cacheKey} (calculé le ${cached.created_at})`);
      return {
        ...(cached.geojson as object),
        _fromCache: true,
        _cachedAt: cached.created_at,
        _poiCount: cached.poi_count,
      };
    }
    console.log(`[isochrone] Cache MISS: ${cacheCtx.cacheKey} → calcul ORS`);
  } else {
    console.log(`[isochrone] forceRecalculate=true → bypass cache pour ${cacheCtx.cacheKey}`);
  }

  // ── Appel ORS par batches de 5 ───────────────────────────────────────────
  const profile = ORS_PROFILES[mode] ?? 'foot-walking';
  const rangeSec = minutes * 60;

  const sliced = pois.slice(0, ORS_MAX_POIS);
  if (pois.length > ORS_MAX_POIS) {
    console.warn(`[isochrone] Troncature: ${pois.length} POIs → ${ORS_MAX_POIS}`);
  }

  const allFeatures: unknown[] = [];

  for (let i = 0; i < sliced.length; i += ORS_BATCH_SIZE) {
    const batch = sliced.slice(i, i + ORS_BATCH_SIZE);
    const locations = batch.map(p => [p.lng, p.lat]);
    const batchNum  = Math.floor(i / ORS_BATCH_SIZE) + 1;

    let success = false;
    for (let attempt = 0; attempt < ORS_MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(
          `https://api.openrouteservice.org/v2/isochrones/${profile}`,
          {
            method: 'POST',
            headers: {
              'Authorization': apiKey,
              'Content-Type': 'application/json',
              'Accept': 'application/json, application/geo+json',
            },
            body: JSON.stringify({ locations, range: [rangeSec], range_type: 'time' }),
          }
        );

        if (res.status === 429) {
          console.warn(`[isochrone] Rate limit batch ${batchNum} (tentative ${attempt + 1}/${ORS_MAX_RETRIES}), attente ${ORS_RETRY_DELAY / 1000}s...`);
          await new Promise(r => setTimeout(r, ORS_RETRY_DELAY));
          continue;
        }

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[isochrone] ORS HTTP ${res.status} batch ${batchNum}: ${errText}`);
          break;
        }

        const data = await res.json();
        if (Array.isArray(data.features)) {
          allFeatures.push(...data.features);
        }
        success = true;
        console.log(`[isochrone] Batch ${batchNum}: ${data.features?.length ?? 0} polygones`);
        break;
      } catch (e: any) {
        console.error(`[isochrone] Fetch error batch ${batchNum} (tentative ${attempt + 1}):`, e.message);
        if (attempt < ORS_MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, ORS_RETRY_DELAY));
        }
      }
    }

    if (!success) {
      console.warn(`[isochrone] Batch ${batchNum} échoué après ${ORS_MAX_RETRIES} tentatives`);
    }
  }

  if (allFeatures.length === 0) return null;

  const geojson = { type: 'FeatureCollection', features: allFeatures };

  // ── Sauvegarde en cache ──────────────────────────────────────────────────
  const { error: cacheErr } = await supabase
    .from('isochrones_cache')
    .upsert({
      cache_key:  cacheCtx.cacheKey,
      ville:      cacheCtx.ville,
      categorie:  cacheCtx.categorie ?? null,
      minutes,
      mode,
      geojson,
      poi_count:  sliced.length,
      created_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });

  if (cacheErr) {
    console.error('[isochrone] Erreur sauvegarde cache:', cacheErr.message);
  } else {
    console.log(`[isochrone] Cache sauvegardé: ${cacheCtx.cacheKey} (${allFeatures.length} polygones)`);
  }

  console.log(`[isochrone] Total: ${allFeatures.length} polygones (${minutes}min, ${mode})`);
  return geojson;
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
      isochroneGeoJSON = await fetchIsochrones(pois, isochrone_minutes, isochrone_mode, cacheCtx, options.forceRecalculate);
    }
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

  return { error: `Outil inconnu: ${name}` };
}

// =============================================================================
// Indicateurs carreaux INSEE Filosofi
// =============================================================================

// Mapping : terme naturel → colonne Filosofi + label FR
// Termes PRÉCIS → appel direct. Termes AMBIGUS → Mistral doit demander.
const CHORO_INDICATORS: Record<string, { col: string; label: string }> = {
  'ind':        { col: 'ind',        label: 'Population totale' },
  'ind_0_3':    { col: 'ind_0_3',    label: 'Enfants 0-3 ans' },
  'ind_4_5':    { col: 'ind_4_5',    label: 'Enfants 4-5 ans' },
  'ind_6_10':   { col: 'ind_6_10',   label: 'Enfants 6-10 ans' },
  'ind_11_17':  { col: 'ind_11_17',  label: 'Adolescents 11-17 ans' },
  'ind_18_24':  { col: 'ind_18_24',  label: 'Jeunes 18-24 ans' },
  'ind_25_39':  { col: 'ind_25_39',  label: 'Adultes 25-39 ans' },
  'ind_40_54':  { col: 'ind_40_54',  label: 'Adultes 40-54 ans' },
  'ind_55_64':  { col: 'ind_55_64',  label: 'Seniors 55-64 ans' },
  'ind_65_79':  { col: 'ind_65_79',  label: 'Seniors 65-79 ans' },
  'ind_80p':    { col: 'ind_80p',    label: 'Personnes 80 ans et +' },
  'men':        { col: 'men',        label: 'Nombre de ménages' },
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

SI l'utilisateur dit "montre les XXX", "affiche les XXX", "trouve les XXX" sans "territoire/voronoï"
→ analyser_zone_pois

SI l'utilisateur dit "carreaux", "18-24 ans", "revenus", "population", "densité"
→ afficher_carreaux

SI l'utilisateur dit "isochrone", "X min à pied/voiture/vélo"
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

EXEMPLES POI:
- "les CIRFA de Bretagne" → region: "Bretagne", categorie_poi: "cirfa"
- "les lycées de Brest" → ville: "Brest", categorie_poi: "lycee"
- "lycées et CIRFA à Brest" → DEUX appels : (1) ville:"Brest", cat:"lycee" ET (2) ville:"Brest", cat:"cirfa"

═══ OUTIL 2 : afficher_carreaux ═══
Appelle cet outil quand l'utilisateur veut voir des données démographiques/sociales par carreau INSEE 200m.

TERMES PRÉCIS → appelle directement afficher_carreaux:
- "18-24 ans", "ind_18_24", "18 à 24" → indicateur: "ind_18_24", label: "Jeunes 18-24 ans"
- "25-39 ans" → indicateur: "ind_25_39", label: "Adultes 25-39 ans"
- "11-17 ans", "collégiens/lycéens âge" → indicateur: "ind_11_17", label: "Adolescents 11-17 ans"
- "65-79 ans", "retraités" → indicateur: "ind_65_79", label: "Seniors 65-79 ans"
- "80 ans et plus" → indicateur: "ind_80p", label: "Personnes 80 ans et +"
- "population", "habitants" → indicateur: "ind", label: "Population totale"
- "revenus", "niveau de vie", "CSP+" → indicateur: "rev_median", label: "Revenu médian"
- "ménages", "familles" → indicateur: "men", label: "Nombre de ménages"

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
   des "territoires de recrutement par paliers", ou toute sectorisation basée sur le temps de trajet routier.
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

═══ ISOCHRONES ═══
Si l'utilisateur mentionne "isochrone", "X minutes à pied/voiture/vélo", "zone de chalandise", "zone accessible en X min" :
→ Ajouter isochrone_minutes + isochrone_mode à analyser_zone_pois

EXEMPLES ISOCHRONES:
- "isochrone 5 min à pied autour des lycées à Brest" → analyser_zone_pois(ville:"Brest", cat:"lycee", isochrone_minutes:5, isochrone_mode:"walk")
- "30 min en voiture depuis les CIRFA de Lyon" → analyser_zone_pois(ville:"Lyon", cat:"cirfa", isochrone_minutes:30, isochrone_mode:"drive")
- "zone à vélo 15 min autour des gares" → isochrone_mode:"bike", isochrone_minutes:15

NE PAS ajouter isochrone si non demandé explicitement.

IMPORTANT:
- Tu peux appeler les deux outils en même temps si l'utilisateur demande POI + données démographiques.
- Pour POI: plusieurs appels si plusieurs catégories/zones.
- Réponse texte : 1-2 phrases max, en français. Mentionne l'indicateur utilisé si tu affiches des carreaux.`;
}

function buildTools(categoriesList: string[]) {
  const catsDescription =
    `Le type exact de Point d'Intérêt. ATTENTION : tu DOIS choisir strictement une valeur parmi cette liste exacte : ${categoriesList.join(', ')}. N'invente AUCUN autre terme.`;

  return [
    {
      type: 'function' as const,
      function: {
        name: 'analyser_zone_pois',
        description:
          "Génère une zone de ciblage géographique sur la carte et recherche les points d'intérêt (POI). Appeler dès qu'une localisation et/ou un type de POI sont identifiés.",
        parameters: {
          type: 'object',
          properties: {
            ville: {
              type: 'string',
              description: 'Nom de la ville française. Utiliser UNIQUEMENT si l\'utilisateur mentionne une ville.',
            },
            region: {
              type: 'string',
              description: 'Nom de la région française (ex: Bretagne, Normandie, Île-de-France, PACA).',
            },
            departement: {
              type: 'string',
              description: 'Nom ou numéro du département (ex: Finistère, 29).',
            },
            categorie_poi: {
              type: 'string',
              description: catsDescription,
              enum: categoriesList,
            },
            rayon_metres: {
              type: 'number',
              description: 'Rayon en mètres autour de la ville, UNIQUEMENT si explicitement demandé.',
            },
            rayon_poi_metres: {
              type: 'number',
              description: 'Rayon en mètres à dessiner autour de chaque établissement individuel.',
            },
            isochrone_minutes: {
              type: 'number',
              description: 'Durée de l\'isochrone en minutes (ex: 5, 10, 15, 30). UNIQUEMENT si l\'utilisateur demande explicitement un isochrone, zone de chalandise ou accessibilité en temps.',
            },
            isochrone_mode: {
              type: 'string',
              enum: ['walk', 'drive', 'bike'],
              description: 'Mode de transport pour l\'isochrone: walk (à pied, défaut), drive (voiture), bike (vélo).',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'voronoi_analysis',
        description:
          "⚡ PRIORITÉ MAXIMALE. Génère les polygones de Voronoï (zones d'influence territoriales) pour une catégorie de POIs, " +
          "avec affichage des établissements en markers. " +
          "OBLIGATOIRE pour les mots : 'Voronoï', 'voronoi', 'territoire(s)', 'zone(s) d\\'influence', 'découpage territorial', 'cellule(s)', 'diagramme'. " +
          "Accepte un filtre optionnel ville/région/département. " +
          "NE PAS confondre avec analyser_zone_pois (qui n'affiche que des markers sans polygones).",
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: `Catégorie EXACTE de POIs. Choisir strictement parmi : ${categoriesList.join(', ')}`,
            },
            ville: {
              type: 'string',
              description: 'Ville à analyser. Ex: "Brest", "Lyon". Optionnel — si absent, France entière.',
            },
            region: {
              type: 'string',
              description: 'Région à analyser. Ex: "Bretagne", "Île-de-France". Optionnel.',
            },
            departement: {
              type: 'string',
              description: 'Département ou code. Ex: "Finistère", "29". Optionnel.',
            },
            metropolitaine: {
              type: 'boolean',
              description:
                "TRUE (défaut) = France métropolitaine uniquement si pas de filtre lieu. " +
                "FALSE = inclut DROM-COM. Mettre FALSE si l'utilisateur mentionne : 'DROM-COM', 'outre-mer', 'Guadeloupe', 'Martinique', 'Réunion', 'Guyane', 'Mayotte', 'DOM-TOM'.",
            },
          },
          required: ['category'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'afficher_carreaux',
        description:
          'Affiche une couche choroplèthe de carreaux INSEE Filosofi 200m sur la carte avec un indicateur démographique. Appeler quand l\'utilisateur veut voir la distribution spatiale d\'une variable socio-démographique (âge, revenus, population...).',
        parameters: {
          type: 'object',
          properties: {
            indicateur: {
              type: 'string',
              description: 'Nom exact de la colonne Filosofi (ex: ind_18_24, ind_65_79, ind, rev_median, men).',
            },
            indicateur_label: {
              type: 'string',
              description: 'Label lisible en français (ex: "Jeunes 18-24 ans", "Population totale").',
            },
            ville: {
              type: 'string',
              description: 'Ville sur laquelle centrer la vue. Utiliser si l\'utilisateur a mentionné une ville.',
            },
          },
          required: ['indicateur', 'indicateur_label'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'isochrone_battle',
        description:
          "🔥 Génère la 'Bataille d'Isochrones' : territoires de recrutement basés sur des anneaux " +
          "de temps réel (10/30/60/90/120 min en voiture via ORS). " +
          "Règle absolue : 'le plus petit gagne' — le CIRFA/POI le plus proche en temps réel " +
          "remporte chaque zone. ZÉRO Voronoï, uniquement ST_Difference pur sur vrais isochrones ORS. " +
          "OBLIGATOIRE pour les termes : 'bataille d'isochrones', 'anneaux isochrones', " +
          "'territoires de recrutement réels', 'sectorisation routière', 'qui recrute en moins de Xmin', " +
          "'paliers de temps', 'zones de chalandise routières'. " +
          "⚠️ Calcul intensif (~1-2 min pour la France entière au 1er appel, puis mis en cache).",
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: `Catégorie EXACTE de POIs. Choisir strictement parmi : ${categoriesList.join(', ')}`,
            },
            mode: {
              type: 'string',
              enum: ['drive', 'walk', 'bike'],
              description: "Mode de transport. Défaut: 'drive' (voiture).",
            },
            ville: {
              type: 'string',
              description: 'Filtre ville. Optionnel.',
            },
            region: {
              type: 'string',
              description: 'Filtre région. Optionnel — RECOMMANDÉ pour limiter les appels ORS.',
            },
            departement: {
              type: 'string',
              description: 'Filtre département ou code. Optionnel.',
            },
            metropolitaine: {
              type: 'boolean',
              description: 'TRUE (défaut) = France métropolitaine. FALSE = inclut DROM-COM.',
            },
            max_minutes: {
              type: 'number',
              enum: [60, 90, 120, 150, 180],
              description: "Durée max en minutes. Défaut: 120. Demander à l'utilisateur sa préférence si non précisé dans la demande.",
            },
          },
          required: ['category'],
        },
      },
    },
  ];
}

async function callMistral(
  messages: MistralMessage[],
  tools: ReturnType<typeof buildTools>
): Promise<MistralResponse> {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mistral API ${res.status}: ${err}`);
  }

  return res.json();
}

// =============================================================================
// Fusion de plusieurs résultats de zone (multi-tool-calls)
// =============================================================================

function mergeZoneResults(results: any[]): any | null {
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];

  // Fusionner tous les POIs (dédoublonner par id)
  const poisMap = new Map<string, any>();
  for (const r of results) {
    for (const p of r.pois ?? []) {
      poisMap.set(p.id, p);
    }
  }
  const allPois = Array.from(poisMap.values());

  // Fusionner les compteurs de catégories
  const categories: Record<string, number> = {};
  for (const p of allPois) {
    const cat = p.categorie || 'autre';
    categories[cat] = (categories[cat] ?? 0) + 1;
  }

  // Label de la zone : combiner les noms de lieux
  const labels = results.map(r => r.ville).filter(Boolean);
  const uniqueLabels = [...new Set(labels)];
  const villeLabel = uniqueLabels.join(' + ');

  // Coordonnées : centroïde de tous les POIs, ou fallback sur le premier résultat
  let coordonnees = results[0].coordonnees;
  if (allPois.length > 0) {
    const avgLat = allPois.reduce((s, p) => s + p.lat, 0) / allPois.length;
    const avgLng = allPois.reduce((s, p) => s + p.lng, 0) / allPois.length;
    coordonnees = { lat: avgLat, lng: avgLng };
  }

  // Rayon : prendre le max
  const rayon_metres = Math.max(...results.map(r => r.rayon_metres ?? 0)) || null;
  const rayon_poi_metres = Math.max(...results.map(r => r.rayon_poi_metres ?? 0)) || null;

  console.log(`[chat] Fusion de ${results.length} résultats → ${allPois.length} POIs total (${Object.entries(categories).map(([k,v]) => `${k}:${v}`).join(', ')})`);

  return {
    ville: villeLabel,
    region: results.map(r => r.region).find(Boolean) ?? null,
    departement: results.map(r => r.departement).find(Boolean) ?? null,
    categorie_poi: null, // multiple catégories possibles
    rayon_metres,
    rayon_poi_metres,
    coordonnees,
    pois: allPois,
    nb_pois: allPois.length,
    categories,
  };
}

// =============================================================================
// POST /api/chat
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const { messages: clientMessages, forceRecalculate = false } = await request.json();

    // ── ÉTAPE 2 : Dictionnaire dynamique ────────────────────────────────────
    // Récupère les catégories EXACTES depuis la base AVANT d'appeler Mistral
    const categoriesList = await getDistinctCategories();
    console.log('[chat] Catégories dynamiques:', categoriesList);

    // ── ÉTAPE 3 : System prompt + outils avec catégories blindées ──────────
    const systemPrompt = buildSystemPrompt(categoriesList);
    const tools = buildTools(categoriesList);

    // Construire l'historique Mistral (rôles user/assistant uniquement côté client)
    const mistralMessages: MistralMessage[] = [
      { role: 'system', content: systemPrompt },
      ...clientMessages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const allZoneResults: any[] = [];
    let carreauxData: any = null;
    let isochroneData: any = null;
    let voronoiData: any = null;
    let battleData: any        = null;
    let battleBordersData: any = null;
    let lastBattleError: string | null = null;

    // Boucle agentique (max 3 tours pour éviter les boucles infinies)
    for (let step = 0; step < 3; step++) {
      const response = await callMistral(mistralMessages, tools);
      const choice = response.choices[0];

      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
        mistralMessages.push(choice.message);

        for (const toolCall of choice.message.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeToolCall(toolCall.function.name, args, categoriesList, { forceRecalculate });

          if (toolCall.function.name === 'analyser_zone_pois') {
            allZoneResults.push(result);
            mistralMessages.push({
              role: 'tool',
              content: JSON.stringify({
                ville: (result as any).ville,
                region: (result as any).region,
                categorie_poi: (result as any).categorie_poi,
                nb_pois: (result as any).nb_pois ?? 0,
                categories: (result as any).categories ?? {},
              }),
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
          } else if (toolCall.function.name === 'voronoi_analysis') {
            const voronoiErr = (result as any).error;
            if (!voronoiErr) {
              voronoiData = (result as any).voronoiGeoJSON ?? null;
              // Pousser les POIs dans allZoneResults → affichés comme markers sur le canvas
              if ((result as any).poisForMap) {
                allZoneResults.push((result as any).poisForMap);
              }
            }
            mistralMessages.push({
              role: 'tool',
              content: voronoiErr
                ? JSON.stringify({ error: voronoiErr })
                : JSON.stringify({
                    nb_polygones:   (result as any).nb_polygones ?? 0,
                    category:       (result as any).category,
                    metropolitaine: (result as any).metropolitaine,
                  }),
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
          } else if (toolCall.function.name === 'isochrone_battle') {
            const battleErr = (result as any).error;
            if (!battleErr) {
              battleData        = (result as any).battleGeoJSON ?? null;
              battleBordersData = (result as any).battleBorders  ?? null;
              // poisForMap est rendu directement par applyIsochroneBattle côté frontend
              // — ne pas pousser dans allZoneResults (évite ZoneCard avec nb_pois undefined)
            } else {
              lastBattleError = String(battleErr);
              console.error('[chat/isochrone_battle] Erreur reçue:', battleErr);
            }
            mistralMessages.push({
              role: 'tool',
              content: battleErr
                ? JSON.stringify({
                    error: battleErr,
                    conseil: 'Reproduire ce message d\'erreur EXACTEMENT à l\'utilisateur, mot pour mot.',
                  })
                : JSON.stringify({
                    nb_features:    (result as any).nb_features ?? 0,
                    nb_pois:        (result as any).nb_pois ?? 0,
                    category:       (result as any).category,
                    mode:           (result as any).mode ?? 'drive',
                    levels:         (result as any).levels ?? [10, 30, 60, 90, 120],
                    metropolitaine: (result as any).metropolitaine,
                  }),
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
          } else if (toolCall.function.name === 'afficher_carreaux') {
            carreauxData = result;
            mistralMessages.push({
              role: 'tool',
              content: JSON.stringify({
                action: 'afficher_carreaux',
                indicateur: (result as any).indicateur,
                indicateur_label: (result as any).indicateur_label,
                ville: (result as any).ville ?? null,
              }),
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
          } else {
            mistralMessages.push({
              role: 'tool',
              content: JSON.stringify(result),
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
          }
        }
        continue;
      }

      // finish_reason === 'stop' → réponse finale
      const mergedZone = mergeZoneResults(allZoneResults);
      // Fusionner les isochrones de tous les résultats
      // (plusieurs tool calls possibles : lycee + cirfa à Paris chacun avec isochrone)
      for (const r of allZoneResults) {
        const iso = r?.isochroneGeoJSON;
        if (!iso?.features?.length) continue;

        if (!isochroneData) {
          isochroneData = {
            type: 'FeatureCollection',
            features: [...iso.features],
            // _meta inclut cache info, mode, durée
            _meta: {
              mode:      r.isochrone_mode ?? 'walk',
              minutes:   r.isochrone_minutes ?? 0,
            },
            // Propager l'état cache du premier résultat
            _fromCache: iso._fromCache ?? false,
            _cachedAt:  iso._cachedAt  ?? null,
          };
        } else {
          // Résultats suivants : fusionner les features
          isochroneData.features.push(...iso.features);
          // Si au moins un batch est recalculé (pas en cache), on le signale
          if (!iso._fromCache) {
            isochroneData._fromCache = false;
            isochroneData._cachedAt  = null;
          }
        }
      }
      return NextResponse.json({
        reply: choice.message.content ?? '',
        zoneData: mergedZone,
        carreauxData,
        isochroneData,
        voronoiData,
        battleData,
        battleBordersData,
        battleError: lastBattleError,
      });
    }

    const mergedZone = mergeZoneResults(allZoneResults);
    return NextResponse.json({ reply: '(pas de réponse)', zoneData: mergedZone, carreauxData, isochroneData, voronoiData, battleData, battleBordersData, battleError: lastBattleError });
  } catch (error: any) {
    console.error('[chat] Erreur:', error);
    return NextResponse.json(
      { error: error.message ?? 'Erreur inconnue' },
      { status: 500 }
    );
  }
}
