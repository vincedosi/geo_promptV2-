import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Un bouton-bascule en forme de pastille. Reste un vrai `<button>`, avec `aria-pressed`. */
@Component({
  selector: 'button[mgPastille]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    type: 'button',
    '[attr.aria-pressed]': 'actif()',
    class: 'rounded-md px-[11px] py-1.5 text-xs cursor-pointer border-[0.5px] transition-colors duration-200',
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
