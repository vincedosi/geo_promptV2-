import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Les deux hexagones SVG de `components/AppSidebar.tsx`, tracés recopiés tels quels (ce ne sont PAS
 * des icônes lucide : ils sont dessinés à la main dans React).
 *
 * - `marque` (28 px, `AppSidebar.tsx:170-190`) : contour extérieur trait 1, contour intérieur trait
 *   0,5 rempli à 6 % de teal, point central à 50 %. Tout en teal de marque (`var(--brand-teal)`,
 *   invariant d'un thème à l'autre).
 * - `cta` (15 px, `AppSidebar.tsx:223-226`) : contour trait 1,8 et disque r 2,5, en `currentColor`
 *   pour suivre la couleur du bouton « MAGELIAN ». Décoratif (`aria-hidden`).
 *
 * `rgba(78,205,196,0.06)` de React devient `fill-teal` + `fill-opacity` : même rendu, aucun littéral.
 * `taille` remplace la taille de la variante quand l'appelant en veut une autre.
 */
@Component({
  selector: 'mg-hexagone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    @if (variante() === 'marque') {
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" fill="none"
           [attr.width]="cote()" [attr.height]="cote()" class="shrink-0">
        <path d="M14 2L25.5 8.5V19.5L14 26L2.5 19.5V8.5L14 2Z" class="stroke-teal" stroke-width="1" fill="none" />
        <path d="M14 7L20.5 10.5V17.5L14 21L7.5 17.5V10.5L14 7Z" class="stroke-teal fill-teal" stroke-width="0.5" fill-opacity="0.06" />
        <circle cx="14" cy="14" r="2" class="fill-teal" opacity="0.5" />
      </svg>
    } @else {
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" fill="none" aria-hidden="true"
           [attr.width]="cote()" [attr.height]="cote()" class="shrink-0">
        <path d="M14 2L25.5 8.5V19.5L14 26L2.5 19.5V8.5L14 2Z" stroke="currentColor" stroke-width="1.8" />
        <circle cx="14" cy="14" r="2.5" fill="currentColor" />
      </svg>
    }
  `,
})
export class HexagoneComponent {
  readonly variante = input<'marque' | 'cta'>('marque');
  /** Côté en pixels ; par défaut 28 (marque) ou 15 (cta), comme React. */
  readonly taille = input<number>();

  protected readonly cote = computed(() => this.taille() ?? (this.variante() === 'marque' ? 28 : 15));
}
