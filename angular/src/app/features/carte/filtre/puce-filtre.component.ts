import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import type { FiltreActif } from '../logique/filtre';
import { ECART_RAIL_PANNEAU, LARGEUR_RAIL } from '../logique/navigation';
import { HAUTEUR_BARRE_HAUT } from '../rail/barre-haut.component';

/**
 * La puce du filtre actif — portage de `components/map/FiltreChip.tsx`. En haut à gauche de la carte, sous la
 * barre du haut, visible quel que soit le panneau ouvert : elle rappelle « où je regarde ». Le panneau du rail,
 * ouvert à la même place, la recouvre (`z-index` 35 < 40), comme React — il affiche déjà le filtre courant.
 *
 * `absolute` dans l'hôte de la page (arbitrage B1) ; position FIXE comme React (`MAP_TOPBAR_HEIGHT + 12`,
 * `LARGEUR_RAIL + ECART_RAIL_PANNEAU`), y compris en mode immersif. Le décalage sous la barre de contexte campagne
 * (`decalageHaut`) n'a pas d'objet tant que l'overlay Campagne n'est pas porté (lot 5).
 */
@Component({
  selector: 'mg-puce-filtre',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'absolute z-[35] flex items-center gap-1.5 rounded-[6px] border-fin border-default bg-elevated px-2 py-1.5',
    '[style.top.px]': 'haut',
    '[style.left.px]': 'gauche',
    'data-puce-filtre': '',
  },
  template: `
    <mg-icone nom="entonnoir" [taille]="12" [trait]="1.5" class="shrink-0 text-teal" />
    <span class="max-w-[220px] truncate text-[12px] text-primary">{{ filtre().label }}</span>
    <button
      type="button"
      aria-label="Retirer le filtre"
      title="Retirer le filtre"
      (click)="retirer.emit()"
      class="flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-tertiary"
    >
      <mg-icone nom="croix" [taille]="12" [trait]="1.5" />
    </button>
  `,
})
export class PuceFiltreComponent {
  readonly filtre = input.required<FiltreActif>();
  readonly retirer = output<void>();

  protected readonly haut = HAUTEUR_BARRE_HAUT + 12;
  protected readonly gauche = LARGEUR_RAIL + ECART_RAIL_PANNEAU;
}
