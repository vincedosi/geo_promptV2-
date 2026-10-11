import { DestroyRef, type ElementRef, type Signal, afterNextRender, effect, inject, signal } from '@angular/core';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from './fabrique-graphique';

/**
 * Le cycle de vie d'un graphique ECharts, UNE fois pour tous les composants qui en montent un (`mg-courbe`, `mg-nuage`,
 * `mg-graphique`) — revue 1 de T19 : le même bloc était recopié dans les trois.
 *
 * - le graphique naît APRÈS le premier rendu (`afterNextRender`) : son conteneur doit exister et avoir une taille ;
 * - il suit la taille de son conteneur (`ResizeObserver`) et meurt avec le composant (`dispose`) ;
 * - chaque nouvelle option est posée en `notMerge` : une série retirée disparaît vraiment.
 *
 * À appeler dans un contexte d'injection (constructeur ou initialiseur de champ d'un composant). Rend le graphique
 * monté, `null` avant le premier rendu — pour les composants qui en ont besoin.
 */
export function monterGraphique(conteneur: Signal<ElementRef<HTMLElement>>, option: Signal<unknown>): Signal<GraphiqueMinimal | null> {
  const fabrique = inject(FABRIQUE_GRAPHIQUE);
  const destruction = inject(DestroyRef);
  const graphique = signal<GraphiqueMinimal | null>(null);

  afterNextRender(() => {
    const element = conteneur().nativeElement;
    const g = fabrique(element);
    graphique.set(g);
    const observateur = new ResizeObserver(() => g.resize());
    observateur.observe(element);
    destruction.onDestroy(() => {
      observateur.disconnect();
      g.dispose();
    });
  });
  effect(() => {
    const g = graphique();
    if (g) g.setOption(option(), { notMerge: true });
  });
  return graphique.asReadonly();
}
