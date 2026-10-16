import { DestroyRef, Injectable, type Signal, inject, signal } from '@angular/core';
import { CarteApi } from '../data/carte.api';

/**
 * La sélection recommandée de l'espace actif, lue UNE fois, à la première visite de ② (le panneau Données fournit ce
 * service et reste monté ensuite). Un échec vaut « pas de sélection » — tout déplié — et le dit (`indisponible`).
 * `@Injectable()` sans `providedIn` : dans une remote, un service racine recevrait le `HttpClient` du shell.
 */
@Injectable()
export class JeuxRecommandesService {
  private readonly _cles = signal<readonly string[] | null>(null);
  /** `null` = en lecture ; `[]` = pas de sélection (ou lecture en échec). */
  readonly cles: Signal<readonly string[] | null> = this._cles.asReadonly();
  private readonly _indisponible = signal(false);
  readonly indisponible: Signal<boolean> = this._indisponible.asReadonly();

  constructor() {
    const lecture = inject(CarteApi).jeuxRecommandes().subscribe({
      next: (r) => this._cles.set(Array.isArray(r?.cles) ? r.cles : []),
      error: () => {
        this._cles.set([]);
        this._indisponible.set(true);
      },
    });
    inject(DestroyRef).onDestroy(() => lecture.unsubscribe());
  }
}
