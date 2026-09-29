import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Un libellé au-dessus de son contrôle, liés par un `<label>` englobant. */
@Component({
  selector: 'mg-champ',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="flex flex-col gap-[5px]">
      <span class="text-[10px] text-tertiary">{{ libelle() }}</span>
      <ng-content />
    </label>
  `,
})
export class ChampComponent {
  readonly libelle = input.required<string>();
}
