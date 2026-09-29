import { InjectionToken } from '@angular/core';

/** Un nombre borné de places ; les demandeurs en trop attendent leur tour. */
export interface Semaphore {
  acquerir(): Promise<() => void>;
  enVol(): number;
  enAttente(): number;
}

export function creerSemaphore(max: number): Semaphore {
  let actifs = 0;
  const attente: (() => void)[] = [];

  function jeton(): () => void {
    let libere = false;
    return function liberer(): void {
      if (libere) return;
      libere = true;
      actifs--;
      const suivant = attente.shift();
      if (suivant) {
        actifs++;
        suivant();
      }
    };
  }

  function acquerir(): Promise<() => void> {
    return new Promise((resolve) => {
      if (actifs < max) {
        actifs++;
        resolve(jeton());
      } else {
        attente.push(() => resolve(jeton()));
      }
    });
  }

  return { acquerir, enVol: () => actifs, enAttente: () => attente.length };
}

/**
 * Règle d'I/O de CLAUDE.md : « Promise.all() > 3 appels Supabase simultanés »
 * est INTERDIT. Côté React elle était tenue écran par écran ; ici un seul
 * sémaphore la tient pour TOUTE l'application.
 */
export const MAX_APPELS_SIMULTANES = 3;

export const SEMAPHORE_API = new InjectionToken<Semaphore>('SEMAPHORE_API', {
  providedIn: 'root',
  factory: () => creerSemaphore(MAX_APPELS_SIMULTANES),
});
