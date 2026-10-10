import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';

/** Classes communes aux boutons flottants de droite (`page.tsx:1334-1376`), survol compris. */
const BOUTON =
  'absolute z-50 flex cursor-pointer items-center justify-center rounded-[6px] border-fin border-default bg-surface p-2 text-secondary transition-[top,background-color,border-color,color] duration-200 ease-[var(--ease-out)] hover:border-hover hover:bg-elevated hover:text-primary';

/** Les boutons teal à libellé (« Script bidding DV360 », « Plan média (n) », `page.tsx:1377-1399, 1222-1243`). */
const BOUTON_TEAL =
  'absolute z-50 flex cursor-pointer items-center gap-1.5 rounded-[6px] border-fin border-teal bg-surface px-[10px] py-[7px] text-[11px] font-medium text-teal transition-[top,background-color] duration-200 ease-[var(--ease-out)] hover:bg-teal-10';

/**
 * La position à droite des boutons (`railBoutonsRight`, `page.tsx:1113-1126`) : l'écart, plafonné pour qu'un panneau
 * large sur un hôte étroit ne pousse jamais les boutons hors de la page. En `%` de l'HÔTE et non en `vw` comme React :
 * dans un shell, l'hôte n'est pas la fenêtre.
 */
export function droiteBoutons(decalage: number): string {
  return `min(${decalage}px, calc(100% - 60px))`;
}

/**
 * Les boutons flottants de droite de la carte — `app/map/page.tsx:1334-1400` : le mode immersif, puis
 * « Tout effacer » 42 px plus bas, puis « Script bidding DV360 » 84 px plus bas tant qu'une zone ouverte par le lien
 * `?customZone=` occupe le créneau de bataille (T14 : `zoneScript` porte son nom). `absolute` dans l'hôte de la page (B1), jamais `fixed` ; l'hôte de ce
 * composant est `display: contents`, donc les boutons se positionnent contre l'hôte `relative` de la page.
 *
 * Tous s'écartent du plan média ouvert (`decalage`, `railBoutonsRight` de React) ; panneau fermé, « Plan média (n) »
 * le rouvre, 126 px sous l'immersif (T15). Le tiroir de l'Assistant, l'autre terme de React, n'est jamais porté.
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
      [style.right]="droite()"
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
      [style.right]="droite()"
    >
      <mg-icone nom="gomme" [taille]="16" [trait]="1.5" />
    </button>
    @if (zoneScript(); as nom) {
      <button
        type="button"
        data-script-dv360
        (click)="genererScript.emit()"
        [attr.title]="'Générer le fichier custom bidding DV360 pour « ' + nom + ' »'"
        [class]="boutonTeal"
        [style.top.px]="haut() + 84"
        [style.right]="droite()"
      >
        <mg-icone nom="fichier-bas" [taille]="14" [trait]="1.5" />
        Script bidding DV360
      </button>
    }
    @if (planMedia(); as n) {
      <button
        type="button"
        data-plan-media
        (click)="rouvrirPlan.emit()"
        title="Rouvrir le plan média des zones affichées"
        [class]="boutonTeal"
        [style.top.px]="haut() + 126"
        [style.right]="droite()"
      >Plan média ({{ n }})</button>
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
  /** Écart au bord droit en px : 10, plus la largeur du plan média et 10 px quand il est ouvert. */
  readonly decalage = input(10);
  /** Le nombre de zones du plan média quand son panneau est FERMÉ, `null` sinon : « Plan média (n) ». */
  readonly planMedia = input<number | null>(null);
  readonly rouvrirPlan = output<void>();

  protected readonly bouton = BOUTON;
  protected readonly boutonTeal = BOUTON_TEAL;
  protected readonly droite = computed(() => droiteBoutons(this.decalage()));
}
