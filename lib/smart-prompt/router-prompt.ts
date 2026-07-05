/**
 * lib/smart-prompt/router-prompt.ts
 * Construit le prompt Mistral et exécute le routage via generateObject.
 * Le prompt système est dynamique : il intègre le contenu de data_registry.
 */

import { createMistral }  from '@ai-sdk/mistral';
import { generateObject }  from 'ai';
import { z }               from 'zod';
import type { RegistryEntry, RouterDecision, AgentName } from './types';

const RouterSchema = z.object({
  agent: z.enum([
    'demographie',
    'panneaux',
    'isochrone_battle',
    'benchmark',
    'unknown',
  ]),
  params: z.object({
    ville:          z.string().optional(),
    region:         z.string().optional(),
    departement:    z.string().optional(),
    categorie_poi:  z.string().optional(),
    indicateur:     z.string().optional(),
    rayon_km:       z.number().optional(),
    mode:           z.enum(['drive', 'walk', 'bike', 'stats', 'ranking']).optional(),
    paliers:        z.array(z.number()).optional(),
    limit:          z.number().optional(),
  }),
  explication: z.string(),
  confidence:  z.number().min(0).max(1),
});

function buildSystemPrompt(registry: RegistryEntry[]): string {
  const byCategory: Record<string, RegistryEntry[]> = {};
  for (const entry of registry) {
    (byCategory[entry.category] ??= []).push(entry);
  }

  const sections = Object.entries(byCategory).map(([cat, entries]) => {
    const lines = entries.map(e =>
      `  • [${e.slug}] ${e.label}${e.description ? ' — ' + e.description : ''}`
    ).join('\n');
    return `${cat.toUpperCase()}:\n${lines}`;
  }).join('\n\n');

  return `Tu es le routeur IA de GEO.Prompt, plateforme géomarketing française.

DONNÉES DISPONIBLES DANS LE SYSTÈME :
${sections}

AGENTS DISPONIBLES :
• demographie     → stats INSEE Filosofi (revenus, population, âge, logements, pauvreté)
                    2 modes : stats (pour une ville) ou ranking (classement national des villes)
• panneaux        → panneaux d'affichage OOH/DOOH (JCDecaux, Clear Channel, etc.)
• isochrone_battle → sectorisation géographique par temps de trajet (drive/walk/bike)
• benchmark       → comparaison multi-villes, classements nationaux
• unknown         → si aucun agent ne correspond ou si la requête est hors périmètre

RÈGLES D'EXTRACTION DES PARAMÈTRES :
- ville/région/département : extraire le nom exact mentionné par l'utilisateur
- indicateur Filosofi : mappe les termes naturels vers les colonnes :
    revenu/salaire/csp → ind_snv | population → ind | jeunes/18-24 ans → ind_18_24
    seniors/65+ ans → ind_65_79 | actifs/25-54 ans → ind_25_39 | pauvreté → men_pauv
    familles mono → men_fmp | propriétaires → men_prop | HLM/social → log_soc
    0-3 ans → ind_0_3 | 4-5 ans → ind_4_5 | 6-10 ans → ind_6_10 | 11-17 ans → ind_11_17
    25-39 ans → ind_25_39 | 40-54 ans → ind_40_54 | 55-64 ans → ind_55_64 | 80+ ans → ind_80p
- rayon_km : extraire le rayon en km si mentionné (défaut : 5)
- limit : nombre de résultats pour le mode ranking (défaut : 10)
- mode=ranking : utiliser quand la question demande un classement, top N, liste des villes,
    les villes où X est le plus élevé/nombreux — PAS de "ville" précise dans ce cas
- mode=stats : utiliser quand une ville précise est mentionnée (défaut)
- Si plusieurs agents sont possibles, choisir le plus précis (confidence > 0.7)

Réponds UNIQUEMENT en JSON valide. Ne fournis aucun texte hors du JSON.`;
}

export async function routePrompt(
  userMessage: string,
  registry:    RegistryEntry[],
): Promise<RouterDecision> {
  const mistral = createMistral({ apiKey: process.env.MISTRAL_API_KEY });
  const model   = mistral('mistral-small-latest');

  const { object } = await generateObject({
    model,
    schema:      RouterSchema,
    system:      buildSystemPrompt(registry),
    prompt:      userMessage,
    temperature: 0.1,
  });

  return {
    agent:       object.agent as AgentName,
    params:      object.params as Record<string, unknown>,
    explication: object.explication,
    confidence:  object.confidence,
  };
}
