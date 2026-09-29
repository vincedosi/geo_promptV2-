import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * En-tête de colonne. `explication` rend un soulignement pointillé et une
 * info-bulle : un en-tête qui a besoin d'être expliqué doit le montrer.
 */
@Component({
  selector: 'th[mgTh]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    class: 'px-2 py-1.5 font-normal text-[10px] text-tertiary',
    '[class.text-left]': 'alignement() === "gauche"',
    '[class.text-right]': 'alignement() === "droite"',
    '[attr.title]': 'explication() ?? null',
    '[class.cursor-help]': '!!explication()',
    '[class.border-b]': '!!explication()',
    '[class.border-dotted]': '!!explication()',
    '[class.border-default]': '!!explication()',
  },
})
export class EnteteCellule {
  readonly alignement = input<'gauche' | 'droite'>('droite');
  readonly explication = input<string>();
}

/** Cellule de chiffre : alignée à droite, en police à chasse fixe. */
@Component({
  selector: 'td[mgTd]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    class: 'text-right px-2 py-[7px] font-mono text-[11px]',
    '[class.text-primary]': 'fort()',
    '[class.text-tertiary]': '!fort() && attenue()',
    '[class.text-secondary]': '!fort() && !attenue()',
  },
})
export class Cellule {
  readonly fort = input(false, { transform: booleanAttribute });
  readonly attenue = input(false, { transform: booleanAttribute });
}
