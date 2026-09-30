import { InjectionToken } from '@angular/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

/**
 * Import MODULAIRE : seuls la courbe, la grille, l'infobulle, le repère et le
 * rendu SVG entrent dans le paquet. `import * from 'echarts'` en tirerait tout.
 */
echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, SVGRenderer]);

export interface GraphiqueMinimal {
  setOption(option: unknown, options?: unknown): void;
  resize(): void;
  dispose(): void;
}

export type FabriqueGraphique = (el: HTMLElement) => GraphiqueMinimal;

/** Un jeton pour que les tests fournissent un graphique factice (pas de rendu réel en test). */
export const FABRIQUE_GRAPHIQUE = new InjectionToken<FabriqueGraphique>('FABRIQUE_GRAPHIQUE', {
  providedIn: 'root',
  factory: () => (el) => echarts.init(el, undefined, { renderer: 'svg' }),
});
