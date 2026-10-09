import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Fiche « Socle » — coquille de T5 pour que la route compile ; remplie par T6. */
@Component({
  selector: 'mg-fiche-socle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="m-0 text-[13px] text-secondary">Fiche en cours de construction</p>`,
})
export class FicheSocleComponent {}
