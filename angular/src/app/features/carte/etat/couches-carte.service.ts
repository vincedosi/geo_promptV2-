import { Injectable, signal } from '@angular/core';
import type maplibregl from 'maplibre-gl';

/**
 * Le registre des couches de la carte principale (lot 4).
 *
 * - `carteCourante` : l'instance MapLibre en service, publiée par `(prete)` de `mg-carte` et remise à
 *   `null` quand elle est détruite. Changer de fond RECRÉE la carte, comme React (arbitrage B11, T4) :
 *   chaque service de couche re-pose ses sources par un `effect` sur ce signal — jamais par un drapeau
 *   « déjà posé » gardé dans le service, qui survivrait à l'instance.
 * - `inscrireEffacement` / `toutEffacer` : « Tout effacer » (`page.tsx:681-765`) appelle la fonction
 *   de CHAQUE couche inscrite, sans connaître aucune d'elles.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class CouchesCarteService {
  private readonly carte = signal<maplibregl.Map | null>(null);
  readonly carteCourante = this.carte.asReadonly();
  private readonly effacements = new Map<string, () => void>();

  publier(carte: maplibregl.Map | null): void {
    this.carte.set(carte);
  }

  /** Ré-inscrire un id REMPLACE sa fonction : un service recréé n'est pas appelé deux fois. */
  inscrireEffacement(id: string, effacer: () => void): void {
    this.effacements.set(id, effacer);
  }

  toutEffacer(): void {
    for (const effacer of [...this.effacements.values()]) effacer();
  }
}
