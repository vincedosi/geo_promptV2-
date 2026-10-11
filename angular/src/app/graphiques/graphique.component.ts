import {
  ChangeDetectionStrategy, Component, DestroyRef, type ElementRef, afterNextRender, effect, inject, input, signal, viewChild,
} from '@angular/core';
import { BarChart, PieChart, ScatterChart } from 'echarts/charts';
import { LegendComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from './fabrique-graphique';

/**
 * Barres, anneau et nuage de points : enregistrés ICI, pas dans `fabrique-graphique.ts` — seuls les écrans qui montent
 * `mg-graphique` (le rapport de clustering, T19) les chargent ; la courbe du module risque n'en paie pas le poids.
 */
echarts.use([BarChart, PieChart, ScatterChart, LegendComponent]);

/**
 * Un graphique ECharts quelconque, dont l'APPELANT compose les options (fonctions pures, couleurs déjà résolues par
 * `CouleursService` — ECharts ne lit pas `var()`). Pendant générique de `mg-courbe`, qui compose les siennes : même
 * cycle de vie (création après le premier rendu, `ResizeObserver`, libération à la destruction), et `notMerge` à
 * chaque nouvelle option, pour qu'une série retirée disparaisse vraiment.
 */
@Component({
  selector: 'mg-graphique',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="img" [attr.aria-label]="libelle()" class="w-full" [style.height.px]="hauteur()">
      <div #conteneur class="h-full"></div>
    </div>
  `,
})
export class GraphiqueComponent {
  /** Les options ECharts, couleurs comprises. */
  readonly option = input.required<Record<string, unknown>>();
  readonly libelle = input.required<string>();
  readonly hauteur = input(220);

  private readonly conteneur = viewChild.required<ElementRef<HTMLDivElement>>('conteneur');
  private readonly fabrique = inject(FABRIQUE_GRAPHIQUE);
  private readonly destruction = inject(DestroyRef);
  private readonly graphique = signal<GraphiqueMinimal | null>(null);

  constructor() {
    afterNextRender(() => {
      const element = this.conteneur().nativeElement;
      const g = this.fabrique(element);
      this.graphique.set(g);
      const observateur = new ResizeObserver(() => g.resize());
      observateur.observe(element);
      this.destruction.onDestroy(() => {
        observateur.disconnect();
        g.dispose();
      });
    });
    effect(() => {
      const g = this.graphique();
      if (g) g.setOption(this.option(), { notMerge: true });
    });
  }
}
