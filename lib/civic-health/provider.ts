/**
 * Factory provider Atmo. Choisit le backend selon ATMO_PROVIDER :
 *   - 'mock' (défaut) : MockProvider, données déterministes
 *   - 'atmofrance'    : AtmoFranceProvider, requiert ATMO_FRANCE_USERNAME/PASSWORD
 *
 * Singleton instancié à la première demande pour éviter de relire l'env à chaque appel.
 */
import type { HealthProvider } from './types';
import { MockProvider } from './mock-provider';
import { AtmoFranceProvider } from './atmofrance-client';

let cachedProvider: HealthProvider | null = null;

export function getProvider(): HealthProvider {
  if (cachedProvider) return cachedProvider;

  const kind = (process.env.ATMO_PROVIDER ?? 'mock').toLowerCase();

  if (kind === 'atmofrance') {
    const username = process.env.ATMO_FRANCE_USERNAME;
    const password = process.env.ATMO_FRANCE_PASSWORD;
    if (!username || !password) {
      console.warn(
        '[civic-health] ATMO_PROVIDER=atmofrance mais ATMO_FRANCE_USERNAME/PASSWORD manquant — fallback MockProvider.',
      );
      cachedProvider = new MockProvider();
      return cachedProvider;
    }
    cachedProvider = new AtmoFranceProvider(username, password);
    return cachedProvider;
  }

  cachedProvider = new MockProvider();
  return cachedProvider;
}

/** Réinitialise le provider (tests uniquement). */
export function _resetProvider(): void {
  cachedProvider = null;
}
