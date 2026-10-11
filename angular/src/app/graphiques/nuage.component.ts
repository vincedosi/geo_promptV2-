import {
  ChangeDetectionStrategy, Component, DestroyRef, type ElementRef, afterNextRender, computed, effect, inject, input, signal, viewChild,
} from '@angular/core';
import { CouleursService } from '../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from './fabrique-graphique';
import { type PointNuage, optionNuage } from './option-nuage';

/**
 * Un nuage de points (le `ScatterChart` de Recharts, lot 4 T18 — corrélation impressions × indicateur). Même cycle de
 * vie que `mg-courbe` : le graphique naît APRÈS le premier rendu (`afterNextRender`), suit la taille de son conteneur
 * (`ResizeObserver`) et meurt avec le composant. Les couleurs sont des jetons lus par `CouleursService` : un changement
 * de thème recalcule l'option, et le nuage se repeint sans recharger.
 */
@Component({
  selector: 'mg-nuage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #conteneur role="img" [attr.aria-label]="libelle()" class="w-full" [style.height.px]="hauteur()"></div>`,
})
export class NuageComponent {
  readonly points = input.required<readonly PointNuage[]>();
  readonly libelle = input.required<string>();
  readonly libelleX = input.required<string>();
  readonly formaterX = input<(v: number) => string>((v) => String(v));
  readonly infobulle = input.required<(p: PointNuage) => readonly string[]>();
  readonly hauteur = input(220);

  private readonly conteneur = viewChild.required<ElementRef<HTMLDivElement>>('conteneur');
  private readonly fabrique = inject(FABRIQUE_GRAPHIQUE);
  private readonly destruction = inject(DestroyRef);
  private readonly graphique = signal<GraphiqueMinimal | null>(null);
  private readonly couleurs = inject(CouleursService).palette({
    point: 'brand-teal', texte: 'text-tertiary', axe: 'border-subtle', fondInfobulle: 'surface',
    textePrincipal: 'text-primary', texteSecondaire: 'text-secondary',
  });

  private readonly option = computed(() => optionNuage({
    points: this.points(), libelleX: this.libelleX(), formaterX: this.formaterX(), infobulle: this.infobulle(), couleurs: this.couleurs(),
  }));

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
