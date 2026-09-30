import { inject } from '@angular/core';
import type { HttpEvent, HttpInterceptorFn } from '@angular/common/http';
import { Observable, type Subscription } from 'rxjs';
import { HttpBaseService } from './http-base.service';
import { SEMAPHORE_API } from './semaphore';

/**
 * Au plus MAX_APPELS_SIMULTANES appels à l'API en vol, pour toute
 * l'application. Enregistré EN PREMIER : la place est prise avant que le
 * jeton soit lu, et rendue quand la réponse est complète, en erreur, ou
 * abandonnée.
 *
 * ⚠ Un Observable écrit à la main plutôt que `from(acquerir()).pipe(...)` :
 * un appel abandonné PENDANT son attente recevrait sa place plus tard sans
 * personne pour la rendre, et au bout de trois abandons l'application ne
 * ferait plus aucun appel.
 */
export const limiteurInterceptor: HttpInterceptorFn = (req, next) => {
  const apiUrl = inject(HttpBaseService).baseUrl;
  if (!req.url.startsWith(`${apiUrl}/`)) return next(req);
  const semaphore = inject(SEMAPHORE_API);

  return new Observable<HttpEvent<unknown>>((abonne) => {
    let liberer: (() => void) | null = null;
    let abandonne = false;
    let interne: Subscription | null = null;
    const rendre = () => {
      liberer?.();
      liberer = null;
    };

    void semaphore.acquerir().then((l) => {
      if (abandonne) {
        l();
        return;
      }
      liberer = l;
      interne = next(req).subscribe({
        next: (v) => abonne.next(v),
        error: (e) => {
          rendre();
          abonne.error(e);
        },
        complete: () => {
          rendre();
          abonne.complete();
        },
      });
      // Une émission (et un abandon déclenché par elle) peut survenir de façon
      // SYNCHRONE pendant ce subscribe() : la fonction de teardown ci-dessous
      // tournait alors sur `interne` encore null et ne pouvait rien désabonner.
      if (abandonne) interne.unsubscribe();
    });

    return () => {
      abandonne = true;
      interne?.unsubscribe();
      rendre();
    };
  });
};
