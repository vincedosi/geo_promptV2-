import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Maille, PlateformeGeo } from '../../logique/jeu/plateformes';
import { PASTILLE, PASTILLE_INACTIVE, PASTILLE_PRIMAIRE_ACTIVE } from '../analyse/styles-analyse';

/**
 * ⑤ Jeu de zones — le choix de la maille d'UNE plateforme (lot 5, T10) : des boutons segmentés, un par ligne de
 * `plateformes_geo` pour cette plateforme, les mailles natives d'abord puis l'ordre du registre. Une maille que la
 * plateforme n'achète pas (`disponible = false`, ex. TikTok en cercle) s'AFFICHE grisée, non cliquable, avec sa raison
 * (`note`) en infobulle ET en texte sous le bouton : savoir pourquoi une maille manque fait partie du choix (A-7).
 */
@Component({
  selector: 'mg-choix-maille',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex flex-wrap gap-[5px]" role="group" aria-label="Maille d’achat">
      @for (l of ordonnees(); track l.maille) {
        <div class="flex min-w-0 flex-[1_1_96px] flex-col gap-1">
          <button type="button" [attr.data-maille]="l.maille" [attr.aria-pressed]="l.maille === maille()"
            [disabled]="!l.disponible" [attr.title]="l.disponible ? null : l.note" (click)="choisir(l)"
            [class]="pastille + ' text-center disabled:cursor-not-allowed disabled:opacity-40 ' + (l.maille === maille() ? actif : inactif)">{{ l.libelle }}</button>
          @if (!l.disponible && l.note) {
            <span data-raison class="text-[10px] leading-[1.4] text-tertiary">{{ l.note }}</span>
          }
        </div>
      }
    </div>
  `,
})
export class ChoixMailleComponent {
  /** Les lignes du registre pour UNE plateforme. */
  readonly lignes = input.required<readonly PlateformeGeo[]>();
  /** La maille choisie, `null` sans choix (registre en lecture). */
  readonly maille = input<Maille | null>(null);
  readonly choisie = output<Maille>();

  protected readonly pastille = PASTILLE;
  protected readonly actif = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly inactif = PASTILLE_INACTIVE;

  /** Natives d'abord, puis l'ordre du registre (`ordre`) : la maille que la plateforme achète en propre se lit en premier. */
  protected readonly ordonnees = computed(() =>
    [...this.lignes()].sort((a, b) => Number(b.natif) - Number(a.natif) || a.ordre - b.ordre));

  protected choisir(l: PlateformeGeo): void {
    if (l.disponible && l.maille !== this.maille()) this.choisie.emit(l.maille);
  }
}
