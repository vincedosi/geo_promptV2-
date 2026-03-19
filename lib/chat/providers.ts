import { createMistral } from '@ai-sdk/mistral';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export type Provider = 'mistral' | 'gemini';

export function createModel(provider: Provider) {
  if (provider === 'gemini') {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
    // gemini-2.5-flash avec thinking désactivé = coût minimal, modèle actif
    return google('gemini-2.5-flash');
  }
  const mistral = createMistral({ apiKey: process.env.MISTRAL_API_KEY });
  return mistral('mistral-small-latest');
}

// Gemini a une fenêtre de quota/minute très stricte — pas de retry automatique
export function getMaxRetries(provider: Provider): number {
  return provider === 'gemini' ? 0 : 1;
}
