import { Injectable, type Signal, computed, signal } from '@angular/core';
import type { RouteSourceCapture } from '../data/zones-custom.api';
import type { GeometrieContribuee } from '../logique/zones/capture';

/**
 * Comment une couche fournit sa géométrie au moment de la capture : par une route `/api/custom-geo/source/<route>`
 * (la donnée vit en base) dont le corps est composé À L'INSTANT de la capture — l'emprise visible, notamment —, ou
 * directement (une donnée déjà chargée côté client, comme les grappes de POI : la renvoyer au serveur serait un
 * aller-retour pour rien). `corps` rend `null` quand il manque de quoi demander (pas de carte) : la couche est alors
 * dite « sans géométrie ».
 */
export type ObtentionGeometrie =
  | { route: RouteSourceCapture; corps: () => Record<string, unknown> | null }
  | { locale: () => GeometrieContribuee };

/** Une couche contributive allumée (`ContributedLayer` de `types/custom-geo.ts`, sans `enabled` : allumée = déclarée non nulle). */
export interface SourceCapture {
  /** Identifiant stable (`map-carreaux-filosofi`…), ceux de `CaptureLayers.tsx`. */
  id: string;
  sourceType: string;
  label: string;
  metadata: Record<string, unknown>;
  obtenir: ObtentionGeometrie;
}

/**
 * Le registre des couches contributives de la capture — `CustomGeoCaptureContext` + le pont `CaptureLayers.tsx`
 * (lot 4, T16).
 *
 * React tenait UNE liste de sept couches dans `CaptureLayers.tsx`, alimentée par les états de `page.tsx`. Ici chaque
 * service de couche DÉCLARE sa source, une fois, à sa construction : un signal qui vaut la source quand la couche est
 * allumée et `null` sinon. Aucune liste en dur, aucun `register`/`unregister` à tenir à jour : la liste suit l'état
 * des couches par construction, et une couche portée plus tard (grappes de POI, T19-T20) n'a qu'à se déclarer.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class CaptureService {
  private readonly declarees = signal<readonly Signal<SourceCapture | null>[]>([]);

  /** Les couches contributives ALLUMÉES, dans l'ordre de déclaration. */
  readonly sources = computed(() => this.declarees().flatMap((s) => {
    const source = s();
    return source ? [source] : [];
  }));
  /** Le badge du bouton « Capturer zone custom » (`layerCount`). */
  readonly compte = computed(() => this.sources().length);

  declarer(source: Signal<SourceCapture | null>): void {
    this.declarees.update((l) => [...l, source]);
  }
}

