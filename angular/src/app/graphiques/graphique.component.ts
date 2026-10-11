import {
  ChangeDetectionStrategy, Component, type ElementRef, input, viewChild,
} from '@angular/core';
import { BarChart, PieChart } from 'echarts/charts';
import { LegendComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { monterGraphique } from './monter-graphique';

/**
 * Barres, anneau et légende : enregistrés ICI (le nuage de points l'est déjà par la fabrique, T18), pas dans `fabrique-graphique.ts` — seuls les écrans qui montent
 * `mg-graphique` (le rapport de clustering, T19) les chargent ; la courbe du module risque n'en paie pas le poids.
 */
echarts.use([BarChart, PieChart, LegendComponent]);

/**
 * Un graphique ECharts quelconque, dont l'APPELANT compose les options (fonctions pures, couleurs déjà résolues par
 * `CouleursService` — ECharts ne lit pas `var()`). Pendant générique de `mg-courbe` et `mg-nuage`, qui composent les
 * leurs ; les trois partagent le même cycle de vie, `monterGraphique`.
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

  constructor() {
    // Création après rendu, suivi de taille, libération, options posées en `notMerge` : `monterGraphique`.
    monterGraphique(this.conteneur, this.option);
  }
}
