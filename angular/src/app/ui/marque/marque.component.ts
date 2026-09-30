import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HexagoneComponent } from '../hexagone/hexagone.component';
import { LogoComponent } from '../logo/logo.component';

/**
 * L'en-tête de marque de la barre latérale, tel que `components/AppSidebar.tsx:164-204` le pose :
 * hexagone 28 px + logotype 18 px de haut sur une ligne (`gap-2`), puis la signature 11 px tertiaire
 * 6 px plus bas décalée de 36 px (28 de hexagone + 8 d'écart) pour s'aligner sous le logotype.
 * Le cadre `px-4 pt-5 pb-4` est celui de React : l'en-tête se pose tel quel dans la barre.
 * Le filet sous l'en-tête et le bouton « MAGELIAN » appartiennent à la coquille, pas à la marque.
 */
@Component({
  selector: 'mg-marque',
  imports: [HexagoneComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block px-4 pt-5 pb-4' },
  template: `
    <div class="flex items-center gap-2">
      <mg-hexagone variante="marque" />
      <mg-logo [hauteur]="18" />
    </div>
    <p class="mt-1.5 text-[11px] font-normal text-tertiary pl-[36px]">Geospatial intelligence</p>
  `,
})
export class MarqueComponent {}
