import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import type { HealthResponse } from '../../logique/types/admin';
import { HealthApi } from '../data/health.api';

/**
 * État de l'onglet « Santé » de la page Système : le dernier diagnostic (`GET /api/admin/health`).
 *
 * Fourni par `SystemePage` et détruit avec elle (`@Injectable()` sans `providedIn`). Depuis que les
 * deux onglets du Health check sont des sous-routes (lot 6, T6), l'écran « Santé » est DÉTRUIT quand
 * on passe à « Fraîcheur » : porter le diagnostic ici garde la règle de React (`page.tsx:141-155`,
 * UNE lecture au montage de la page, aucune en changeant d'onglet).
 *
 * - `assurer()` : lit si rien n'a encore été lu (première ouverture de l'onglet), sinon rien.
 *   Un chargement direct sur `systeme/fraicheur` ne lit donc pas le diagnostic — React le lisait.
 * - `relire()` : « Re-tester », UNE lecture à la fois (le bouton est désactivé, la méthode le
 *   vérifie aussi). La lecture survit à un changement d'onglet ; elle est annulée avec la page.
 * - Toute réponse non 2xx est une lecture en ÉCHEC (`health` à `null`) — écart à React voulu, T3.
 */
@Injectable()
export class SanteService {
  private readonly api = inject(HealthApi);
  private lecture: Subscription | null = null;

  readonly health = signal<HealthResponse | null>(null);
  readonly enLecture = signal(true);
  readonly derniereLecture = signal<Date | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
  }

  /** Première lecture, une seule fois pour la vie de la page. */
  assurer(): void {
    if (this.lecture) return;
    this.relire();
  }

  /** « Re-tester » (`fetchHealth`, `page.tsx:141-152`) : UNE lecture à la fois. */
  relire(): void {
    if (this.lecture && !this.lecture.closed) return;
    this.enLecture.set(true);
    this.lecture = this.api.lire().subscribe({
      next: (r) => {
        this.health.set(r);
        this.derniereLecture.set(new Date());
        this.enLecture.set(false);
      },
      error: () => {
        this.health.set(null);
        this.enLecture.set(false);
      },
    });
  }
}
