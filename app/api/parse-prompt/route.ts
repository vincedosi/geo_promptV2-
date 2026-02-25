import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// ============================================================================
// SCHÉMA ZOD pour validation
// ============================================================================

const FiltresSchema = z.object({
  region: z.string().nullable().default(null),
  ville: z.string().nullable().default(null),
  poi_type: z.string().nullable().default(null),
  poi_rayon_m: z.number().nullable().default(null),
  poi_filtre: z.record(z.unknown()).nullable().default(null),
  cible_age: z.string().nullable().default(null),
  regie: z.string().nullable().default(null),
  format: z.string().nullable().default(null),
  nb_resultats: z.number().int().positive().default(50),
});

type Filtres = z.infer<typeof FiltresSchema>;

const ReponseSchema = z.object({
  filtres: FiltresSchema,
  confiance: z.number().min(0).max(1),
  prompt_original: z.string(),
  raison: z.string().optional(),
});

// ============================================================================
// SYSTEM PROMPT avec few-shot examples
// ============================================================================

const SYSTEM_PROMPT = `Tu es un expert en parsing de prompts marketing français pour transformer des demandes en filtres de recherche structurés.

EXEMPLES:

1. Prompt: "je veux toucher les jeunes autour des lycées à Brest"
   JSON: {
     "region": "Bretagne",
     "ville": "Brest",
     "poi_type": "lycee",
     "poi_rayon_m": 500,
     "cible_age": "15_29",
     "nb_resultats": 50
   }

2. Prompt: "panneaux proches des CIRFA Air en Île-de-France"
   JSON: {
     "region": "Île-de-France",
     "poi_type": "cirfa",
     "poi_filtre": {"cle": "milieu", "valeur": "AIR"},
     "nb_resultats": 50
   }

3. Prompt: "grands formats JCDecaux à Marseille"
   JSON: {
     "ville": "Marseille",
     "regie": "JCDecaux",
     "format": "4x3",
     "nb_resultats": 50
   }

RÈGLES:
- Extrais UNIQUEMENT les champs mentionnés
- Si un champ n'est pas mentionné, mets null (pas de valeur par défaut)
- nb_resultats: par défaut 50 si pas mentionné
- Retourne TOUJOURS du JSON valide
- Ajoute un champ "confiance" (0-1) indiquant ta certitude du parsing
- Ajoute un champ "raison" expliquant les choix clés`;

// ============================================================================
// ROUTE API
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'prompt requis (string)' },
        { status: 400 }
      );
    }

    const promptTrimmed = prompt.trim();
    if (promptTrimmed.length === 0) {
      return NextResponse.json(
        { error: 'prompt vide' },
        { status: 400 }
      );
    }

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      console.error('[parse-prompt] MISTRAL_API_KEY manquante');
      return NextResponse.json(
        { error: 'MISTRAL_API_KEY non configurée' },
        { status: 500 }
      );
    }

    // ========================================================================
    // APPEL MISTRAL API avec mode JSON strict
    // ========================================================================

    const mistralResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: `Parse ce prompt marketing: "${promptTrimmed}"`,
          },
        ],
        response_format: {
          type: 'json_object',
        },
        temperature: 0.3, // Basse température pour cohérence
        max_tokens: 500,
      }),
    });

    if (!mistralResponse.ok) {
      const errorText = await mistralResponse.text();
      console.error('[parse-prompt] Mistral API error:', mistralResponse.status, errorText);
      return NextResponse.json(
        { error: `Mistral API error: ${mistralResponse.status}` },
        { status: 500 }
      );
    }

    const mistralData = await mistralResponse.json();
    const rawContent = mistralData.choices?.[0]?.message?.content;

    if (!rawContent) {
      console.error('[parse-prompt] Réponse Mistral vide');
      return NextResponse.json(
        { error: 'Réponse Mistral vide' },
        { status: 500 }
      );
    }

    console.log('[parse-prompt] Réponse Mistral brute:', rawContent);

    // ========================================================================
    // PARSING & VALIDATION
    // ========================================================================

    let jsonData: any;
    try {
      jsonData = JSON.parse(rawContent);
    } catch (parseError) {
      console.error('[parse-prompt] Erreur JSON parse:', parseError);
      return NextResponse.json(
        { error: 'Réponse Mistral n\'est pas du JSON valide' },
        { status: 500 }
      );
    }

    // Extraction des champs principaux
    const { confiance = 0.8, raison = '', ...filtresRaw } = jsonData;

    // Validation Zod
    let filtres: Filtres;
    try {
      filtres = FiltresSchema.parse(filtresRaw);
    } catch (zodError) {
      console.error('[parse-prompt] Validation Zod échouée:', zodError);
      return NextResponse.json(
        { error: 'Filtres ne correspondent pas au schéma attendu' },
        { status: 400 }
      );
    }

    // ========================================================================
    // RÉPONSE
    // ========================================================================

    const response = {
      filtres,
      confiance: Math.min(Math.max(Number(confiance) || 0.8, 0), 1), // 0-1
      prompt_original: promptTrimmed,
      raison: raison || undefined,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[parse-prompt] Exception:', error);
    return NextResponse.json(
      { error: 'Erreur serveur interne' },
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
