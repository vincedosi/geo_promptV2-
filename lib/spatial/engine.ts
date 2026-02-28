/**
 * Moteur d'Analyse Spatiale — v5.10.0
 * Pilote par Mistral AI avec Tool Calling
 * Outils : voronoi_analysis, isochrone_analysis, proximity_analysis, persist_result
 */

import { createAdminClient } from '@/lib/auth';

// =============================================================================
// Types
// =============================================================================

export interface SpatialMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: MistralToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface MistralToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface MistralResponse {
  choices: {
    message: SpatialMessage;
    finish_reason: 'stop' | 'tool_calls' | 'length';
  }[];
}

export interface SpatialResult {
  reply: string;
  geojson?: GeoJSONFeatureCollection | null;
  analysisType?: 'voronoi' | 'isochrone' | 'proximity' | null;
  savedId?: string | null;
  poiCount?: number;
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: unknown[];
  _meta?: Record<string, unknown>;
}

// =============================================================================
// Prompt système
// =============================================================================

const SYSTEM_PROMPT = `Tu es un expert en stratégie média et analyse géospatiale au service de planificateurs médias.

Tu analyses les territoires, les zones d'influence et l'accessibilité des points d'intérêt (POIs) pour optimiser les campagnes de communication.

Tu disposes de 4 outils :

1. **voronoi_analysis** — Génère les polygones de Voronoï pour une catégorie de POIs.
   Chaque polygone représente la zone d'influence exclusive d'un établissement.
   Utilise cet outil pour des questions comme : "Fais le Voronoï des CIRFA", "Zone d'influence des lycées professionnels".

2. **isochrone_analysis** — Calcule la zone accessible en X minutes depuis un point géographique.
   Supporte walk (à pied), drive (voiture), bike (vélo).
   Utilise cet outil pour : "Zone à 30 min en voiture de Paris", "Isochrone 15 min à pied autour de ce point".

3. **proximity_analysis** — Retourne les POIs d'une catégorie dans un rayon autour d'un point.
   Utile pour : "POIs à moins de 5 km de Lyon", "CIRFA dans un rayon de 50 km autour de Rennes".

4. **persist_result** — Sauvegarde un résultat d'analyse dans la base de données.
   TOUJOURS utiliser après voronoi_analysis ou isochrone_analysis si l'utilisateur demande à sauvegarder.
   Exemple : "sauvegarde-le sous 'Zone Influence Nord'" → appelle persist_result avec le GeoJSON résultant.

Règles :
- Réponds en français.
- Sois concis et professionnel.
- Après une analyse, propose toujours de la sauvegarder si ce n'est pas déjà fait.
- Les catégories courantes : cirfa, lycee, lycee_pro, universite, caserne, mairie, hopital.`;

// =============================================================================
// Définition des outils Mistral
// =============================================================================

const SPATIAL_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'voronoi_analysis',
      description:
        "Génère les polygones de Voronoï pour une catégorie de POIs. Révèle les zones d'influence géographique exclusives de chaque établissement.",
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Catégorie de POIs à analyser (ex: cirfa, lycee, lycee_pro, caserne)',
          },
        },
        required: ['category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'isochrone_analysis',
      description:
        "Calcule la zone isochrone (zone accessible en X minutes) autour d'un point géographique.",
      parameters: {
        type: 'object',
        properties: {
          lat:     { type: 'number', description: 'Latitude du point central (WGS84)' },
          lng:     { type: 'number', description: 'Longitude du point central (WGS84)' },
          minutes: { type: 'number', description: 'Durée en minutes (1-60)' },
          mode: {
            type: 'string',
            enum: ['walk', 'drive', 'bike'],
            description: 'Mode de transport : walk (à pied), drive (voiture), bike (vélo)',
          },
        },
        required: ['lat', 'lng', 'minutes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'proximity_analysis',
      description:
        "Retourne les POIs d'une catégorie dans un rayon kilométrique autour d'un point, triés par distance.",
      parameters: {
        type: 'object',
        properties: {
          category:  { type: 'string', description: 'Catégorie de POIs' },
          lat:       { type: 'number', description: 'Latitude du centre' },
          lng:       { type: 'number', description: 'Longitude du centre' },
          radius_km: { type: 'number', description: 'Rayon en kilomètres (défaut: 10)' },
        },
        required: ['category', 'lat', 'lng'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'persist_result',
      description:
        "Sauvegarde un résultat d'analyse géospatiale dans la base de données avec un nom donné par l'utilisateur.",
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: "Nom de l'analyse (ex: Zone Influence Nord, Isochrone Paris 30min)",
          },
          geojson: {
            type: 'object',
            description: 'FeatureCollection GeoJSON à sauvegarder',
          },
          category_target: {
            type: 'string',
            description: 'Catégorie de POIs analysée',
          },
          analysis_type: {
            type: 'string',
            enum: ['voronoi', 'isochrone', 'proximity'],
            description: "Type d'analyse",
          },
        },
        required: ['name', 'geojson', 'analysis_type'],
      },
    },
  },
];

// =============================================================================
// Exécution des outils
// =============================================================================

// Dernier GeoJSON produit par l'analyse courante (passé à persist_result si besoin)
let _lastGeoJSON: GeoJSONFeatureCollection | null = null;

async function runVoronoiAnalysis(
  category: string
): Promise<{ geojson: GeoJSONFeatureCollection; summary: string }> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_voronoi_by_category', {
    cat_name: category,
  });

  if (error) {
    throw new Error(`Erreur Voronoï SQL: ${error.message}`);
  }

  const features = Array.isArray(data) ? data : [];
  const geojson: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features,
    _meta: { analysis_type: 'voronoi', category },
  };

  _lastGeoJSON = geojson;

  const summary =
    features.length === 0
      ? `Aucun polygone Voronoï généré pour la catégorie "${category}". Vérifiez que cette catégorie existe et contient au moins 2 points.`
      : `Voronoï généré : ${features.length} polygones pour la catégorie "${category}". ` +
        `Chaque polygone représente la zone d'influence exclusive d'un établissement.`;

  console.log(`[spatial/voronoi] ${summary}`);
  return { geojson, summary };
}

async function runIsochroneAnalysis(
  lat: number,
  lng: number,
  minutes: number,
  mode: string = 'walk'
): Promise<{ geojson: GeoJSONFeatureCollection; summary: string }> {
  const ORS_KEY = process.env.ORS_API_KEY ?? '';
  if (!ORS_KEY) {
    throw new Error('ORS_API_KEY non configurée dans .env.local');
  }

  const profileMap: Record<string, string> = {
    walk:  'foot-walking',
    drive: 'driving-car',
    bike:  'cycling-regular',
  };
  const profile = profileMap[mode] ?? 'foot-walking';

  const res = await fetch(
    `https://api.openrouteservice.org/v2/isochrones/${profile}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: ORS_KEY,
      },
      body: JSON.stringify({
        locations: [[lng, lat]],
        range:      [minutes * 60],
        range_type: 'time',
      }),
    }
  );

  if (res.status === 429) {
    throw new Error('Limite de requêtes ORS atteinte. Réessayez dans quelques secondes.');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ORS API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const geojson: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: data.features ?? [],
    _meta:    { analysis_type: 'isochrone', lat, lng, minutes, mode },
  };

  _lastGeoJSON = geojson;

  const summary = `Isochrone calculée : zone accessible en ${minutes} min (${mode}) depuis [${lat}, ${lng}]. ${geojson.features.length} polygone(s) généré(s).`;
  console.log(`[spatial/isochrone] ${summary}`);
  return { geojson, summary };
}

async function runProximityAnalysis(
  category: string,
  lat: number,
  lng: number,
  radius_km: number = 10
): Promise<{ geojson: GeoJSONFeatureCollection; summary: string }> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_proximity_by_category', {
    cat_name:   category,
    center_lat: lat,
    center_lng: lng,
    radius_km,
  });

  if (error) {
    throw new Error(`Erreur Proximité SQL: ${error.message}`);
  }

  const features = Array.isArray(data) ? data : [];
  const geojson: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features,
    _meta: { analysis_type: 'proximity', category, lat, lng, radius_km },
  };

  _lastGeoJSON = geojson;

  const summary =
    features.length === 0
      ? `Aucun POI trouvé pour "${category}" dans un rayon de ${radius_km} km.`
      : `Proximité : ${features.length} POI(s) "${category}" trouvés dans un rayon de ${radius_km} km autour de [${lat}, ${lng}].`;

  console.log(`[spatial/proximity] ${summary}`);
  return { geojson, summary };
}

async function runPersistResult(
  name: string,
  geojson: GeoJSONFeatureCollection,
  category_target: string | undefined,
  analysis_type: string
): Promise<{ id: string; summary: string }> {
  const supabase = createAdminClient();

  const features = geojson?.features ?? [];

  const { data, error } = await supabase
    .from('saved_analysis')
    .insert({
      name,
      category_target: category_target ?? null,
      analysis_type,
      geojson_data: geojson,
      poi_count:    features.length,
      metadata:     geojson._meta ?? {},
      created_at:   new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Erreur sauvegarde: ${error.message}`);
  }

  const summary = `Analyse "${name}" sauvegardée avec succès (id: ${data.id}, ${features.length} entité(s)).`;
  console.log(`[spatial/persist] ${summary}`);
  return { id: data.id, summary };
}

async function executeTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ toolResult: string; geojson?: GeoJSONFeatureCollection; savedId?: string }> {
  try {
    switch (toolName) {
      case 'voronoi_analysis': {
        const { geojson, summary } = await runVoronoiAnalysis(String(args.category));
        return { toolResult: summary, geojson };
      }

      case 'isochrone_analysis': {
        const { geojson, summary } = await runIsochroneAnalysis(
          Number(args.lat),
          Number(args.lng),
          Number(args.minutes),
          args.mode ? String(args.mode) : 'walk'
        );
        return { toolResult: summary, geojson };
      }

      case 'proximity_analysis': {
        const { geojson, summary } = await runProximityAnalysis(
          String(args.category),
          Number(args.lat),
          Number(args.lng),
          args.radius_km != null ? Number(args.radius_km) : 10
        );
        return { toolResult: summary, geojson };
      }

      case 'persist_result': {
        // Si Mistral ne passe pas le GeoJSON (trop volumineux en texte), utiliser le dernier connu
        const geoJSON = (args.geojson as GeoJSONFeatureCollection) ?? _lastGeoJSON;
        if (!geoJSON) {
          return { toolResult: 'Aucun GeoJSON disponible à sauvegarder. Lancez d\'abord une analyse.' };
        }
        const { id, summary } = await runPersistResult(
          String(args.name),
          geoJSON,
          args.category_target ? String(args.category_target) : undefined,
          String(args.analysis_type ?? 'voronoi')
        );
        return { toolResult: summary, savedId: id };
      }

      default:
        return { toolResult: `Outil inconnu: ${toolName}` };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[spatial/${toolName}] Erreur:`, msg);
    return { toolResult: `Erreur lors de l'exécution de ${toolName}: ${msg}` };
  }
}

// =============================================================================
// Appel Mistral
// =============================================================================

async function callMistral(messages: SpatialMessage[]): Promise<MistralResponse> {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model:       'mistral-large-latest',
      messages,
      tools:       SPATIAL_TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mistral API ${res.status}: ${err}`);
  }

  return res.json();
}

// =============================================================================
// Boucle principale d'agent (agentic loop)
// =============================================================================

export async function runSpatialAgent(
  userMessage: string,
  history: SpatialMessage[] = []
): Promise<SpatialResult> {
  // Réinitialiser le GeoJSON courant pour cette session
  _lastGeoJSON = null;

  const messages: SpatialMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ];

  let lastGeoJSON: GeoJSONFeatureCollection | null = null;
  let lastAnalysisType: 'voronoi' | 'isochrone' | 'proximity' | null = null;
  let lastSavedId: string | null = null;
  const MAX_ITERATIONS = 6;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await callMistral(messages);
    const choice   = response.choices[0];
    const message  = choice.message;

    // Ajouter la réponse assistant à l'historique
    messages.push(message);

    // Si Mistral a terminé → retourner la réponse
    if (choice.finish_reason === 'stop' || !message.tool_calls?.length) {
      return {
        reply:        message.content ?? '',
        geojson:      lastGeoJSON,
        analysisType: lastAnalysisType,
        savedId:      lastSavedId,
        poiCount:     lastGeoJSON?.features.length ?? 0,
      };
    }

    // Exécuter les outils appelés par Mistral
    for (const toolCall of message.tool_calls!) {
      const toolName = toolCall.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        console.warn(`[spatial] Arguments invalides pour ${toolName}`);
      }

      console.log(`[spatial] Outil: ${toolName}`, args);

      const { toolResult, geojson, savedId } = await executeTool(toolName, args);

      if (geojson) {
        lastGeoJSON      = geojson;
        lastAnalysisType = (geojson._meta?.analysis_type as typeof lastAnalysisType) ?? null;
      }
      if (savedId) {
        lastSavedId = savedId;
      }

      // Résultat de l'outil → message tool dans l'historique
      messages.push({
        role:         'tool',
        content:      toolResult,
        tool_call_id: toolCall.id,
        name:         toolName,
      });
    }
  }

  // Si on dépasse le nombre max d'itérations
  return {
    reply:        'Limite d\'itérations atteinte. L\'analyse peut être incomplète.',
    geojson:      lastGeoJSON,
    analysisType: lastAnalysisType,
    savedId:      lastSavedId,
    poiCount:     lastGeoJSON?.features.length ?? 0,
  };
}
