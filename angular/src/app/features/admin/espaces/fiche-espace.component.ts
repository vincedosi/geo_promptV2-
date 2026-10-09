import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Fiche d'un espace — coquille de T5 pour que la route compile ; remplie par T7. */
@Component({
  selector: 'mg-fiche-espace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="m-0 text-[13px] text-secondary">Fiche en cours de construction</p>`,
})
export class FicheEspaceComponent {}
