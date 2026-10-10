import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';

/** Classes communes aux boutons flottants de droite (`page.tsx:1334-1376`), survol compris. */
const BOUTON =
  'absolute right-[10px] z-50 flex cursor-pointer items-center justify-center rounded-[6px] border-fin border-default bg-surface p-2 text-secondary transition-[top,background-color,border-color,color] duration-200 ease-[var(--ease-out)] hover:border-hover hover:bg-elevated hover:text-primary';

/**
 * Les boutons flottants de droite de la carte — `app/map/page.tsx:1334-1400` : le mode immersif, puis
 * « Tout effacer » 42 px plus bas, puis « Script bidding DV360 » 84 px plus bas tant qu'une zone ouverte par le lien
 * `?customZone=` occupe le créneau de bataille (T14 : `zoneScript` porte son nom). `absolute` dans l'hôte de la page (B1), jamais `fixed` ; l'hôte de ce
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
    @if (zoneScript(); as nom) {
      <button
        type="button"
        data-script-dv360
        (click)="genererScript.emit()"
        [attr.title]="'Générer le fichier custom bidding DV360 pour « ' + nom + ' »'"
        class="absolute right-[10px] z-50 flex cursor-pointer items-center gap-1.5 rounded-[6px] border-fin border-teal bg-surface px-[10px] py-[7px] text-[11px] font-medium text-teal transition-[top,background-color] duration-200 ease-[var(--ease-out)] hover:bg-teal-10"
        [style.top.px]="haut() + 84"
      >
        <mg-icone nom="fichier-bas" [taille]="14" [trait]="1.5" />
        Script bidding DV360
      </button>
    }
  `,
})
export class BoutonsFlottantsComponent {
  readonly railMasque = input.required<boolean>();
  /** Haut du premier bouton : 10 px en immersif, sous la barre du haut sinon (`MAP_TOPBAR_HEIGHT + 8`). */
  readonly haut = input.required<number>();
  readonly basculerImmersif = output<void>();
  readonly toutEffacer = output<void>();
  /** Le nom de la zone du lien `?customZone=`, `null` sans elle : le bouton DV360 n'existe que pour elle. */
  readonly zoneScript = input<string | null>(null);
  readonly genererScript = output<void>();

  protected readonly bouton = BOUTON;
}
