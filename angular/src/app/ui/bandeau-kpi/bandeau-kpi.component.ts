import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Le conteneur du bandeau de chiffres clés, porté de `BandeauKpi.tsx` (K1, K3) :
 * fond `--bg-level-2`, traits de 0,5 px en haut ET en bas, `10px 20px`, écart de
 * 26 px, retour à la ligne. Les tuiles (`mg-kpi`) sont projetées ; la consigne
 * finale (10 px tertiaire, 260 px au plus) et sa définition en infobulle sont
 * facultatives. Le CONTENU des chiffres relève de l'écran, pas de ce composant.
 */
@Component({
  selector: 'mg-bandeau-kpi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex flex-wrap gap-[26px] border-t-fin border-b-fin border-subtle bg-elevated px-5 py-[10px]">
      <ng-content />
      @if (consigne(); as texte) {
        <span class="max-w-[260px] self-center text-[10px] leading-[1.45] text-tertiary"
              [attr.title]="definition()">{{ texte }}</span>
      }
    </div>
  `,
})
export class BandeauKpiComponent {
  /** La phrase de fin de bandeau. */
  readonly consigne = input<string>();
  /** La définition complète, en infobulle de la consigne. */
  readonly definition = input<string>();
}
