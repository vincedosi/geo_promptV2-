import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { LIBELLE_NATURE } from '../../logique/jeux-carte';
import type { JeuAffichable } from '../../logique/rangement-jeux';

/**
 * La ligne uniforme d'un jeu de ② (arbitrage A12) : nom, nature · maille, pastille « affiché », puis une CASE (type de
 * POI : le choisir) ou un CHEVRON qui déplie les réglages existants de sa section (projetée, rendue seulement dépliée).
 */
@Component({
  selector: 'mg-ligne-jeu',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block border-t-fin border-subtle', '[attr.data-jeu]': 'jeu().cle' },
  template: `
    <div class="flex items-center gap-2 px-[14px] py-2">
      @if (mode() === 'case') {
        <input type="checkbox" class="case shrink-0" [checked]="coche()" [attr.aria-label]="'Choisir ' + jeu().nom" (change)="cocher.emit()" />
      }
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12px] text-primary">{{ jeu().nom }}</div>
        <div class="text-[11px] text-tertiary">{{ meta() }}</div>
      </div>
      @if (affiche()) {
        <span data-affiche title="Affiché sur la carte" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
        <span class="sr-only">(affiché)</span>
      }
      @if (mode() === 'reglages') {
        <button type="button" [attr.aria-expanded]="deplie()" [attr.aria-label]="(deplie() ? 'Replier ' : 'Régler ') + jeu().nom"
                (click)="basculer.emit()" class="flex shrink-0 cursor-pointer border-0 bg-transparent p-1 text-tertiary hover:text-primary">
          <mg-icone [nom]="deplie() ? 'chevron-bas' : 'chevron-droite'" [taille]="14" [trait]="1.5" />
        </button>
      }
    </div>
    @if (mode() === 'reglages' && deplie()) {
      <div data-reglages class="px-[14px] pb-3"><ng-content /></div>
    }
  `,
  styles: `.case { accent-color: var(--brand-teal); cursor: pointer; } .case:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }`,
})
export class LigneJeuComponent {
  readonly jeu = input.required<JeuAffichable>();
  readonly affiche = input(false);
  readonly mode = input<'case' | 'reglages'>('reglages');
  readonly coche = input(false);
  readonly deplie = input(false);
  readonly cocher = output<void>();
  readonly basculer = output<void>();
  protected readonly meta = computed(() => `${LIBELLE_NATURE[this.jeu().nature]} · ${this.jeu().maille}`);
}
