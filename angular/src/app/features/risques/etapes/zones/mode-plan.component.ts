import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MODES_PLAN } from '../../logique/jeu';

export type ModePlan = (typeof MODES_PLAN)[number];

/** Le libellé du mode de plan, et ce qu'il engage — MOT POUR MOT de `OngletZones.tsx:127-138`. */
export const LIBELLE_MODE: Record<ModePlan, { titre: string; aide: string }> = {
  pondere: {
    titre: 'Pondéré',
    aide: 'Toute la France reçoit du budget, les zones en reçoivent davantage. '
      + 'Le hors-zone garde un poids de 1.',
  },
  exclusif: {
    titre: 'Exclusif',
    aide: 'Zéro impression hors des zones retenues. La campagne ne diffuse que '
      + 'sur les codes postaux du jeu.',
  },
};

/** Les deux façons de traduire un jeu en plan — portage de `ModePlan` (`OngletZones.tsx:545-578`). */
@Component({
  selector: 'mg-mode-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mb-4 flex flex-wrap gap-[10px]' },
  template: `
    @for (m of modes; track m) {
      <button type="button" (click)="modeChange.emit(m)" [attr.aria-pressed]="m === mode()"
              class="flex-[1_1_240px] cursor-pointer rounded-[8px] border-fin px-3 py-[10px] text-left text-primary"
              [class.bg-teal-10]="m === mode()" [class.border-teal]="m === mode()"
              [class.bg-transparent]="m !== mode()" [class.border-subtle]="m !== mode()">
        <div class="mb-[3px] text-[12px] font-medium">{{ libelles[m].titre }}</div>
        <div class="text-[11px] leading-[1.5] text-tertiary">{{ libelles[m].aide }}</div>
      </button>
    }
  `,
})
export class ModePlanComponent {
  readonly mode = input.required<ModePlan>();
  readonly modeChange = output<ModePlan>();

  protected readonly modes = MODES_PLAN;
  protected readonly libelles = LIBELLE_MODE;
}
