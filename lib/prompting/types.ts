/**
 * Types partagés du système de prompting GEOMATIK.
 * Extraits du chantier A4.5 (BiddingCopilot → lib/prompting/).
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Variables interpolables dans un system prompt template. */
export type PromptVariables = Record<string, string | number | boolean | null | undefined | object>;

/** Erreurs typées d'extraction JSON. */
export class JsonExtractionError extends Error {
  constructor(message: string, public readonly raw: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'JsonExtractionError';
  }
}
