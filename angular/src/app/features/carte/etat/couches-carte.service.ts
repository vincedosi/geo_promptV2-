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
 * ── CONTRAT DE CHAQUE SERVICE DE COUCHE (T6+, arbitrage B11) ─────────────
 * Changer de fond détruit l'instance MapLibre et toutes ses sources. Une couche se re-pose donc d'elle-même :
 *
 * ```ts
 * constructor() {
 *   effect((onCleanup) => {
 *     const carte = this.couches.carteCourante();
 *     if (!carte || !this.actif()) return;
 *     onCleanup(quandStyleCharge(carte, () => this.poser(carte)));  // addSource/addLayer IDEMPOTENTS
 *   });
 *   this.couches.inscrireEffacement('<id>', () => this.effacer());
 * }
 * ```
 *
 * - `poser` teste `getSource`/`getLayer` SUR L'INSTANCE COURANTE avant d'ajouter — jamais un drapeau « déjà
 *   posé » gardé dans le service : il survivrait à l'instance détruite et la couche ne reviendrait pas.
 * - `carteCourante` passe par `null` dès le choix d'un autre fond (la page le publie avant de recréer) :
 *   aucun effet n'écrit dans une carte morte.
 * - `effacer` éteint la couche et vide ses données ; « Tout effacer » l'appelle sans rien annoncer
 *   (`page.tsx:740-743`).
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

/** La surface de carte que `quandStyleCharge` emploie. */
interface CarteChargement {
  /** `boolean | void` : la signature de MapLibre (`maplibregl.Map.isStyleLoaded`). */
  isStyleLoaded(): boolean | void;
  once(evt: 'load' | 'idle', rappel: () => void): unknown;
  off(evt: 'load' | 'idle', rappel: () => void): unknown;
}

/**
 * Appelle `poser` tout de suite si le style est chargé, sinon au premier `load` OU `idle` — et rend de quoi retirer
 * l'écoute (à passer à `onCleanup`), pour qu'un effet rejoué ou une carte remplacée ne pose pas deux fois.
 *
 * ⚠ `idle`, et pas seulement `load` (constaté au navigateur, T11) : `carteCourante` est publiée AU `load`, mais
 * `isStyleLoaded()` de MapLibre rend `false` tant qu'une SOURCE charge encore ses tuiles — ce qui est le cas juste
 * après la recréation de la carte par un changement de fond. Attendre `load`, déjà passé, laissait la couche
 * jamais re-posée ; `idle` vient toujours, une fois les tuiles reçues.
 */
export function quandStyleCharge(carte: CarteChargement, poser: () => void): () => void {
  if (carte.isStyleLoaded()) {
    poser();
    return () => undefined;
  }
  const retirer = () => {
    carte.off('load', une);
    carte.off('idle', une);
  };
  const une = () => {
    retirer();
    poser();
  };
  carte.once('load', une);
  carte.once('idle', une);
  return retirer;
}
