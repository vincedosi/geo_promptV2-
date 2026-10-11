import {
  ChangeDetectionStrategy, Component, type ElementRef, computed, inject, input, viewChild,
} from '@angular/core';
import { CouleursService } from '../core/theme/couleurs.service';
import { monterGraphique } from './monter-graphique';
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
  private readonly couleurs = inject(CouleursService).palette({
    point: 'brand-teal', texte: 'text-tertiary', axe: 'border-subtle', fondInfobulle: 'surface',
    textePrincipal: 'text-primary', texteSecondaire: 'text-secondary',
  });

  private readonly option = computed(() => optionNuage({
    points: this.points(), libelleX: this.libelleX(), formaterX: this.formaterX(), infobulle: this.infobulle(), couleurs: this.couleurs(),
  }));

  constructor() {
    // Création après rendu, suivi de taille, libération, options posées en `notMerge` : `monterGraphique`.
    monterGraphique(this.conteneur, this.option);
  }
}
