import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { getDistinctCategories } from '@/lib/poi/categories';

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

async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  validCategories: string[]
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
    };

    const catLabel = resolvedCategory ? ` [${resolvedCategory}]` : '';
    console.log(`[chat] analyser_zone_pois(${locationLabel}${catLabel}) → ${pois.length} POIs`);
    return result;
  }

  return { error: `Outil inconnu: ${name}` };
}

// =============================================================================
// Construction dynamique du system prompt et des outils
// =============================================================================

function buildSystemPrompt(categoriesList: string[]): string {
  const catsFormatted = categoriesList.map(c => `"${c}"`).join(', ');

  return `Tu es un assistant de recherche géographique. Tu aides à trouver des points d'intérêt (POI) dans une zone géographique.

CATÉGORIES DE POI DISPONIBLES EN BASE: ${catsFormatted}

Quand un utilisateur mentionne une zone géographique et/ou un type de POI, appelle TOUJOURS l'outil analyser_zone_pois avec les paramètres appropriés.

PARAMÈTRES DE LOCALISATION (au moins un est requis):
- ville : si l'utilisateur mentionne une VILLE (ex: "Lyon", "Brest", "Paris")
- region : si l'utilisateur mentionne une RÉGION (ex: "Bretagne", "Normandie", "Île-de-France", "PACA")
- departement : si l'utilisateur mentionne un DÉPARTEMENT (ex: "Finistère", "29", "Côtes-d'Armor")

PARAMÈTRE CATÉGORIE:
- categorie_poi : le type EXACT de POI choisi STRICTEMENT parmi cette liste → ${catsFormatted}. Si l'utilisateur ne précise pas de type, NE PAS fournir ce champ.

EXEMPLES:
- "les CIRFA de Bretagne" → region: "Bretagne", categorie_poi: "cirfa"
- "les CIRFA à Lyon" → ville: "Lyon", categorie_poi: "cirfa"
- "les lycées de Normandie" → region: "Normandie", categorie_poi: "lycee"
- "les lycées de Brest" → ville: "Brest", categorie_poi: "lycee"
- "les lycées du 29" → departement: "29", categorie_poi: "lycee"
- "collèges et lycées à Paris" → ville: "Paris" (NE PAS fournir categorie_poi car multiple types)
- "quels POI à Rouen" → ville: "Rouen" (NE PAS fournir categorie_poi)
- "tous les CIRFA de France" → (NE PAS fournir de localisation), categorie_poi: "cirfa"
- "les CIRFA de Bretagne et les lycées de Brest" → DEUX appels séparés : (1) region: "Bretagne", categorie_poi: "cirfa" ET (2) ville: "Brest", categorie_poi: "lycee"

IMPORTANT:
- Pour categorie_poi, tu DOIS choisir strictement une valeur parmi: ${catsFormatted}. N'invente AUCUN autre terme.
- "Bretagne", "Normandie", "Île-de-France" sont des RÉGIONS, pas des villes. Utilise le paramètre "region".
- Un numéro de département ("29", "35") ou un nom de département ("Finistère") → paramètre "departement".
- Si l'utilisateur demande PLUSIEURS types ET/OU zones (ex: "CIRFA de Bretagne et lycées de Brest"), tu DOIS faire PLUSIEURS appels à analyser_zone_pois — un par combinaison (catégorie, zone). Les résultats seront fusionnés automatiquement.

Après l'outil, réponds avec le nombre d'établissements trouvés. 1-2 phrases max. En français.`;
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
          "Génère une zone de ciblage géographique sur la carte et recherche les points d'intérêt (POI). Appeler dès qu'une localisation (ville, région ou département) et/ou un type de POI sont identifiés.",
        parameters: {
          type: 'object',
          properties: {
            ville: {
              type: 'string',
              description: 'Nom de la ville française (ex: Lyon, Paris, Marseille). Utiliser UNIQUEMENT si l\'utilisateur mentionne une ville.',
            },
            region: {
              type: 'string',
              description: 'Nom de la région française (ex: Bretagne, Normandie, Île-de-France, PACA). Utiliser si l\'utilisateur mentionne une région.',
            },
            departement: {
              type: 'string',
              description: 'Nom ou numéro du département (ex: Finistère, 29, Côtes-d\'Armor). Utiliser si l\'utilisateur mentionne un département.',
            },
            categorie_poi: {
              type: 'string',
              description: catsDescription,
              enum: categoriesList,
            },
            rayon_metres: {
              type: 'number',
              description:
                'Rayon en mètres autour de la ville, UNIQUEMENT si explicitement demandé. Omettre pour une zone entière.',
            },
            rayon_poi_metres: {
              type: 'number',
              description:
                'Rayon en mètres à dessiner autour de chaque établissement individuel (ex: 500 pour un cercle de 500m par lycée). Omettre si non demandé.',
            },
          },
          required: [],
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
    const { messages: clientMessages } = await request.json();

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

    // Boucle agentique (max 3 tours pour éviter les boucles infinies)
    for (let step = 0; step < 3; step++) {
      const response = await callMistral(mistralMessages, tools);
      const choice = response.choices[0];

      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
        // Ajouter le message assistant avec les tool_calls
        mistralMessages.push(choice.message);

        // Exécuter chaque outil et ajouter les résultats
        for (const toolCall of choice.message.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeToolCall(
            toolCall.function.name,
            args,
            categoriesList
          );

          // Accumuler tous les résultats de zone (on les fusionnera à la fin)
          if (toolCall.function.name === 'analyser_zone_pois') {
            allZoneResults.push(result);
          }

          mistralMessages.push({
            role: 'tool',
            // Ne pas renvoyer tous les pois à Mistral (trop volumineux) — juste le résumé
            content: JSON.stringify({
              ville: (result as any).ville,
              region: (result as any).region,
              categorie_poi: (result as any).categorie_poi,
              rayon_metres: (result as any).rayon_metres,
              nb_pois: (result as any).nb_pois ?? 0,
              categories: (result as any).categories ?? {},
            }),
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
          });
        }

        // Continuer la boucle pour obtenir la réponse finale
        continue;
      }

      // finish_reason === 'stop' → réponse finale
      // Fusionner tous les résultats de zone accumulés
      const mergedZone = mergeZoneResults(allZoneResults);
      return NextResponse.json({
        reply: choice.message.content ?? '',
        zoneData: mergedZone,
      });
    }

    const mergedZone = mergeZoneResults(allZoneResults);
    return NextResponse.json({ reply: '(pas de réponse)', zoneData: mergedZone });
  } catch (error: any) {
    console.error('[chat] Erreur:', error);
    return NextResponse.json(
      { error: error.message ?? 'Erreur inconnue' },
      { status: 500 }
    );
  }
}
