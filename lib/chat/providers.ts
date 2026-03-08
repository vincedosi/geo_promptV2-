import { createMistral } from '@ai-sdk/mistral';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export type Provider = 'mistral' | 'claude' | 'gemini';

export function createModel(provider: Provider) {
  if (provider === 'claude') {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropic('claude-haiku-4-5-20251001');
  }
  if (provider === 'gemini') {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
    return google('gemini-2.5-flash');
  }
  const mistral = createMistral({ apiKey: process.env.MISTRAL_API_KEY });
  return mistral('mistral-small-latest');
}

// Gemini a une fenêtre de quota/minute très stricte — pas de retry automatique
export function getMaxRetries(provider: Provider): number {
  return provider === 'gemini' ? 0 : 1;
}
