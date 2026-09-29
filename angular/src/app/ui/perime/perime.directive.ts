import { Directive, input } from '@angular/core';

/** Estompe une valeur qui décrit l'état précédent pendant un recalcul (voir `estPerime`). */
@Directive({
  selector: '[mgPerime]',
  host: {
    '[style.opacity]': 'mgPerime() ? 0.42 : 1',
    '[style.transition]': '"opacity 160ms linear"',
    '[attr.aria-busy]': 'mgPerime()',
  },
})
export class PerimeDirective {
  readonly mgPerime = input.required<boolean>();
}
