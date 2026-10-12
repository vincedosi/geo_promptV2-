import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { bboxDeCarte } from '../../../carte/bbox';
import { formaterNombre } from '../../../core/format/nombre';
import { CarteApi, type ZoneData } from '../data/carte.api';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { messagePoints, PoisService } from './pois.service';

/**
 * La mention d'une liste d'arrêts COUPÉE par la route (`tronque`, `/api/map/transport` : 5 000 arrêts au plus), affichée
 * par la légende sous le compte d'arrêts ; `null` si la liste est complète ou si la zone n'est pas une zone d'arrêts.
 *
 * DÉFAUT REACT CORRIGÉ (revue finale du lot 4, I-2b) : React ne lisait pas `tronque` — la légende affichait
 * « arret_transport (5000) » sans dire qu'il en manquait. Contraire au principe « échouer en le disant » (CLAUDE.md,
 * § Troncature) : ce n'est pas une parité réussie, c'est un manque dit.
 */
export function mentionArretsTronques(zone: ZoneData | null): string | null {
  if (!zone?.tronque || zone.categorie_poi !== 'arret_transport') return null;
  return `${formaterNombre(zone.nb_pois)} arrêts affichés, liste tronquée — zoomez pour tout voir`;
}

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
