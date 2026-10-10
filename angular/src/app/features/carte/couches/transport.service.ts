import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { bboxDeCarte } from '../../../carte/bbox';
import { CarteApi } from '../data/carte.api';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { messagePoints, PoisService } from './pois.service';

/**
 * Les arrêts de transport en commun (`handleLoadTransport`, `page.tsx:486-496`) : chargés pour la carte VISIBLE, bbox à
 * quatre décimales, et rendus dans la zone partagée de `PoisService`.
 *
 * Comme React, la zone précédente reste affichée pendant la requête (pas de `setZoneData(null)`). Écart, défaut corrigé :
 * React taisait un échec (`if (!res.ok) return`) — l'écran ne bougeait pas et ne disait rien ; il est dit ici.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class TransportService {
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(CarteApi);
  private readonly pois = inject(PoisService);
  private lecture: Subscription | null = null;

  /** Une requête en cours (bouton « Chargement... »). */
  readonly chargement = signal(false);
  readonly erreur = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
  }

  /** « Afficher arrêts » : la carte visible, les types choisis (aucun = tous). */
  charger(types: readonly string[]): void {
    const carte = this.couches.carteCourante();
    if (!carte) return;
    this.lecture?.unsubscribe();
    this.erreur.set(null);
    this.chargement.set(true);
    this.lecture = this.api.transport(bboxDeCarte(carte), types).subscribe({
      next: (data) => {
        this.chargement.set(false);
        if (data?.pois) this.pois.definirZone(data);
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.erreur.set(messagePoints(e, 'Délai dépassé — réessayez dans quelques instants'));
      },
    });
  }
}
