import { NextRequest } from 'next/server';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { createMistral } from '@ai-sdk/mistral';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { getDistinctCategories } from '@/lib/poi/categories';
import {
  fetchIsochrones, buildIsochCacheKey, ORS_MAX_POIS_CHAT,
  type PoiRow, type IsochroneCacheCtx,
} from '@/lib/isochrones/fetcher';
import {
  CITY_BASE_RADIUS, getCoordsForVille, getCoordsForRegion, normVille, resolveCategory,
} from '@/lib/geo/locations';

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

SI l'utilisateur dit "panneaux", "OOH", "affichage extérieur", "outdoor", "4x3", "abri-bus", "mobilier urbain", "régie", "Clear Channel", "JCDecaux", "Exterion", "Médiatransports", "afficheurs"
→ TOUJOURS analyser_panneaux. JAMAIS analyser_zone_pois.

SI l'utilisateur dit "montre les XXX", "affiche les XXX", "trouve les XXX" sans "territoire/voronoï" ni "panneau/OOH"
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

    const systemPrompt = buildSystemPrompt(categoriesList);
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
            indicateur: z.string().describe("Nom exact de la colonne Filosofi (ex: ind_18_24, ind_65_79, ind, rev_median, men)."),
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
