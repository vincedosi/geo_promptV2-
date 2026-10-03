import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Un bouton-bascule en forme de pastille. Reste un vrai `<button>`, avec `aria-pressed`.
 * Rayon 6 (`rounded-lg`, échelle de React) et `text-[12px]` sans interligne imposé, comme le style en ligne de
 * `elements.tsx` (12 px, interligne hérité 1,5 = 18 px) — `text-xs` imposerait 16 px et rabotait la pastille de 2 px.
 */
@Component({
  selector: 'button[mgPastille]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    type: 'button',
    '[attr.aria-pressed]': 'actif()',
    class: 'rounded-lg px-[11px] py-1.5 text-[12px] cursor-pointer border-fin transition-colors duration-200 ease-[var(--ease-out)]',
    '[class.bg-teal-10]': 'actif()',
    '[class.border-teal]': 'actif()',
    '[class.text-teal]': 'actif()',
    '[class.border-subtle]': '!actif()',
    '[class.text-secondary]': '!actif()',
  },
})
export class PastilleComponent {
  readonly actif = input.required<boolean>();
}
