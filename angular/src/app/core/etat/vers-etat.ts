import type { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import { catchError, map, of, startWith } from 'rxjs';
import { messageErreurApi } from '../http/erreurs';
import type { EtatChargement } from './etat-chargement';

/**
 * Convertit un flux HTTP en signal d'`EtatChargement`, prêt pour un
 * `@switch (etat().statut)` de template — chargement -> pret | echec, jamais
 * de donnée et d'erreur affichées en même temps ni de chargement sans fin.
 * Même convention que `accueil.page.ts` avant ce refactor ; tout lot suivant
 * qui affiche une donnée chargée par HTTP la reprend plutôt que de recopier
 * ce pipe.
 *
 * Doit être appelé dans un CONTEXTE D'INJECTION (constructeur, initialiseur
 * de champ de composant/service, ou `runInInjectionContext`) : `toSignal`
 * s'y raccroche pour se désabonner à la destruction.
 */
export function versEtat<T>(source$: Observable<T>): Signal<EtatChargement<T>> {
  return toSignal(
    source$.pipe(
      map((valeur): EtatChargement<T> => ({ statut: 'pret', valeur })),
      catchError((e) => of<EtatChargement<T>>({ statut: 'echec', message: messageErreurApi(e) })),
      startWith<EtatChargement<T>>({ statut: 'chargement' }),
    ),
    { requireSync: true },
  );
}
