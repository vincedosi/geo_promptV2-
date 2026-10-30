import { DestroyRef, Injectable, type Signal, computed, inject, signal } from '@angular/core';

/**
 * ④ Analyse — le registre des analyses PEINTES par un service du panneau (④ finitions, T5, A-8). La pastille
 * « renseignée » de ④ (`suivreAnalyseAffichee`) lit les couches de la PAGE (score, zones à risque, couverture, bataille) ;
 * la couverture par rayon et les typologies sont fournies par le PANNEAU (P-e) : la page ne les voit pas. Elles publient
 * ici un signal `peinte`, retiré à la destruction de leur service.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page (`FOURNISSEURS_ANALYSE`).
 */
@Injectable()
export class AnalysesPeintesService {
  private readonly sources = signal<readonly Signal<boolean>[]>([]);
  /** Vrai si au moins une analyse inscrite est peinte. */
  readonly une = computed(() => this.sources().some((s) => s()));

  /** Inscrit un signal ; rend la fonction qui le retire. */
  inscrire(peinte: Signal<boolean>): () => void {
    this.sources.update((l) => [...l, peinte]);
    return () => this.sources.update((l) => l.filter((s) => s !== peinte));
  }
}

/**
 * Publie `peinte` au registre de la page, retiré au `DestroyRef` de l'appelant. Sans registre (service monté seul, en
 * spec), ne fait rien. À appeler dans un contexte d'injection.
 */
export function publierAnalysePeinte(peinte: Signal<boolean>): void {
  const registre = inject(AnalysesPeintesService, { optional: true });
  if (registre) inject(DestroyRef).onDestroy(registre.inscrire(peinte));
}
