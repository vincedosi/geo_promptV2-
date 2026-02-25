/**
 * GEO.Prompt — API Route — POST /api/ai/parse-poi-query
 * Parse natural language POI queries using Mistral AI
 * Returns: categories[] + filters{} (supports multi-value arrays for OR logic)
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveFilters } from '@/lib/geo-resolver';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MODEL = 'mistral-small-latest';

export async function POST(request: NextRequest) {
  try {
    const { prompt, availableCategories, availableFilterValues } = await request.json();

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt requis' }, { status: 400 });
    }

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      console.error('[parse-poi-query] MISTRAL_API_KEY non configurée');
      return NextResponse.json({ error: 'Service IA non configuré (clé manquante)' }, { status: 500 });
    }

    console.log('[parse-poi-query] Prompt:', prompt);

    // --- Build categories context ---
    const categoriesSection =
      availableCategories?.length > 0
        ? `CATÉGORIES DISPONIBLES EN BASE:\n${availableCategories.map((c: string) => `- "${c}"`).join('\n')}`
        : 'CATÉGORIES DISPONIBLES:\n- "lycee"\n- "college"\n- "autre"';

    // --- Build filter values context (sample of actual data values) ---
    let filterValuesSection = '';
    if (availableFilterValues && Object.keys(availableFilterValues).length > 0) {
      filterValuesSection = '\n\nVALEURS EXACTES DISPONIBLES (utilise ces valeurs telles quelles):';
      for (const [field, values] of Object.entries(availableFilterValues as Record<string, string[]>)) {
        const sample = (values as string[]).slice(0, 25);
        filterValuesSection += `\n- ${field}: ${sample.join(' | ')}${(values as string[]).length > 25 ? ` (+${(values as string[]).length - 25} autres)` : ''}`;
      }
    }

    const systemPrompt = `Tu es GEO.AI, assistant expert en recherche de points d'intérêt (POI) en France sur une carte interactive.

${categoriesSection}

TYPES DE FILTRES GÉOGRAPHIQUES DISPONIBLES:
- "ville": nom d'une ville (Brest, Versailles, Quimper, Lyon, Rennes, Strasbourg...)
- "region": région française — nom complet ou alias (Île-de-France, Bretagne, PACA, IDF, HDF, ARA, Normandie...)
- "departement": département — nom ou numéro (Finistère, 29, Nord, 59, Paris, 75, Bas-Rhin, 67...)
- "code_postal": code postal exact à 5 chiffres (75016, 69001, 13008...)
${filterValuesSection}

RÈGLES CRITIQUES:
1. "categories" est TOUJOURS un tableau JSON, même pour une seule catégorie: ["lycee"] pas "lycee"
2. Pour PLUSIEURS villes ou régions → utilise un TABLEAU: ["Brest", "Versailles", "Quimper"]
3. "lycées de Versailles et Quimper" → "ville": ["Versailles", "Quimper"]
4. "lycées IDF et Bretagne" → "region": ["Île-de-France", "Bretagne"]
5. "lycées Finistère et Morbihan" → "departement": ["Finistère", "Morbihan"]
6. Si catégorie non précisée ou floue → "categories": []
7. Si pas de filtre géographique → "filters": {}
8. "Paris" seul → "departement": "Paris" (tout Paris). "ville de Paris" → "ville": "Paris"
9. Alias régions: IDF→Île-de-France, PACA→Provence-Alpes-Côte d'Azur, ARA→Auvergne-Rhône-Alpes, HDF→Hauts-de-France, NA→Nouvelle-Aquitaine
10. Numéros département: 29→Finistère, 75→Paris, 59→Nord, 06→Alpes-Maritimes, 13→Bouches-du-Rhône, 69→Rhône
11. On peut combiner PLUSIEURS types de filtres: ville ET departement, region ET sous_categorie, etc.
12. Ne jamais inventer des valeurs — préfère les valeurs exactes listées ci-dessus quand elles existent

FORMAT DE RÉPONSE — JSON strict, aucun texte avant ou après:
{
  "categories": ["categorie1", "categorie2"],
  "filters": {
    "ville": "une_ville" OU ["ville1", "ville2", "ville3"],
    "region": "une_region" OU ["region1", "region2"],
    "departement": "dept" OU ["dept1", "dept2"],
    "code_postal": "75016"
  },
  "explanation": "Courte explication en français de ce qui sera affiché sur la carte"
}

EXEMPLES CONCRETS:
- "lycées de Versailles et Quimper" → {"categories":["lycee"],"filters":{"ville":["Versailles","Quimper"]},"explanation":"Lycées à Versailles et Quimper"}
- "lycées IDF" → {"categories":["lycee"],"filters":{"region":"Île-de-France"},"explanation":"Lycées en Île-de-France"}
- "lycées IDF et Bretagne" → {"categories":["lycee"],"filters":{"region":["Île-de-France","Bretagne"]},"explanation":"Lycées en Île-de-France et Bretagne"}
- "lycées et collèges en bretagne" → {"categories":["lycee","college"],"filters":{"region":"Bretagne"},"explanation":"Lycées et collèges en Bretagne"}
- "collèges dans le nord" → {"categories":["college"],"filters":{"departement":"Nord"},"explanation":"Collèges dans le département du Nord"}
- "lycées finistère et morbihan" → {"categories":["lycee"],"filters":{"departement":["Finistère","Morbihan"]},"explanation":"Lycées dans le Finistère et le Morbihan"}
- "lycées du 16ème" → {"categories":["lycee"],"filters":{"code_postal":"75016"},"explanation":"Lycées dans le 16ème arrondissement de Paris"}
- "lycées Versailles Quimper et Brest" → {"categories":["lycee"],"filters":{"ville":["Versailles","Quimper","Brest"]},"explanation":"Lycées à Versailles, Quimper et Brest"}
- "tous les POI en PACA" → {"categories":[],"filters":{"region":"Provence-Alpes-Côte d'Azur"},"explanation":"Tous les POI en PACA"}
- "concessions auto île de france" → {"categories":["concession_auto"],"filters":{"region":"Île-de-France"},"explanation":"Concessions automobile en Île-de-France"}
- "CIRFA en bretagne et normandie" → {"categories":["cirfa"],"filters":{"region":["Bretagne","Normandie"]},"explanation":"CIRFA en Bretagne et Normandie"}
- "tout afficher" → {"categories":[],"filters":{},"explanation":"Tous les POI disponibles"}`;

    const response = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt.trim() },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 600,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[parse-poi-query] Mistral API error:', response.status, errorBody);
      return NextResponse.json(
        { error: `Erreur Mistral (${response.status}) — vérifiez la clé API et le quota` },
        { status: 502 }
      );
    }

    const mistralData = await response.json();
    const content = mistralData.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: 'Pas de réponse du modèle IA' }, { status: 502 });
    }

    console.log('[parse-poi-query] Réponse brute:', content);

    // Parse JSON (strip markdown if present despite response_format)
    const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    let parsed: { categories?: unknown; filters?: Record<string, string | string[]>; explanation?: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('[parse-poi-query] JSON invalide:', cleaned);
      return NextResponse.json(
        { error: 'Réponse IA invalide — reformulez votre recherche', raw: cleaned },
        { status: 500 }
      );
    }

    // Sanitize
    const categories = Array.isArray(parsed.categories)
      ? (parsed.categories as string[]).filter(Boolean)
      : [];
    const rawFilters =
      parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {};

    // Resolve filters against actual DB values
    const resolvedFilters =
      Object.keys(rawFilters).length > 0
        ? resolveFilters(rawFilters, availableFilterValues)
        : {};

    console.log('[parse-poi-query] Résultat final:', { categories, filters: resolvedFilters });

    return NextResponse.json({
      success: true,
      categories,
      filters: resolvedFilters,
      explanation: parsed.explanation || `${categories.join(', ') || 'Tous les POI'}${Object.keys(resolvedFilters).length > 0 ? ' avec filtres' : ''}`,
    });
  } catch (err) {
    console.error('[parse-poi-query] Erreur interne:', err);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }
}
