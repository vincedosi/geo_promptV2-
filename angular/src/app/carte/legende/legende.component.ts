import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Le CONTENEUR d'une légende de carte (`CarteRisque.tsx:1003`) : fond
 * `--card-overlay` (translucide à dessein, il flotte sur la carte), bord 0,5 px
 * subtil, rayon 8, marge `9px 11px`, 260 px au plus. Il ne sait rien de ce qu'il
 * contient : le contenu se projette (`mg-legende-niveaux`, une note…).
 * L'emplacement est celui du PARENT (`absolute bottom-2.5 left-2.5 z-[2]`).
 */
@Component({
  selector: 'mg-legende',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { class: 'block max-w-[260px] rounded-lg border-fin border-subtle bg-card-overlay px-[11px] py-[9px]' },
})
export class LegendeComponent {}
