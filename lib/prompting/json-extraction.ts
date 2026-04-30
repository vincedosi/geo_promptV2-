/**
 * Pattern 2 — Extraction JSON depuis une réponse LLM.
 *
 * Les LLMs renvoient souvent le JSON inclus dans un bloc markdown :
 *
 *   Ma réponse en français.
 *
 *   ```json
 *   { "field": "value" }
 *   ```
 *
 * Cette lib :
 *  - extrait robustement le bloc JSON (regex stricte sur ```json … ```)
 *  - tolère un fallback si le JSON est seul (sans fences)
 *  - fournit `stripJsonBlock` pour nettoyer le texte humain (utile pour l'UI chat)
 *  - lance `JsonExtractionError` typée en cas d'échec
 *
 * Extrait de `extractJsonPayload(text)` + `stripJsonBlock(text)` de BiddingCopilot.
 */
import { JsonExtractionError } from './types';

/**
 * Extrait le premier bloc ```json … ``` rencontré et le parse.
 * Retourne `null` si AUCUN bloc n'est présent (cas non-erreur du chat normal).
 * Lance `JsonExtractionError` si un bloc est présent mais invalide.
 */
export function extractJsonBlock<T = unknown>(text: string): T | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as T;
  } catch (cause) {
    throw new JsonExtractionError(
      `Bloc \`\`\`json présent mais JSON invalide`,
      match[1],
      cause,
    );
  }
}

/**
 * Comme `extractJsonBlock`, mais essaie aussi de parser le texte entier comme JSON
 * si aucun bloc fenced n'est présent (cas où le LLM a respecté le format strict).
 */
export function extractJSON<T = unknown>(text: string): T | null {
  const fenced = extractJsonBlock<T>(text);
  if (fenced !== null) return fenced;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

/**
 * Retourne le texte sans les blocs ```json … ```. Utilisé pour afficher la
 * réponse "humaine" dans l'UI sans le payload technique.
 */
export function stripJsonBlock(text: string): string {
  return text.replace(/```json[\s\S]*?```/g, '').trim();
}
