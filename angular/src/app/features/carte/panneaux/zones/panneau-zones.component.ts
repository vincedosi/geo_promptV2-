import { ChangeDetectionStrategy, Component } from '@angular/core';
import { JeuxDeZonesComponent } from './jeux-de-zones.component';
import { MesZonesComponent } from './mes-zones.component';

/**
 * Le panneau « Zones » du rail — `app/map/_components/panneaux/PanneauZones.tsx` (lot 4, T14) : « Ce que je
 * fabrique ». Trois sections, dans l'ordre de React :
 *
 *   - « Créer une zone » : capture des couches, codes postaux, rayon, dessin — la tâche 16. La section est posée (titre
 *     et cadre de React) avec une ligne provisoire, pour que le panneau ait déjà sa forme définitive.
 *   - « Jeux de zones à risque » (T13, `mg-jeux-de-zones`) : AVANT « Mes zones », comme React — peu nombreux, ils
 *     portent un plan de campagne, là où « Mes zones » se parcourt en défilant.
 *   - « Mes zones » (`mg-mes-zones`).
 */
@Component({
  selector: 'mg-panneau-zones',
  imports: [JeuxDeZonesComponent, MesZonesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-y-auto' },
  template: `
    <section data-section="creer" class="border-b-fin border-subtle px-4 py-3">
      <h4 class="mb-2 mt-0 text-[11px] font-medium tracking-[0.04em] text-secondary">Créer une zone</h4>
      <p data-provisoire class="m-0 text-[12px] text-tertiary">La création de zones arrive avec la tâche 16.</p>
    </section>

    <mg-jeux-de-zones />

    <section data-section="mes-zones" class="pt-3">
      <h4 class="mb-2 mt-0 px-4 text-[11px] font-medium tracking-[0.04em] text-secondary">Mes zones</h4>
      <mg-mes-zones />
    </section>
  `,
})
export class PanneauZonesComponent {}
