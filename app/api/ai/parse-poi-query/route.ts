/**
 * GENESIS — API Route — POST /api/ai/parse-poi-query
 * Parse natural language query using Mistral AI (via fetch, no SDK)
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveFilters } from '@/lib/geo-resolver';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

export async function POST(request: NextRequest) {
  try {
    const { prompt, availableCategories, availableFilterValues } = await request.json();

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: 'Prompt requis' }, { status: 400 });
    }

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      console.error('[parse-poi-query] MISTRAL_API_KEY not configured');
      return NextResponse.json({ error: 'AI service not configured' }, { status: 500 });
    }

    console.log('[parse-poi-query] Parsing prompt:', prompt);
    console.log('[parse-poi-query] Available categories:', availableCategories);

    // Build dynamic categories section
    const categoriesSection = availableCategories && availableCategories.length > 0
      ? `CATEGORIES DE POI DANS LA BASE:\n${availableCategories.map((c: string) => `- ${c}`).join('\n')}`
      : `CATEGORIE DE POI DISPONIBLE:\n- lycee (lycées)\n- college (collèges)\n- gare (gares)\n- sport (équipements sportifs)\n- autre (autres POI)`;

    // Build dynamic filter values section
    let filterValuesSection = '';
    if (availableFilterValues && Object.keys(availableFilterValues).length > 0) {
      filterValuesSection = '\n\nVALEURS EXACTES DISPONIBLES POUR LES FILTRES:';
      Object.entries(availableFilterValues).forEach(([field, values]: [string, any]) => {
        const sampleValues = values.slice(0, 30);
        filterValuesSection += `\n- ${field}: ${sampleValues.join(', ')}${values.length > 30 ? '...' : ''}`;
      });
      filterValuesSection += '\n\nIMPORTANT: Utilise les valeurs EXACTES ci-dessus (même casse, même accents) dans ta réponse JSON.';
    }

    const systemPrompt = `Tu es un assistant spécialisé dans la recherche de points d'intérêt (POI) en France.

L'utilisateur tape un prompt en langage naturel pour chercher des POI sur une carte interactive.

${categoriesSection}

TYPES DE FILTRES DISPONIBLES:
- ville: nom d'une ville spécifique (Brest, Toulouse, Lyon, Nice, etc.)
- region: région française (le nom, un alias, ou une abréviation comme IDF, PACA, etc.)
- departement: département français (le nom ou le numéro comme 75, 13, 29, etc.)
- code_postal: code postal (ex: "75016" pour le 16ème arrondissement de Paris)
- sous_categorie: sous-catégories spécifiques${filterValuesSection}

IMPORTANT POUR LES FILTRES:
- VILLE vs DEPARTEMENT: Quand l'utilisateur mentionne une VILLE (Brest, Toulouse, Nice, Lyon, Nantes, Rennes, Nancy, Toulon, etc.), utilise le filtre "ville" avec le nom de la ville. N'utilise "departement" QUE si l'utilisateur mentionne explicitement un département (par numéro "75", "59" ou par nom "Finistère", "Nord").
- Pour "departement": retourne le numéro ("75") ou le nom ("Finistère") — le système résoudra automatiquement.
- Pour "region": retourne le nom exact, un alias ("IDF", "PACA", "rhone alpes") — le système résoudra automatiquement.
- Pour les ARRONDISSEMENTS de Paris/Lyon/Marseille: utilise "code_postal" avec le code postal (ex: "75016" = 16ème de Paris)
- Exception: "Paris" est à la fois une ville et un département. Si l'utilisateur dit juste "paris", utilise "departement":"Paris". Si l'utilisateur dit "ville de Paris", utilise "ville":"Paris".

Ton job: Parser le prompt et extraire:
1. Les CATEGORIES de POI (obligatoire, peut être PLUSIEURS)
2. Les FILTRES souhaités (optionnel)

REPONSE FORMAT (JSON ONLY):
{
  "categories": ["nom_categorie1", "nom_categorie2"],
  "filters": {
    "ville": "nom_ville" ou ["ville1", "ville2"],
    "region": "valeur" ou ["valeur1", "valeur2"],
    "departement": "valeur" ou ["valeur1", "valeur2"],
    "code_postal": "valeur"
  },
  "explanation": "Explication courte en français"
}

ATTENTION: "categories" est TOUJOURS un TABLEAU (array), même pour une seule catégorie.
Les valeurs de "filters" peuvent être une STRING unique ou un TABLEAU de strings si l'utilisateur demande PLUSIEURS lieux.
Par exemple: "lycées brest et rennes" → "ville": ["Brest", "Rennes"]
N'inclure dans "filters" QUE les champs pertinents (pas de champ vide).

EXEMPLES:
- "lycées de brest" → {"categories":["lycee"],"filters":{"ville":"Brest"},"explanation":"Recherche de lycées à Brest"}
- "collèges toulouse" → {"categories":["college"],"filters":{"ville":"Toulouse"},"explanation":"Recherche de collèges à Toulouse"}
- "lycées brest et rennes" → {"categories":["lycee"],"filters":{"ville":["Brest","Rennes"]},"explanation":"Recherche de lycées à Brest et Rennes"}
- "lycées à Brest, Toulon, Nancy et dans le département du Nord" → {"categories":["lycee"],"filters":{"ville":["Brest","Toulon","Nancy"],"departement":"Nord"},"explanation":"Recherche de lycées à Brest, Toulon, Nancy et dans le Nord"}
- "lycées paris" → {"categories":["lycee"],"filters":{"departement":"Paris"},"explanation":"Recherche de lycées à Paris"}
- "lycées du 75" → {"categories":["lycee"],"filters":{"departement":"75"},"explanation":"Recherche de lycées dans le département 75"}
- "lycées du finistère" → {"categories":["lycee"],"filters":{"departement":"Finistère"},"explanation":"Recherche de lycées dans le Finistère"}
- "lycées d'île de france" → {"categories":["lycee"],"filters":{"region":"Ile-de-France"},"explanation":"Recherche de lycées en Île-de-France"}
- "lycées et cirfa en île de france" → {"categories":["lycee","cirfa"],"filters":{"region":"Ile-de-France"},"explanation":"Recherche de lycées et CIRFA en Île-de-France"}
- "lycées du 16ème arrondissement de paris" → {"categories":["lycee"],"filters":{"code_postal":"75016"},"explanation":"Recherche de lycées dans le 16ème arrondissement de Paris"}
- "tout en bretagne" → {"categories":[],"filters":{"region":"Bretagne"},"explanation":"Tous les POI en Bretagne"}
- "lycées IDF et PACA" → {"categories":["lycee"],"filters":{"region":["Ile-de-France","Provence-Alpes-Côte d'Azur"]},"explanation":"Recherche de lycées en IDF et PACA"}

Extrais UNIQUEMENT ce que l'utilisateur demande explicitement.
Si la catégorie n'est pas claire ou que l'utilisateur veut tout, retourne un tableau vide [].
Si pas de filtre géo spécifié, retourne filters VIDE {}.

IMPORTANT: Réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks.`;

    const mistralResponse = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-large-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!mistralResponse.ok) {
      const errorText = await mistralResponse.text();
      console.error('[parse-poi-query] Mistral API error:', mistralResponse.status, errorText);
      return NextResponse.json({ error: `Mistral API error: ${mistralResponse.status}` }, { status: 502 });
    }

    const mistralData = await mistralResponse.json();
    const content = mistralData.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 502 });
    }

    console.log('[parse-poi-query] Raw Mistral response:', content);

    // Parse JSON (strip markdown backticks if present)
    const cleanedContent = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleanedContent);
    } catch {
      console.error('[parse-poi-query] Failed to parse JSON:', cleanedContent);
      return NextResponse.json({ error: 'Failed to parse AI response', raw: cleanedContent }, { status: 500 });
    }

    // Resolve filters using geo-resolver
    const resolvedFilters = parsed.filters && Object.keys(parsed.filters).length > 0
      ? resolveFilters(parsed.filters, availableFilterValues)
      : {};

    console.log('[parse-poi-query] Resolved filters:', JSON.stringify(resolvedFilters));

    return NextResponse.json({
      success: true,
      categories: parsed.categories || [],
      filters: resolvedFilters,
      explanation: parsed.explanation || '',
      raw: parsed,
    });
  } catch (error) {
    console.error('[parse-poi-query] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
