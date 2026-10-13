import { ChangeDetectionStrategy, Component, effect, inject, untracked } from '@angular/core';
import { MesAnalysesComponent } from './mes-analyses.component';
import { MesAnalysesService } from './mes-analyses.service';
import { OutilsCarteService } from './outils-carte.service';

/**
 * Le tiroir « Mes analyses » (spec § 6 : « Mes analyses » sort des calques). Créé à la PREMIÈRE ouverture du tiroir,
 * puis gardé, masqué et inerte (ruling AT-6) : la liste est lue à cette première ouverture — jamais au chargement de la
 * carte, comme le premier dépliage du groupe des Calques qu'il remplace —, et rouvrir ne relit rien. Seul un échec
 * laisse la réouverture suivante relire (`demanderChargement` ne relit qu'après un échec). Le service est fourni ICI.
 */
@Component({
  selector: 'mg-outil-mes-analyses',
  imports: [MesAnalysesComponent],
  providers: [MesAnalysesService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mg-mes-analyses />`,
})
export class OutilMesAnalysesComponent {
  constructor() {
    const analyses = inject(MesAnalysesService);
    const outils = inject(OutilsCarteService);
    effect(() => {
      if (outils.outil() === 'analyses') untracked(() => analyses.demanderChargement());
    });
  }
}
