/**
 * Pattern 1 — Construction de system prompts dynamiques.
 *
 * Extrait du `buildSystemPrompt(ctx, campaignName)` de BiddingCopilot.
 * Généralisé : on découple la structure (sections nommées) des données
 * (variables interpolées). Les helpers d'agrégation (top N, fmt) sont
 * exposés pour réutilisation.
 *
 * Usage typique :
 *
 *   const prompt = buildSystemPrompt({
 *     role: "Tu es l'assistant bidding de MAGELIAN...",
 *     sections: [
 *       { title: 'Contexte campagne', body: `Nom: ${name}\n...` },
 *       { title: 'Top sur-servis', body: formatList(topRows, fmtRow) },
 *     ],
 *     instructions: ["...", "..."],
 *     output_schema: jsonExample,
 *   });
 */
import type { PromptVariables } from './types';

export interface SystemPromptSection {
  /** Heading (rendu en `## Title` markdown). */
  title: string;
  /** Corps libre (peut contenir markdown). */
  body: string;
}

export interface SystemPromptSpec {
  /** Phrase d'identité (rendue en haut, sans heading). */
  role: string;
  /** Sections principales du prompt (## Title). */
  sections?: SystemPromptSection[];
  /** Liste d'instructions/règles (rendue en bullet list). */
  instructions?: string[];
  /** Exemple de schéma de sortie attendu (string libre — ex. JSON entre triples backticks). */
  output_schema?: string;
}

/**
 * Construit un system prompt structuré à partir d'une spec déclarative.
 * Le résultat suit toujours la même structure :
 *   <role>
 *
 *   ## <section.title>
 *   <section.body>
 *   ...
 *
 *   ## Instructions
 *   - <instruction 1>
 *   - <instruction 2>
 *
 *   ## Format de sortie
 *   <output_schema>
 */
export function buildSystemPrompt(spec: SystemPromptSpec): string {
  const parts: string[] = [spec.role.trim()];

  if (spec.sections?.length) {
    for (const s of spec.sections) {
      parts.push(`## ${s.title}\n${s.body.trim()}`);
    }
  }

  if (spec.instructions?.length) {
    const list = spec.instructions.map(i => `- ${i.trim()}`).join('\n');
    parts.push(`## Instructions\n${list}`);
  }

  if (spec.output_schema) {
    parts.push(`## Format de sortie\n${spec.output_schema.trim()}`);
  }

  return parts.join('\n\n');
}

/**
 * Interpolation simple {{var}} → value. Erreur explicite si une var référencée
 * mais non fournie.
 */
export function interpolate(template: string, vars: PromptVariables): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const value = key.split('.').reduce<unknown>((acc, k) => {
      if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[k];
      }
      return undefined;
    }, vars);
    if (value === undefined) {
      throw new Error(`interpolate: variable {{${key}}} non fournie`);
    }
    if (value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

/**
 * Formate une liste en bullets indentés. Retourne `(none)` si la liste est vide.
 */
export function formatList<T>(items: T[], fmt: (item: T) => string, emptyText = '(aucun)'): string {
  if (!items.length) return `  ${emptyText}`;
  return items.map(it => `  - ${fmt(it)}`).join('\n');
}
