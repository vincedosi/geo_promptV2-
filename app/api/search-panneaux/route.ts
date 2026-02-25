import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ============================================================================
// SCHÉMA ZOD pour validation des filtres
// ============================================================================

const FiltresSchema = z.object({
  region: z.string().nullable().optional(),
  ville: z.string().nullable().optional(),
  poi_type: z.string().nullable().optional(),
  poi_rayon_m: z.number().int().positive().nullable().optional(),
  cible_age: z.string().nullable().optional(),
  nb_resultats: z.number().int().positive().default(50),
});

type Filtres = z.infer<typeof FiltresSchema>;

// ============================================================================
// INTERFACE Panneaux
// ============================================================================

interface Panneau {
  id: string;
  latitude: number;
  longitude: number;
  ville?: string;
  region?: string;
  format?: string;
  regie?: string;
  [key: string]: any;
}

// ============================================================================
// ROUTE API
// ============================================================================

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[search-panneaux:${requestId}] === DEBUT DE LA REQUETE ===`);

  try {
    // ========================================================================
    // ÉTAPE 1: Lecture et validation du body
    // ========================================================================

    console.log(`[search-panneaux:${requestId}] Lecture du body...`);
    let body: any;

    try {
      body = await request.json();
      console.log(`[search-panneaux:${requestId}] Body reçu:`, JSON.stringify(body));
    } catch (parseError) {
      console.error(`[search-panneaux:${requestId}] Erreur parsing JSON:`, parseError);
      return NextResponse.json(
        { error: 'Body invalide (JSON parse error)', details: String(parseError) },
        { status: 400 }
      );
    }

    // ========================================================================
    // ÉTAPE 2: Validation Zod
    // ========================================================================

    console.log(`[search-panneaux:${requestId}] Validation Zod...`);
    let filtres: Filtres;

    try {
      filtres = FiltresSchema.parse(body);
      console.log(`[search-panneaux:${requestId}] Filtres validés:`, filtres);
    } catch (zodError) {
      console.error(`[search-panneaux:${requestId}] Erreur Zod:`, zodError);
      return NextResponse.json(
        {
          error: 'Filtres invalides',
          details: zodError instanceof z.ZodError ? zodError.errors : String(zodError)
        },
        { status: 400 }
      );
    }

    // ========================================================================
    // ÉTAPE 3: Vérification des variables Supabase
    // ========================================================================

    console.log(`[search-panneaux:${requestId}] Vérification des variables Supabase...`);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl) {
      console.error(`[search-panneaux:${requestId}] NEXT_PUBLIC_SUPABASE_URL manquante`);
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SUPABASE_URL non configurée' },
        { status: 500 }
      );
    }

    if (!supabaseAnonKey) {
      console.error(`[search-panneaux:${requestId}] SUPABASE_ANON_KEY manquante`);
      return NextResponse.json(
        { error: 'SUPABASE_ANON_KEY non configurée' },
        { status: 500 }
      );
    }

    console.log(`[search-panneaux:${requestId}] Variables Supabase OK`);

    // ========================================================================
    // ÉTAPE 4: Initialisation Supabase
    // ========================================================================

    console.log(`[search-panneaux:${requestId}] Initialisation Supabase...`);
    let supabase;

    try {
      supabase = createClient(supabaseUrl, supabaseAnonKey);
      console.log(`[search-panneaux:${requestId}] Client Supabase créé`);
    } catch (supabaseInitError) {
      console.error(`[search-panneaux:${requestId}] Erreur init Supabase:`, supabaseInitError);
      return NextResponse.json(
        { error: 'Erreur initialisation Supabase', details: String(supabaseInitError) },
        { status: 500 }
      );
    }

    // ========================================================================
    // ÉTAPE 5: Récupération des panneaux
    // ========================================================================

    console.log(`[search-panneaux:${requestId}] Récupération des panneaux...`);
    let panneaux: Panneau[] = [];

    // Cas 1: Recherche par POI avec rayon
    if (filtres.poi_type && filtres.poi_rayon_m) {
      console.log(`[search-panneaux:${requestId}] Mode: Recherche par POI (type=${filtres.poi_type}, rayon=${filtres.poi_rayon_m}m)`);

      try {
        // Étape 5a: Récupérer un POI de ce type
        console.log(`[search-panneaux:${requestId}] Récupération d'un POI de type: ${filtres.poi_type}`);

        let poiQuery = supabase.from('poi_france').select('lat, lng').eq('categorie', filtres.poi_type);

        // Filtre par ville si disponible
        if (filtres.ville) {
          console.log(`[search-panneaux:${requestId}] Filtre POI par ville: ${filtres.ville}`);
          poiQuery = poiQuery.ilike('ville', `%${filtres.ville}%`);
        }

        // Limiter à 1 POI
        poiQuery = poiQuery.limit(1);

        const { data: poiData, error: poiError } = await poiQuery;

        if (poiError) {
          console.error(`[search-panneaux:${requestId}] Erreur lors de la récupération du POI:`, poiError);
          return NextResponse.json(
            {
              error: 'Erreur lors de la récupération du POI',
              details: poiError.message
            },
            { status: 500 }
          );
        }

        if (!poiData || poiData.length === 0) {
          console.log(`[search-panneaux:${requestId}] Aucun POI trouvé pour type: ${filtres.poi_type}`);
          return NextResponse.json(
            {
              panneaux: [],
              filtres_appliques: filtres,
              total: 0,
              note: `Aucun POI trouvé du type: ${filtres.poi_type}`,
            },
            { status: 200 }
          );
        }

        const poi = poiData[0];
        console.log(`[search-panneaux:${requestId}] POI trouvé: lat=${poi.lat}, lng=${poi.lng}`);

        // Étape 5b: Appeler panneaux_near_point avec les coordonnées du POI
        console.log(`[search-panneaux:${requestId}] Appel RPC panneaux_near_point avec lat=${poi.lat}, lng=${poi.lng}...`);

        const { data: pannegData, error: pannegError } = await supabase.rpc('panneaux_near_point', {
          p_lat: poi.lat,
          p_lng: poi.lng,
          p_rayon_m: filtres.poi_rayon_m,
          p_limit: filtres.nb_resultats || 50,
        });

        if (pannegError) {
          console.error(`[search-panneaux:${requestId}] Erreur RPC panneaux_near_point:`, pannegError);
          return NextResponse.json(
            {
              error: 'Erreur lors de l\'appel à la fonction PostGIS panneaux_near_point',
              details: pannegError.message,
              hint: 'Vérifie que la fonction panneaux_near_point existe en base avec les bons paramètres'
            },
            { status: 500 }
          );
        }

        if (!pannegData) {
          console.log(`[search-panneaux:${requestId}] RPC panneaux_near_point retourné null`);
          panneaux = [];
        } else {
          panneaux = pannegData as Panneau[];
          console.log(`[search-panneaux:${requestId}] ${panneaux.length} panneaux trouvés via RPC panneaux_near_point`);
        }
      } catch (rpcError) {
        console.error(`[search-panneaux:${requestId}] Exception lors du RPC:`, rpcError);
        return NextResponse.json(
          {
            error: 'Erreur lors de l\'exécution de la fonction PostGIS',
            details: String(rpcError)
          },
          { status: 500 }
        );
      }
    }
    // Cas 2: Recherche simple par filtres géographiques
    else {
      console.log(`[search-panneaux:${requestId}] Mode: Recherche simple (ville/région)`);

      try {
        let query = supabase.from('panneaux_affichage').select('*');

        // Filtre par ville
        if (filtres.ville) {
          console.log(`[search-panneaux:${requestId}] Filtre ville: ${filtres.ville}`);
          query = query.ilike('ville', `%${filtres.ville}%`);
        }

        // Filtre par région
        if (filtres.region) {
          console.log(`[search-panneaux:${requestId}] Filtre région: ${filtres.region}`);
          query = query.ilike('region', `%${filtres.region}%`);
        }

        // Limite les résultats
        const limit = filtres.nb_resultats || 50;
        query = query.limit(limit);

        const { data: panneauxData, error: panneauxError } = await query;

        if (panneauxError) {
          console.error(`[search-panneaux:${requestId}] Erreur Supabase:`, panneauxError);
          return NextResponse.json(
            {
              error: 'Erreur lors de la récupération des panneaux',
              details: panneauxError.message
            },
            { status: 500 }
          );
        }

        if (panneauxData) {
          panneaux = panneauxData as Panneau[];
          console.log(`[search-panneaux:${requestId}] ${panneaux.length} panneaux trouvés`);
        }
      } catch (queryError) {
        console.error(`[search-panneaux:${requestId}] Exception lors de la requête:`, queryError);
        return NextResponse.json(
          {
            error: 'Erreur lors de la requête Supabase',
            details: String(queryError)
          },
          { status: 500 }
        );
      }
    }

    // ========================================================================
    // ÉTAPE 6: Limitation et réponse
    // ========================================================================

    const nb_resultats = filtres.nb_resultats || 50;
    const panneguxFinaux = panneaux.slice(0, nb_resultats);

    console.log(`[search-panneaux:${requestId}] Retour ${panneguxFinaux.length}/${nb_resultats} panneaux`);

    const response = {
      panneaux: panneguxFinaux,
      filtres_appliques: filtres,
      total: panneguxFinaux.length,
      total_base: panneaux.length,
    };

    console.log(`[search-panneaux:${requestId}] === FIN DE LA REQUETE (SUCCESS) ===`);

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error(`[search-panneaux] ERREUR GLOBALE:`, error);
    console.error(`[search-panneaux] Stack:`, error instanceof Error ? error.stack : 'N/A');

    return NextResponse.json(
      {
        error: 'Erreur serveur interne',
        details: error instanceof Error ? error.message : String(error),
        requestId: typeof requestId !== 'undefined' ? requestId : 'unknown',
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// OPTIONS pour CORS
// ============================================================================

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
