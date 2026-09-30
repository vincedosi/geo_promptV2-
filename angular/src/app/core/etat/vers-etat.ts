import { DestroyRef, assertInInjectionContext, assertNotInReactiveContext, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { messageErreurApi } from '../http/erreurs';
import type { EtatChargement } from './etat-chargement';

/**
 * Convertit un flux HTTP en signal d'`EtatChargement`, prêt pour un
 * `@switch (etat().statut)` de template — chargement -> pret | echec, jamais
 * de donnée et d'erreur affichées en même temps ni de chargement sans fin.
 * Tout lot qui affiche une donnée chargée par HTTP le reprend plutôt que de
 * recopier cette logique.
 *
 * Doit être appelé dans un CONTEXTE D'INJECTION (constructeur, initialiseur
 * de champ de composant/service, ou `runInInjectionContext`) : il s'y
 * raccroche pour se désabonner à la destruction. Hors contexte, il lève
 * `NG0203` en nommant `versEtat` — le contrat de l'ancien `toSignal`. Et
 * JAMAIS dans un contexte réactif (`computed`, `effect`, gabarit) : il y lève
 * `NG0602`, comme `toSignal`.
 *
 * ⚠ **Pas de `toSignal`** (ni rien de `@angular/core/rxjs-interop`) : un hôte
 * AIDA par défaut ne partage pas cette entrée secondaire, et la copie du
 * remote importe les morceaux PRIVÉS de `@angular/core` par des chemins
 * relatifs — son `inject(DestroyRef)` lève alors `NG0203`, en production
 * aussi (épreuve du 2026-09-30). Verrouillé par
 * `tests/unit/angular/imports-partages.test.ts`.
 *
 * Même comportement que la version `toSignal(…, { requireSync: true })` :
 * `{ statut: 'chargement' }` est posé AVANT l'abonnement, donc lisible tout de
 * suite ; une source qui émet pendant l'abonnement donne `pret` sans attente.
 * Aucune dépendance à zone.js : le signal suffit à la détection de
 * changement zoneless.
 */
export function versEtat<T>(source$: Observable<T>): Signal<EtatChargement<T>> {
  // Jamais dans un `computed`, un `effect` ou un gabarit : chaque réévaluation
  // ouvrirait un nouvel abonnement HTTP. `NG0602` nomme `versEtat`, comme `toSignal`.
  assertNotInReactiveContext(versEtat);
  assertInInjectionContext(versEtat);
  // Pris AVANT l'abonnement : hors contexte, rien n'est abonné, rien ne fuit.
  const destruction = inject(DestroyRef);
  const etat = signal<EtatChargement<T>>({ statut: 'chargement' });
  const abonnement = source$.subscribe({
    next: (valeur) => etat.set({ statut: 'pret', valeur }),
    error: (e: unknown) => etat.set({ statut: 'echec', message: messageErreurApi(e) }),
  });
  destruction.onDestroy(() => abonnement.unsubscribe());
  return etat.asReadonly();
}
