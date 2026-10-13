import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { JeuxDeZonesComponent } from '../panneaux/zones/jeux-de-zones.component';
import { MesZonesComponent } from '../panneaux/zones/mes-zones.component';
import { OutilsCarteService } from './outils-carte.service';

/**
 * Le tiroir « Mes zones » (spec § 6) : les jeux de zones, puis « Mes zones » (recherche, puces, opérations, affichage,
 * export, suppression) — sortis du panneau Zones, qui garde « Créer une zone ». Monté à la première ouverture du tiroir
 * puis gardé (ruling AT-6) : une opération en vol survit à un Échap, et la sélection aussi. Une zone créée à ④ relit la
 * liste (`revisionZones`) sans recréer le composant. « Afficher » une zone ne change pas d'étape (ruling AT-7).
 */
@Component({
  selector: 'mg-outil-mes-zones',
  imports: [JeuxDeZonesComponent, MesZonesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-jeux-de-zones />
    <section data-section="mes-zones" class="pt-3">
      <h4 class="mb-2 mt-0 px-4 text-[11px] font-medium text-secondary">Mes zones</h4>
      <mg-mes-zones [rafraichir]="outils.revisionZones()" />
    </section>
  `,
})
export class OutilMesZonesComponent {
  protected readonly outils = inject(OutilsCarteService);
}
