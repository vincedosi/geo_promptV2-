import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * Une tuile de chiffre clé. La `note` est OBLIGATOIRE, à dessein (même règle
 * que components/risques/Kpi.tsx) : un chiffre sans sa limite de lecture se
 * recopie dans une présentation sans elle.
 */
@Component({
  selector: 'mg-kpi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-px">
      <span data-role="valeur" class="font-mono leading-[1.1]"
            [class.text-[24px]]="taille() === 24" [class.text-[22px]]="taille() === 22"
            [class.text-teal]="accent()" [class.text-primary]="!accent()">{{ valeur() }}</span>
      <span data-role="libelle" class="text-secondary"
            [class.text-xs]="taille() === 24" [class.text-[11px]]="taille() === 22">{{ libelle() }}</span>
      <span class="text-[10px] text-tertiary">{{ note() }}</span>
    </div>
  `,
})
export class KpiComponent {
  readonly valeur = input.required<string>();
  readonly libelle = input.required<string>();
  readonly note = input.required<string>();
  readonly accent = input(false, { transform: booleanAttribute });
  readonly taille = input<22 | 24>(24);
}
