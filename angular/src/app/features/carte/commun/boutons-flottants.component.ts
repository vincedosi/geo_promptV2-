import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';

/** Classes communes aux boutons flottants de droite (`page.tsx:1334-1376`), survol compris. */
const BOUTON =
  'absolute right-[10px] z-50 flex cursor-pointer items-center justify-center rounded-[6px] border-fin border-default bg-surface p-2 text-secondary transition-[top,background-color,border-color,color] duration-200 ease-[var(--ease-out)] hover:border-hover hover:bg-elevated hover:text-primary';

/**
 * Les boutons flottants de droite de la carte — `app/map/page.tsx:1334-1376` : le mode immersif, puis
 * « Tout effacer » 42 px plus bas. `absolute` dans l'hôte de la page (B1), jamais `fixed` ; l'hôte de ce
 * composant est `display: contents`, donc les boutons se positionnent contre l'hôte `relative` de la page.
 *
 * Le décalage à droite de React (`railBoutonsRight`) ne dépend que du plan média et du tiroir de
 * l'Assistant : aucun des deux n'existe encore côté Angular (Assistant jamais porté), il vaut donc 10 px.
 */
@Component({
  selector: 'mg-boutons-flottants',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <button
      type="button"
      data-immersif
      (click)="basculerImmersif.emit()"
      [attr.title]="railMasque() ? 'Afficher la barre (Escape)' : 'Masquer la barre (mode immersif)'"
      [attr.aria-pressed]="railMasque()"
      [class]="bouton"
      [style.top.px]="haut()"
    >
      <mg-icone [nom]="railMasque() ? 'agrandir' : 'reduire'" [taille]="16" [trait]="1.5" />
    </button>
    <button
      type="button"
      data-tout-effacer
      (click)="toutEffacer.emit()"
      title="Tout effacer (couches et zones affichées)"
      [class]="bouton"
      [style.top.px]="haut() + 42"
    >
      <mg-icone nom="gomme" [taille]="16" [trait]="1.5" />
    </button>
  `,
})
export class BoutonsFlottantsComponent {
  readonly railMasque = input.required<boolean>();
  /** Haut du premier bouton : 10 px en immersif, sous la barre du haut sinon (`MAP_TOPBAR_HEIGHT + 8`). */
  readonly haut = input.required<number>();
  readonly basculerImmersif = output<void>();
  readonly toutEffacer = output<void>();

  protected readonly bouton = BOUTON;
}
