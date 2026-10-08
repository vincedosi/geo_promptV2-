import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LogoComponent } from '../logo/logo.component';

/**
 * L'en-tête de marque de la barre latérale, tel que `components/AppSidebar.tsx` le pose :
 * logo dentsu 20 px de haut, puis la signature 11 px tertiaire 6 px plus bas.
 * Le cadre `px-4 pt-5 pb-4` est celui de React : l'en-tête se pose tel quel dans la barre.
 * Le filet sous l'en-tête et le bouton « Campagnes » appartiennent à la coquille, pas à la marque.
 */
@Component({
  selector: 'mg-marque',
  imports: [LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block px-4 pt-5 pb-4' },
  template: `
    <div class="flex"><mg-logo [hauteur]="20" /></div>
    <p class="mt-1.5 text-[11px] font-normal text-tertiary">Geospatial intelligence</p>
  `,
})
export class MarqueComponent {}
